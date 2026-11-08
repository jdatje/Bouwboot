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

TRIPOSR_COMMIT = "107cefdc244c39106fa830359024f6a2f1c78871"


def download_triposr():
    import rembg
    from tsr.system import TSR
    TSR.from_pretrained("stabilityai/TripoSR", config_name="config.yaml", weight_name="model.ckpt")
    rembg.new_session()


# TripoSR (MIT) turns one picture into a 3D shape. torchmcubes is only needed for mesh export,
# which we skip (we sample the shape on a grid), so a stub stands in for it.
image3d = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "libgl1", "libglib2.0-0")
    .pip_install(
        "torch==2.1.2", "torchvision==0.16.2", "numpy<2", "transformers==4.35.0", "huggingface_hub<0.26",
        "omegaconf==2.3.0", "einops==0.7.0", "trimesh==4.0.5", "Pillow==10.1.0", "rembg==2.0.56",
        "onnxruntime==1.17.3", "fastapi[standard]",
    )
    .run_commands(
        "git clone https://github.com/VAST-AI-Research/TripoSR /opt/TripoSR",
        f"cd /opt/TripoSR && git checkout {TRIPOSR_COMMIT}",
        "mkdir -p /opt/stubs && printf 'def marching_cubes(*a, **k):\\n    raise NotImplementedError\\n' > /opt/stubs/torchmcubes.py",
    )
    .env({"PYTHONPATH": "/opt/TripoSR:/opt/stubs:/root"})
    .run_function(download_triposr)
    .add_local_python_source("shape3d")
)


