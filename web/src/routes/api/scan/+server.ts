import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { scanPhoto } from '#lib/server/scan.ts';

export const POST: RequestHandler = async ({ request }) => {
	const fd = await request.formData();
	const f = fd.get('photo');
	if (!(f instanceof File) || f.size === 0) error(400, 'Geen foto ontvangen');
	if (f.size > 25e6) error(400, 'Foto is te groot');
	try {
		const items = await scanPhoto(Buffer.from(await f.arrayBuffer()));
		return json({ items });
	} catch (e: any) {
		error(500, 'Scannen mislukt: ' + (e?.message ?? e));
	}
};
