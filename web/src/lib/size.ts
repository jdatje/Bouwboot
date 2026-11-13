/** Size slider: 100 to 5000 pieces. Left half 100-800, right half 800-5000 (both logarithmic). */
export const MIN_PIECES = 100;
export const MID_PIECES = 800;
export const MAX_PIECES = 5000;
export const DEFAULT_PIECES = 200;
export const TICKS: [number, string][] = [[200, 'Klein'], [800, 'Middel'], [3000, 'Groot']];

export function posToPieces(p: number): number {
	const n = p <= 0.5 ? MIN_PIECES * (MID_PIECES / MIN_PIECES) ** (p / 0.5) : MID_PIECES * (MAX_PIECES / MID_PIECES) ** ((p - 0.5) / 0.5);
	const step = n < 300 ? 10 : n < 1000 ? 50 : 100;
	return Math.round(n / step) * step;
}

export function piecesToPos(n: number): number {
	n = clampPieces(n);
	return n <= MID_PIECES
		? 0.5 * Math.log(n / MIN_PIECES) / Math.log(MID_PIECES / MIN_PIECES)
		: 0.5 + 0.5 * Math.log(n / MID_PIECES) / Math.log(MAX_PIECES / MID_PIECES);
}

export function clampPieces(n: number): number {
	return Math.max(MIN_PIECES, Math.min(MAX_PIECES, Math.round(n) || DEFAULT_PIECES));
}

/** Old links used g=k|m|g. */
export function piecesFromParams(sp: { get(k: string): string | null }): number {
	const n = Number(sp.get('n'));
	if (n) return clampPieces(n);
	return ({ k: 200, m: 800, g: 3000 } as Record<string, number>)[sp.get('g') ?? ''] ?? DEFAULT_PIECES;
}

/** Target pieces → what the design steps need. */
export function sizeFor(pieces: number) {
	const n = clampPieces(pieces);
	const studs = Math.max(10, Math.min(64, Math.round(1.6 * Math.sqrt(n))));
	return { pieces: n, studs, voxels: Math.round(Math.min(30000, n * 12)), hollow: n > 300 };
}

const KEY = 'bouwboot.pieces';
export function loadPieces(): number {
	try { return clampPieces(Number(localStorage.getItem(KEY)) || DEFAULT_PIECES); } catch { return DEFAULT_PIECES; }
}
export function storePieces(n: number) {
	try { localStorage.setItem(KEY, String(n)); } catch {}
}
