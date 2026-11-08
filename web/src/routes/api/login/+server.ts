import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { COOKIE, checkPassword, sessionToken } from '#lib/server/auth.ts';

export const POST: RequestHandler = async ({ request, cookies }) => {
	const { password } = await request.json();
	if (!checkPassword(String(password ?? ''))) {
		await new Promise((r) => setTimeout(r, 700));
		return json({ ok: false }, { status: 401 });
	}
	cookies.set(COOKIE, sessionToken(), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		// the browser's own Origin tells whether the page is on https (behind Tailscale) or plain http (LAN)
		secure: (request.headers.get('origin') ?? '').startsWith('https:'),
		maxAge: 60 * 60 * 24 * 365
	});
	return json({ ok: true });
};
