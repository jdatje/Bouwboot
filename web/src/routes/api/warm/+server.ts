import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { warmUp } from '#lib/server/gpu.ts';

export const POST: RequestHandler = async () => {
	try { warmUp(); } catch {}
	return json({ ok: true });
};
