import { json } from '@sveltejs/kit';
import { execSync } from 'node:child_process';
import { directAvailable } from '#lib/server/direct.ts';

let commit = 'onbekend';
try {
	commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
} catch {}
const started = new Date().toISOString();

/** Which version is running (handy to check automatic updates). */
export const GET = async () => json({ commit, started, direct: await directAvailable() });
