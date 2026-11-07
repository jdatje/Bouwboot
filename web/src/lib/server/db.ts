import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { Brick } from '#lib/bricks.ts';

const dir = process.env.DATA_DIR || './data';
fs.mkdirSync(dir, { recursive: true });
export const db = new Database(path.join(dir, 'bouwboot.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS builds (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  title TEXT NOT NULL,
  caption TEXT NOT NULL,
  seed INTEGER NOT NULL,
  only_mine INTEGER NOT NULL DEFAULT 0,
  bricks TEXT NOT NULL,              -- JSON Brick[] (with colour c)
  saved INTEGER NOT NULL DEFAULT 0,
  assembled INTEGER NOT NULL DEFAULT 0,
  order_status TEXT,                 -- null | 'besteld' | 'binnen'
  order_list TEXT,                   -- JSON [{part,color,qty,received}]
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sets (
  set_num TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  img TEXT,
  num_parts INTEGER,
  assembled INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL
);
-- every brick we own, with where it came from: 'set:<num>', 'scan', 'manual', 'order:<build id>'
CREATE TABLE IF NOT EXISTS stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part TEXT NOT NULL,
  color INTEGER NOT NULL,
  qty INTEGER NOT NULL,
  source TEXT NOT NULL,
  added_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS stock_pc ON stock(part, color);
CREATE TABLE IF NOT EXISTS lost (
  part TEXT NOT NULL,
  color INTEGER NOT NULL,
  qty INTEGER NOT NULL,
  PRIMARY KEY (part, color)
);
CREATE TABLE IF NOT EXISTS parts (
  part TEXT PRIMARY KEY,
  name TEXT,
  img TEXT
);
CREATE TABLE IF NOT EXISTS colors (
  id INTEGER PRIMARY KEY,
  name TEXT,
  hex TEXT,
  bl INTEGER
);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
`);
try { db.exec('ALTER TABLE builds ADD COLUMN thumb TEXT'); } catch {}

export type BuildRow = {
	id: string;
	prompt: string;
	title: string;
	caption: string;
	seed: number;
	only_mine: number;
	bricks: string;
	saved: number;
	assembled: number;
	order_status: string | null;
	order_list: string | null;
	created_at: number;
	thumb: string | null;
};

export type Build = Omit<BuildRow, 'bricks' | 'order_list'> & {
	bricks: Brick[];
	order_list: OrderLine[] | null;
};
export type OrderLine = { part: string; color: number; qty: number; received: boolean };

export function getBuild(id: string): Build | null {
	const r = db.prepare('SELECT * FROM builds WHERE id = ?').get(id) as BuildRow | undefined;
	if (!r) return null;
	return { ...r, bricks: JSON.parse(r.bricks), order_list: r.order_list ? JSON.parse(r.order_list) : null };
}

export function newId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Drafts that were never saved are cleaned up after a week.
db.prepare('DELETE FROM builds WHERE saved = 0 AND created_at < ?').run(Date.now() - 7 * 864e5);
