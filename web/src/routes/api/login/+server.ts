import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { COOKIE, checkPassword, sessionToken } from '#lib/server/auth.ts';

export const POST: RequestHandler = async ({ request, cookies, url }) => {
	const { password } = await request.json();
	if (!checkPassword(String(password ?? ''))) {
		await new Promise((r) => setTimeout(r, 700));
		return json({ ok: false }, { status: 401 });
	}
	cookies.set(COOKIE, sessionToken(), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		maxAge: 60 * 60 * 24 * 365
	});
	return json({ ok: true });
};
