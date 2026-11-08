import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { scanPhoto } from '#lib/server/scan.ts';

export const POST: RequestHandler = async ({ request }) => {
	const { photo } = await request.json().catch(() => ({}));
	if (typeof photo !== 'string' || !photo) error(400, 'Geen foto ontvangen');
	const buf = Buffer.from(photo, 'base64');
	if (buf.length > 25e6) error(400, 'Foto is te groot');
	try {
		const items = await scanPhoto(buf);
		return json({ items });
	} catch (e: any) {
		error(500, 'Scannen mislukt: ' + (e?.message ?? e));
	}
};
