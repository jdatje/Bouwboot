import crypto from 'node:crypto';

export const COOKIE = 'bouwboot';

export function sessionToken(): string {
	const pw = process.env.APP_PASSWORD || '';
	return crypto.createHmac('sha256', 'bouwboot-sessie').update(pw).digest('hex');
}

export function checkPassword(input: string): boolean {
	const pw = process.env.APP_PASSWORD || '';
	const a = Buffer.from(crypto.createHash('sha256').update(input).digest('hex'));
	const b = Buffer.from(crypto.createHash('sha256').update(pw).digest('hex'));
	return pw.length > 0 && crypto.timingSafeEqual(a, b);
}