class FastEngine:
    """BrickGPT inference, rewritten for speed but with the same rules as the original:
    constrained brick syntax, rejection sampling (collisions, bounds, repeats) and
    connectivity-based rollback. Uses direct forward passes with a KV cache that is cropped
    on rejection instead of deep-copied, which is many times faster than generate() per token.
    """

    def __init__(self):
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
        from brickgpt.data import max_brick_dimension

        self.torch = torch
        self.tok = AutoTokenizer.from_pretrained(MODEL_DIR)
        self.model = AutoModelForCausalLM.from_pretrained(MODEL_DIR, torch_dtype=torch.float16).to("cuda").eval()

        def ids(strs):
            out = []
            for s in strs:
                t = self.tok.tokenize(s)
                assert len(t) == 1, f"{s!r} is not one token: {t}"
                out.append(self.tok.convert_tokens_to_ids(t[0]))
            return torch.tensor(out, device="cuda")

        dims = [str(i) for i in range(1, max_brick_dimension + 1)]
        posns = [str(i) for i in range(20)]
        self.eos = self.tok.eos_token_id
        self.dim_id = {i: int(ids([str(i)])[0]) for i in range(1, max_brick_dimension + 1)}
        self.id_dim = {v: k for k, v in self.dim_id.items()}
        from brickgpt.data.brick_library import brick_library
        self.library = {(min(p["height"], p["width"]), max(p["height"], p["width"])) for p in brick_library.values()}
        self.slots = [ids(dims + [self.tok.eos_token]), ids(["x"]), ids(dims), ids([" ("]), ids(posns),
                      ids([","]), ids(posns), ids([","]), ids(posns), ids([")\n"])]
        self.slot_strs = None

    # --- low level -------------------------------------------------------------------------
    def _forward(self, token_ids):
        torch = self.torch
        x = torch.tensor([token_ids], device="cuda")
        with torch.no_grad():
            out = self.model(input_ids=x, past_key_values=self.cache, use_cache=True)
        self.cache = out.past_key_values
        self.logits = out.logits[0, -1].float()
        self.hist.extend(token_ids)

    def _crop(self, length):
        """Rewinds to `length` tokens and recomputes the logits after the last kept token."""
        self.cache.crop(length - 1)
        last = self.hist[length - 1]
        del self.hist[length - 1:]
        self._forward([last])

    def _sample(self, allowed, temperature):
        torch = self.torch
        l = self.logits[allowed] / max(temperature, 1e-3)
        p = torch.softmax(l, dim=-1)
        return int(allowed[torch.multinomial(p, 1)].item())

    def _gen_brick(self, temperature, pairs):
        """Generates one brick. `pairs` = allowed (h, w) in both orientations: the first number
        is limited to sizes that exist, the second to sizes that fit with the first."""
        torch = self.torch
        toks = []
        h = None
        for i, allowed in enumerate(self.slots):
            if i == 0:
                allowed = torch.tensor(sorted({self.dim_id[a] for a, _ in pairs}) + [self.eos], device="cuda")
            elif i == 2:
                allowed = torch.tensor(sorted({self.dim_id[b] for a, b in pairs if a == h}), device="cuda")
            t = self._sample(allowed, temperature)
            if i == 0 and t != self.eos:
                h = self.id_dim[t]
            if t == self.eos:
                return ""
            toks.append(t)
            self._forward([t])
        return self.tok.decode(toks)

    # --- brick rules -----------------------------------------------------------------------
    def _check(self, txt, bricks, rejected, allowed_dims):
        from brickgpt.data import Brick
        if txt in rejected:
            return "already_rejected", None
        try:
            b = Brick.from_txt(txt)
        except ValueError:
            return "ill_formatted", None
        try:
            _ = b.brick_id
        except ValueError:
            return "not_in_library", None
        if allowed_dims is not None and (min(b.h, b.w), max(b.h, b.w)) not in allowed_dims:
            return "not_allowed", None
        if not bricks.brick_in_bounds(b):
            return "out_of_bounds", None
        if bricks.brick_collides(b):
            return "collision", None
        return "success", b

    def _next_brick(self, bricks, allowed_dims, stats, max_rejections=150):
        rejected, temperature = set(), 0.6
        base = allowed_dims if allowed_dims is not None else self.library
        pairs = {(a, b) for a, b in base} | {(b, a) for a, b in base}
        for n in range(max_rejections + 1):
            length, logits = len(self.hist), self.logits.clone()
            txt = self._gen_brick(temperature, pairs)
            stats["attempts"] += 1
            if not txt:
                return None
            res, b = self._check(txt, bricks, rejected, allowed_dims)
            if res == "success":
                return b
            stats[res] = stats.get(res, 0) + 1
            # rewind the tokens of the rejected brick
            self.cache.crop(length)
            del self.hist[length:]
            self.logits = logits
            rejected.add(txt)
            if res == "already_rejected":
                temperature = min(2.0, temperature + 0.01)
        return None

    @staticmethod
    def _trim_unstable(bricks):
        import numpy as np
        from brickgpt.data import BrickStructure
        while not bricks.is_connected():
            scores = bricks.connectivity_scores()
            idx = next((i for i, b in enumerate(bricks.bricks) if np.any(scores[b.slice] >= 1)), -1)
            bricks = BrickStructure(bricks.bricks[:idx])
        return bricks

    def stream(self, caption, emit, max_bricks=400, allowed_dims=None, max_regenerations=20):
        import time
        from transformers.cache_utils import DynamicCache
        from brickgpt.data import BrickStructure
        from brickgpt.models.brickgpt import create_instruction

        t0 = time.time()
        msgs = [{"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": create_instruction(caption)}]
        prompt = self.tok.apply_chat_template(msgs, add_generation_prompt=True)
        self.cache, self.hist = DynamicCache(), []
        self._forward(list(prompt))
        prompt_len = len(self.hist)

        bricks, ends = BrickStructure([]), []
        stats = {"attempts": 0, "regenerations": 0}
        for regen in range(max_regenerations + 1):
            while len(bricks) < max_bricks:
                b = self._next_brick(bricks, allowed_dims, stats)
                if b is None:
                    break
                bricks.add_brick(b)
                ends.append(len(self.hist))
                emit({"type": "brick", "b": b.to_txt().strip()})
            if bricks.is_connected() or regen == max_regenerations:
                break
            kept = self._trim_unstable(bricks)
            k = len(kept)
            stats["regenerations"] += 1
            bricks, ends = BrickStructure(kept.bricks), ends[:k]
            self._crop(ends[-1] if k else prompt_len)
            emit({"type": "rollback", "keep": k})
        stats["seconds"] = round(time.time() - t0, 1)
        stats["tokens"] = len(self.hist) - prompt_len
        return bricks, stats


