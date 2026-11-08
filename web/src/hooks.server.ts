import type { Handle } from '@sveltejs/kit/hooks';
import { COOKIE, sessionToken } from '#lib/server/auth.ts';

const open = ['/login', '/api/login', '/api/version', '/favicon'];

export const handle: Handle = async ({ event, resolve }) => {
	const p = event.url.pathname;
	if (!process.env.APP_PASSWORD || open.some((o) => p.startsWith(o)) || event.cookies.get(COOKIE) === sessionToken())
		return resolve(event);
	if (p.startsWith('/api/')) return new Response('Niet ingelogd', { status: 401 });
	return new Response(null, { status: 303, headers: { location: '/login?terug=' + encodeURIComponent(p + event.url.search) } });
};
