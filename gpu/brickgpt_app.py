"""Bouwboot GPU service: BrickGPT on Modal, streams bricks as they are placed.

Deploy:  modal deploy gpu/brickgpt_app.py   (done by .github/workflows/gpu.yml)
Auth:    header  Authorization: Bearer <sha256("bouwboot:" + MODAL_TOKEN_SECRET)>
"""
import json
import os
import queue
import threading

import modal

BRICKGPT_COMMIT = "9c53c7cb65f9de0df89562cc74b2d2e270fbcab4"
MODEL_DIR = "/model"
# meta-llama is gated on Hugging Face; this is an ungated copy of the same weights.
UNGATED_BASE = "unsloth/Llama-3.2-1B-Instruct"


def download_model():
    import torch
    from huggingface_hub import list_repo_files, hf_hub_download
    from transformers import AutoModelForCausalLM, AutoTokenizer

    repo = "AvaLovelace/BrickGPT"
    files = list_repo_files(repo)
    print("BrickGPT repo files:", files)
    if "adapter_config.json" in files:
        from peft import PeftModel
        cfg = json.load(open(hf_hub_download(repo, "adapter_config.json")))
        base_name = cfg.get("base_model_name_or_path", UNGATED_BASE)
        if base_name.startswith("meta-llama/"):
            base_name = UNGATED_BASE
        print("Adapter on base", base_name)
        base = AutoModelForCausalLM.from_pretrained(base_name, torch_dtype=torch.float32)
        model = PeftModel.from_pretrained(base, repo).merge_and_unload()
        tok_src = repo if "tokenizer_config.json" in files else base_name
    else:
        model = AutoModelForCausalLM.from_pretrained(repo, torch_dtype=torch.float32)
        tok_src = repo
    tok = AutoTokenizer.from_pretrained(tok_src)
    model.save_pretrained(MODEL_DIR)
    tok.save_pretrained(MODEL_DIR)


image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git")
    .pip_install(
        "torch==2.7.0", "transformers==4.51.3", "peft==0.15.2", "numpy<2",
        "networkx", "gurobipy", "huggingface_hub", "accelerate", "fastapi[standard]",
    )
    .run_commands(
        "git clone https://github.com/AvaLovelace1/BrickGPT /opt/BrickGPT",
        f"cd /opt/BrickGPT && git checkout {BRICKGPT_COMMIT}",
    )
    .env({"PYTHONPATH": "/opt/BrickGPT/src"})
    .run_function(download_model)
)

app = modal.App("bouwboot-gpu", image=image)