def parse_sizes(items):
    """["2x4", "p1x2"] → [(2, 4), ("p", (1, 2))]; None = everything allowed."""
    if not items:
        return None
    out = []
    for x in items:
        x = x.lower()
        dims = tuple(sorted(map(int, x.lstrip("p").split("x"))))
        out.append(("p", dims) if x.startswith("p") else dims)
    return out


TRELLIS2_COMMIT = "75fbf0183001ed9876c8dbb35de6b68552ee08bd"


def warm_rembg():
    import rembg
    rembg.new_session()

models_volume = modal.Volume.from_name("bouwboot-models", create_if_missing=True)

# TRELLIS.2 (Microsoft, MIT): much better image → 3D. Needs a 24 GB GPU and a few compiled CUDA
# extensions; we build them for Ampere/Ada (A10G = 8.6, L4 = 8.9). Attention runs on xformers.
image_trellis = (
    modal.Image.from_registry("nvidia/cuda:12.4.1-devel-ubuntu22.04", add_python="3.11")
    .apt_install("git", "libgl1", "libglib2.0-0", "libjpeg-dev", "build-essential", "ninja-build", "clang")
    .pip_install("torch==2.6.0", "torchvision==0.21.0", index_url="https://download.pytorch.org/whl/cu124")
    .pip_install(
        "xformers==0.0.29.post2", "numpy<2", "imageio", "tqdm", "easydict", "opencv-python-headless", "ninja",
        "trimesh", "transformers==4.57.1", "huggingface_hub", "safetensors", "kornia", "timm", "scipy",
        "zstandard", "pillow", "fastapi[standard]", "rembg==2.0.56", "onnxruntime==1.17.3",
        "git+https://github.com/EasternJournalist/utils3d.git@9a4eb15e4021b67b12c460c7057d642626897ec8",
    )
    .env({"TORCH_CUDA_ARCH_LIST": "8.6;8.9", "FORCE_CUDA": "1", "MAX_JOBS": "8"})
    .run_commands(
        f"git clone --recursive https://github.com/microsoft/TRELLIS.2 /opt/TRELLIS.2 && cd /opt/TRELLIS.2 && git checkout {TRELLIS2_COMMIT} && git submodule update --init --recursive",
    )
    .run_commands(
        "git clone --recursive https://github.com/JeffreyXiang/CuMesh.git /tmp/CuMesh && pip install /tmp/CuMesh --no-build-isolation",
        gpu="L4",
    )
    .run_commands(
        "git clone --recursive https://github.com/JeffreyXiang/FlexGEMM.git /tmp/FlexGEMM && pip install /tmp/FlexGEMM --no-build-isolation",
        gpu="L4",
    )
    .run_commands(
        "cp -r /opt/TRELLIS.2/o-voxel /tmp/o-voxel && pip install /tmp/o-voxel --no-build-isolation",
        gpu="L4",
    )
    .run_commands(
        "git clone -b v0.4.0 https://github.com/NVlabs/nvdiffrast.git /tmp/nvdiffrast && pip install /tmp/nvdiffrast --no-build-isolation",
        gpu="L4",
    )
    .run_commands("python -c 'import cumesh, flex_gemm, o_voxel, nvdiffrast, xformers; print(\"extensions ok\")'", gpu="L4")
    .run_function(warm_rembg)
    .env({"PYTHONPATH": "/opt/TRELLIS.2:/root", "ATTN_BACKEND": "xformers", "SPARSE_ATTN_BACKEND": "xformers",
          "HF_HOME": "/models/hf", "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True"})
    .add_local_python_source("shape3d")
)


