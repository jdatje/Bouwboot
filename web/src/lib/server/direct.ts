import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gemini } from '#lib/server/gemini.ts';
import type { ShapeBrick } from '#lib/server/gpu.ts';

/** Direct design: the language model writes a building program in stud coordinates (no drawing,
 *  no 3D model); gpu/direct.py turns that program into bricks, plates, slopes and tiles. */
const GPU_DIR = () => process.env.BOUWBOOT_PY_DIR || path.resolve(process.cwd(), '..', 'gpu');
const PY = () => process.env.PYTHON || 'python3';
// same names and ids as gpu/direct.py
export const COLOR_NAMES: [string, number][] = [['white', 15], ['black', 0], ['light_grey', 71], ['dark_grey', 72], ['red', 4],
	['dark_red', 320], ['orange', 25], ['light_orange', 191], ['yellow', 14], ['lime', 27], ['bright_green', 10], ['green', 2],
	['dark_green', 288], ['olive', 326], ['sand_green', 378], ['azure', 322], ['medium_blue', 73], ['blue', 1], ['dark_blue', 272],
	['light_pink', 29], ['pink', 5], ['tan', 19], ['dark_tan', 28], ['nougat', 92], ['brown', 70], ['dark_brown', 308]];

function run(args: string[], input: string, timeoutMs: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const p = spawn(PY(), args, { cwd: GPU_DIR() });
		let out = '', err = '';
		const t = setTimeout(() => { p.kill(); reject(new Error('bouwstap duurde te lang')); }, timeoutMs);
		p.stdout.on('data', (d) => (out += d));
		p.stderr.on('data', (d) => (err += d));
		p.on('error', (e) => { clearTimeout(t); reject(e); });
		p.on('close', (code) => { clearTimeout(t); code === 0 ? resolve(out) : reject(new Error(err.slice(-300) || 'python ' + code)); });
		p.stdin.end(input);
	});
}

let available: Promise<boolean> | null = null;
let checkedAt = 0;
/** Is Python with numpy/scipy there (needed for the brick step)? A "no" is checked again after a minute. */
export function directAvailable(): Promise<boolean> {
	if (process.env.MOCK_DIRECT_FILE) return Promise.resolve(true);
	if (!available || Date.now() - checkedAt > 60_000) {
		checkedAt = Date.now();
		const prev = available;
		available = (prev ?? Promise.resolve(false)).then((ok) =>
			ok ? true : run(['-c', 'import numpy, scipy; import direct'], '', 20000).then(() => true, () => false));
	}
	return available;
}

export type Program = { title?: string; plan?: string; size?: { w: number; d: number }; parts: object[] };

export async function designProgram(request: string, studs: number, pieces: number, variation: number, colorIds?: number[]): Promise<Program> {
	if (process.env.MOCK_DIRECT_FILE) {
		await new Promise((r) => setTimeout(r, Number(process.env.MOCK_DIRECT_DELAY) || 0));
		return JSON.parse(readFileSync(process.env.MOCK_DIRECT_FILE, 'utf8'));
	}
	let names = COLOR_NAMES.filter(([, id]) => !colorIds || colorIds.includes(id)).map(([n]) => n);
	if (!names.length) names = COLOR_NAMES.map(([n]) => n);
	const spec = readFileSync(path.join(GPU_DIR(), 'direct_prompt.txt'), 'utf8')
		.replace('__STUDS__', String(studs)).replace('__PIECES__', String(pieces)).replace('__COLORS__', names.join(', '));
	const prog = await gemini<Program>(
		[{ text: spec + '\n\nDesign: ' + request + (variation > 0 ? `\n(Variation ${variation}: make a clearly different design than the obvious one.)` : '') }],
		null, variation > 0 ? 1.0 : 0.7);
	if (!Array.isArray(prog?.parts) || !prog.parts.length) throw new Error('Het ontwerp was leeg');
	return prog;
}

export async function programToBricks(program: Program, sizes: string[] | null, target?: number): Promise<ShapeBrick[]> {
	const out = JSON.parse(await run(['direct_cli.py'], JSON.stringify({ program, sizes, target: target ?? null }), 60000));
	if (out.error) throw new Error(out.error);
	return out.bricks;
}
