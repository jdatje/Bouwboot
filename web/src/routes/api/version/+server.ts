import { json } from '@sveltejs/kit';
import { execSync } from 'node:child_process';

let commit = 'onbekend';
try {
	commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
} catch {}
const started = new Date().toISOString();

/** Which version is running (handy to check automatic updates). */
export const GET = () => json({ commit, started });