@app.cls(gpu="L4", image=image_trellis, scaledown_window=300, timeout=600, volumes={"/models": models_volume},
         secrets=[modal.Secret.from_name("bouwboot-gpu"), modal.Secret.from_name("bouwboot-hf")])
class Trellis:
    @modal.enter()
    def load(self):
        import rembg
        import torch
        from trellis2.pipelines import rembg as t_rembg

        class NoRembg:  # we remove the background ourselves (RMBG-2.0 is non-commercial and gated)
            def __init__(self, *a, **k): pass
            def to(self, *a): return self
            def cpu(self): return self
            def cuda(self): return self
        t_rembg.BiRefNet = NoRembg
        from trellis2.pipelines import Trellis2ImageTo3DPipeline
        self.pipe = Trellis2ImageTo3DPipeline.from_pretrained("microsoft/TRELLIS.2-4B")
        self.pipe.low_vram = False
        self.pipe.cuda()
        self.rembg = rembg.new_session()
        models_volume.commit()

    @modal.asgi_app()
    def web(self):
        import base64
        import hmac
        import io
        import time
        import numpy as np
        import torch
        from fastapi import FastAPI, Header, HTTPException
        from PIL import Image
        from pydantic import BaseModel
        from shape3d import shape_to_bricks

        api = FastAPI()
        key = os.environ["BOUWBOOT_GPU_KEY"]

        class Req(BaseModel):
            image: str
            palette: list[dict]
            max_studs: int = 20
            max_bricks: int = 600
            sizes: list[str] | None = None
            plates: bool = True
            seed: int = 1

        def check(auth):
            if not auth or not hmac.compare_digest(auth, f"Bearer {key}"):
                raise HTTPException(401, "unauthorized")

        @api.get("/health")
        def health(authorization: str | None = Header(None)):
            check(authorization)
            return {"ok": True}

        def voxels(img):
            """TRELLIS.2 → solid occupancy + colour on a 128 grid (z up)."""
            from scipy import ndimage
            mesh = self.pipe.run(img, seed=1, pipeline_type="512", preprocess_image=True)[0]
            coords = mesh.coords.long().cpu().numpy()  # surface voxels at 512
            res = int(round(1 / mesh.voxel_size))
            col = mesh.attrs[:, mesh.layout["base_color"]].float().clamp(0, 1).cpu().numpy() * 255
            R = 128
            c = (coords * R // res).clip(0, R - 1)
            occ = np.zeros((R, R, R), bool)
            occ[c[:, 0], c[:, 1], c[:, 2]] = True
            acc = np.zeros((R, R, R, 3), np.float32)
            cnt = np.zeros((R, R, R), np.float32)
            np.add.at(acc, (c[:, 0], c[:, 1], c[:, 2]), col)
            np.add.at(cnt, (c[:, 0], c[:, 1], c[:, 2]), 1)
            colg = acc / np.maximum(cnt, 1)[..., None]
            occ = ndimage.binary_closing(occ, iterations=1)
            occ = ndimage.binary_fill_holes(occ)
            return occ, colg

        @api.post("/shape")
        def shape(req: Req, authorization: str | None = Header(None)):
            import rembg
            check(authorization)
            t0 = time.time()
            img = Image.open(io.BytesIO(base64.b64decode(req.image))).convert("RGB")
            img = rembg.remove(img, session=self.rembg)  # RGBA with real alpha
            with torch.no_grad():
                occ, col = voxels(img)
            t1 = time.time()
            sizes = parse_sizes(req.sizes)
            studs = max(6, min(req.max_studs, 28))
            while True:
                bricks = shape_to_bricks(occ, col, req.palette, max_studs=studs, sizes=sizes, plates=req.plates)
                if len(bricks) <= req.max_bricks or studs <= 6:
                    break
                studs -= 2
            stats = {"seconds": round(time.time() - t0, 1), "model_s": round(t1 - t0, 1), "bricks": len(bricks), "studs": studs}
            print("trellis", stats, flush=True)
            return {"bricks": bricks, "stats": stats}

        return api


@app.cls(gpu="T4", image=image3d, scaledown_window=300, timeout=300,
         secrets=[modal.Secret.from_name("bouwboot-gpu")])
class Shaper:
    @modal.enter()
    def load(self):
        import rembg
        from tsr.system import TSR
        self.model = TSR.from_pretrained("stabilityai/TripoSR", config_name="config.yaml", weight_name="model.ckpt")
        self.model.renderer.set_chunk_size(65536)
        self.model.to("cuda")
        self.rembg = rembg.new_session()

    @modal.asgi_app()
    def web(self):
        import base64
        import hmac
        import io
        import time
        import numpy as np
        import torch
        from fastapi import FastAPI, Header, HTTPException
        from PIL import Image
        from pydantic import BaseModel
        from tsr.utils import remove_background, resize_foreground
        from shape3d import sample_grid, shape_to_bricks

        api = FastAPI()
        key = os.environ["BOUWBOOT_GPU_KEY"]

        class Req(BaseModel):
            image: str  # base64 PNG/JPEG
            palette: list[dict]  # [{id, hex}]
            max_studs: int = 16
            max_bricks: int = 450  # the build is made smaller until it fits
            sizes: list[str] | None = None  # e.g. ["2x4", "p1x2"]; None = all
            plates: bool = False

        def check(auth):
            if not auth or not hmac.compare_digest(auth, f"Bearer {key}"):
                raise HTTPException(401, "unauthorized")

        @api.get("/health")
        def health(authorization: str | None = Header(None)):
            check(authorization)
            return {"ok": True}

        @api.post("/shape")
        def shape(req: Req, authorization: str | None = Header(None)):
            check(authorization)
            t0 = time.time()
            img = Image.open(io.BytesIO(base64.b64decode(req.image))).convert("RGB")
            img = remove_background(img, self.rembg)
            img = resize_foreground(img, 0.85)
            a = np.array(img).astype(np.float32) / 255.0
            a = a[:, :, :3] * a[:, :, 3:4] + (1 - a[:, :, 3:4]) * 0.5
            img = Image.fromarray((a * 255.0).astype(np.uint8))
            with torch.no_grad():
                codes = self.model([img], device="cuda")
            occ, col = sample_grid(self.model, codes[0])
            t1 = time.time()
            sizes = parse_sizes(req.sizes)
            studs = max(6, min(req.max_studs, 28))
            while True:
                bricks = shape_to_bricks(occ, col, req.palette, max_studs=studs, sizes=sizes, plates=req.plates)
                if len(bricks) <= req.max_bricks or studs <= 6:
                    break
                studs -= 2
            stats = {"seconds": round(time.time() - t0, 1), "model_s": round(t1 - t0, 1), "bricks": len(bricks)}
            print("shape", stats, flush=True)
            return {"bricks": bricks, "stats": stats}

        return api


@app.cls(gpu="T4", scaledown_window=300, timeout=900,
         secrets=[modal.Secret.from_name("bouwboot-gpu")])
class Designer:
    @modal.enter()
    def load(self):
        self.engine = FastEngine()

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
                    dims = None
                    if req.allowed:
                        dims = set()
                        for s in req.allowed:
                            h, w = map(int, s.lower().split("x"))
                            dims.add((min(h, w), max(h, w)))
                    bricks, stats = eng.stream(req.caption, q.put, max(10, min(req.max_bricks, 1200)), dims)
                    print("generated", req.caption[:60], stats, flush=True)
                    q.put({"type": "done", "bricks": [l for l in bricks.to_txt().split("\n") if l.strip()], "stats": stats})
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
