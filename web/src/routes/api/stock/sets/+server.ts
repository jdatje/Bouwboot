import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { addSet } from '#lib/server/rebrickable.ts';

export const POST: RequestHandler = async ({ request }) => {
	const { set_num } = await request.json();
	if (!set_num || !/^[\w-]{2,20}$/.test(String(set_num).trim())) error(400, 'Ongeldig setnummer');
	try {
		return json(await addSet(String(set_num)));
	} catch (e: any) {
		error(400, e.message);
	}
};