def make_engine():
    import copy
    from collections import Counter
    from brickgpt.models import BrickGPT, BrickGPTConfig
    from brickgpt.data import BrickStructure, Brick

    class StreamingBrickGPT(BrickGPT):
        """BrickGPT that reports every placed brick and every rollback through a callback."""

        allowed_dims = None  # set of (h, w) with h <= w, or None for all

        def _try_adding_brick_ext(self, brick_str, bricks, rejected):
            r = BrickGPT._try_adding_brick(brick_str, bricks, rejected)
            if r == "success" and self.allowed_dims is not None:
                b = Brick.from_txt(brick_str)
                if (min(b.h, b.w), max(b.h, b.w)) not in self.allowed_dims:
                    return "not_allowed"
            return r

        def generate_brick_with_rejection_sampling(self, prompt=None, bricks=BrickStructure([])):
            rejection_reasons, rejected = Counter(), set()
            brick, temperature = "", self.temperature
            for n in range(self.max_brick_rejections + 1):
                self.llm.save_state()
                brick = self.generate_brick(prompt, temperature=temperature)
                if not brick:
                    break
                res = self._try_adding_brick_ext(brick, bricks, rejected)
                if res == "success" or n == self.max_brick_rejections:
                    break
                self.llm.rollback_to_saved_state()
                rejection_reasons.update([res])
                rejected.add(brick)
                if res == "already_rejected":
                    temperature = min(self.max_temperature, temperature + self.temperature_increase)
            return brick, rejection_reasons

        def stream(self, caption, emit, max_bricks):
            starting = BrickStructure([])
            for regen in range(self.max_regenerations + 1):
                bricks = copy.deepcopy(starting)
                msgs = [{"role": "system", "content": "You are a helpful assistant."},
                        {"role": "user", "content": self.instruction_fn(caption)}]
                txt = bricks.to_txt()
                if txt:
                    msgs.append({"role": "assistant", "content": txt})
                    prompt = self.llm.tokenizer.apply_chat_template(msgs, continue_final_message=True, return_tensors="pt")
                else:
                    prompt = self.llm.tokenizer.apply_chat_template(msgs, add_generation_prompt=True, return_tensors="pt")
                for i in range(max_bricks - len(bricks)):
                    b, _ = self.generate_brick_with_rejection_sampling(prompt if i == 0 else None, bricks=bricks)
                    if not b:
                        break
                    try:
                        brick = Brick.from_txt(b)
                        if bricks.brick_collides(brick) or not bricks.brick_in_bounds(brick):
                            continue
                    except ValueError:
                        continue
                    bricks.add_brick(brick)
                    emit({"type": "brick", "b": brick.to_txt().strip()})
                if self.max_regenerations == 0 or self._is_stable(bricks) or regen == self.max_regenerations:
                    return bricks
                starting = self._remove_all_bricks_after_first_unstable_brick(bricks)
                emit({"type": "rollback", "keep": len(starting)})
            return bricks

    cfg = BrickGPTConfig(MODEL_DIR, use_gurobi=False, max_regenerations=20, max_brick_rejections=200)
    return StreamingBrickGPT(cfg)


@app.cls(gpu="T4", scaledown_window=300, timeout=900,
         secrets=[modal.Secret.from_name("bouwboot-gpu")])
class Designer:
    @modal.enter()
    def load(self):
        self.engine = make_engine()

    @modal.asgi_app()
    def web(self):
        import hmac
        import torch
        from fastapi import FastAPI, Header, HTTPException
        from fastapi.responses import StreamingResponse
        from pydantic import BaseModel

        api = FastAPI()
        key = os.environ["BOUWBOOT_GPU_KEY"]

        class Req(BaseModel):
            caption: str
            seed: int = 42
            allowed: list[str] | None = None  # e.g. ["2x4", "1x2"]
            max_bricks: int = 400

        def check(auth):
            if not auth or not hmac.compare_digest(auth, f"Bearer {key}"):
                raise HTTPException(401, "unauthorized")

        @api.get("/health")
        def health(authorization: str | None = Header(None)):
            check(authorization)
            return {"ok": True, "cuda": torch.cuda.is_available()}

        @api.post("/generate")
        def generate(req: Req, authorization: str | None = Header(None)):
            check(authorization)
            q: queue.Queue = queue.Queue()
            eng = self.engine

            def run():
                try:
                    torch.manual_seed(req.seed)
                    eng.allowed_dims = None
                    if req.allowed:
                        dims = set()
                        for s in req.allowed:
                            h, w = map(int, s.lower().split("x"))
                            dims.add((min(h, w), max(h, w)))
                        eng.allowed_dims = dims
                    bricks = eng.stream(req.caption, q.put, max(10, min(req.max_bricks, 1200)))
                    q.put({"type": "done", "bricks": [l for l in bricks.to_txt().split("\n") if l.strip()]})
                except Exception as e:  # report instead of hanging the stream
                    q.put({"type": "error", "message": repr(e)})
                q.put(None)

            threading.Thread(target=run, daemon=True).start()

            def events():
                yield "data: " + json.dumps({"type": "start"}) + "\n\n"
                while True:
                    try:
                        item = q.get(timeout=15)
                    except queue.Empty:
                        yield ": keepalive\n\n"
                        continue
                    if item is None:
                        break
                    yield "data: " + json.dumps(item) + "\n\n"

            return StreamingResponse(events(), media_type="text/event-stream")

        return api
