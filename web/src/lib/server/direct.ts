import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gemini } from '#lib/server/gemini.ts';
import type { ShapeBrick } from '#lib/server/gpu.ts';

/** Direct design: the language model writes a building program in stud coordinates (no drawing,
 *  no 3D model); gpu/direct.py turns that program into bricks, plates, slopes and tiles. */
const GPU_DIR = () => process.env.BOUWBOOT_PY_DIR || path.resolve(process.cwd(), '..', 'gpu');
const PY = () => process.env.PYTHON || 'python3';
const COLORS = ['white', 'black', 'light_grey', 'dark_grey', 'red', 'dark_red', 'orange', 'light_orange', 'yellow', 'lime',
	'bright_green', 'green', 'dark_green', 'olive', 'sand_green', 'azure', 'medium_blue', 'blue', 'dark_blue', 'light_pink',
	'pink', 'tan', 'dark_tan', 'nougat', 'brown', 'dark_brown'];

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
/** Is Python with numpy/scipy there (needed for the brick step)? Checked once. */
export function directAvailable(): Promise<boolean> {
	if (process.env.MOCK_DIRECT_FILE) return Promise.resolve(true);
	available ??= run(['-c', 'import numpy, scipy; import direct'], '', 20000).then(() => true, () => false);
	return available;
}

export type Program = { title?: string; plan?: string; size?: { w: number; d: number }; parts: object[] };

export async function designProgram(request: string, studs: number, variation: number): Promise<Program> {
	if (process.env.MOCK_DIRECT_FILE) return JSON.parse(readFileSync(process.env.MOCK_DIRECT_FILE, 'utf8'));
	const spec = readFileSync(path.join(GPU_DIR(), 'direct_prompt.txt'), 'utf8')
		.replace('__STUDS__', String(studs)).replace('__COLORS__', COLORS.join(', '));
	const prog = await gemini<Program>(
		[{ text: spec + '\n\nDesign: ' + request + (variation > 0 ? `\n(Variation ${variation}: make a clearly different design than the obvious one.)` : '') }],
		null, variation > 0 ? 1.0 : 0.7);
	if (!Array.isArray(prog?.parts) || !prog.parts.length) throw new Error('Het ontwerp was leeg');
	return prog;
}

export async function programToBricks(program: Program, sizes: string[] | null): Promise<ShapeBrick[]> {
	const out = JSON.parse(await run(['direct_cli.py'], JSON.stringify({ program, sizes }), 60000));
	if (out.error) throw new Error(out.error);
	return out.bricks;
}
