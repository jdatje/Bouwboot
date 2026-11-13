import { PALETTE, type Brick, type Color } from '#lib/bricks.ts';

const MODEL = () => process.env.GEMINI_MODEL || 'gemini-flash-latest';

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

/** Text keys in the order to try them: an optional free-tier key first, then the paid one. */
function keys(): string[] {
	return [process.env.GEMINI_FREE_API_KEY, process.env.GEMINI_API_KEY].filter(Boolean) as string[];
}

export async function gemini<T>(parts: Part[], schema: object | null, temperature = 0.7): Promise<T> {
	if (process.env.MOCK_GEMINI) return mock(parts) as T;
	const ks = keys();
	if (!ks.length) throw new Error('GEMINI_API_KEY ontbreekt');
	let lastErr: unknown;
	for (const [ki, key] of ks.entries()) {
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				const res = await fetch(
					`https://generativelanguage.googleapis.com/v1beta/models/${MODEL()}:generateContent`,
					{
						method: 'POST',
						headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
						body: JSON.stringify({
							contents: [{ role: 'user', parts }],
							generationConfig: {
								temperature,
								responseMimeType: 'application/json',
								...(schema ? { responseSchema: schema } : {})
							}
						})
					}
				);
				if (!res.ok) {
					lastErr = new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
					// free limit reached or key refused: move on to the next key straight away
					if ([401, 403, 429].includes(res.status) && ki < ks.length - 1) break;
					throw lastErr;
				}
				const j = await res.json();
				const text = j.candidates?.[0]?.content?.parts?.map((p: any) => (p.thought ? '' : p.text ?? '')).join('') ?? '';
				return JSON.parse(text) as T;
			} catch (e) {
				lastErr = e;
				await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
			}
		}
	}
	throw lastErr;
}

/** Dutch prompt → English geometric caption in BrickGPT's training style + a Dutch title. */
export async function toCaption(prompt: string, variation: number): Promise<{ caption: string; title: string; subject: string }> {
	return gemini(
		[
			{
				text: `You turn a (usually Dutch) request into a caption for a text-to-LEGO model.
The model was trained on captions that describe an object's 3D SHAPE plainly, e.g.
"Table featuring a flat rectangular surface over four evenly spaced legs." or
"A sofa with a long low seat, a tall backrest and two armrests."
Rules: one or two English sentences; describe the main body, parts, proportions and pose;
no colours, no materials, no story, no mention of LEGO. Simplify to shapes that fit a 20x20x20 block.
${variation > 0 ? `This is variation #${variation}: choose a noticeably different pose, proportion or style than the obvious one.` : ''}
Also give a short Dutch title (1-4 words, capitalised) for the build, and "subject": a short, unambiguous
English description of the thing itself for an illustrator (e.g. "a small motorboat", "a crocodile").
IMPORTANT: the request is Dutch unless it is clearly another language. Dutch words that look English
keep their Dutch meaning: "boot" = boat, "kat" = cat, "bank" = sofa/couch, "slang" = snake, "brand" = fire.

Request: ${prompt}`
			}
		],
		{
			type: 'object',
			properties: { caption: { type: 'string' }, title: { type: 'string' }, subject: { type: 'string' } },
			required: ['caption', 'title', 'subject']
		},
		variation > 0 ? 1.0 : 0.4
	);
}

/**
 * Colours a brick structure. Gemini assigns a palette colour to every brick index.
 * Coordinates: x and y horizontal (studs), z = layer (0 = bottom).
 */
export async function colorize(
	prompt: string,
	caption: string,
	bricks: Brick[],
	palette: Color[] = PALETTE,
	variation = 0
): Promise<number[]> {
	const list = bricks
		.map((b, i) => `${i}: ${b.h}x${b.w} at x=${b.x}..${b.x + b.h - 1} y=${b.y}..${b.y + b.w - 1} z=${b.z}`)
		.join('\n');
	const ext = (k: 'x' | 'y' | 'z') => {
		const lo = Math.min(...bricks.map((b) => b[k]));
		const hi = Math.max(...bricks.map((b) => b[k] + (k === 'x' ? b.h : k === 'y' ? b.w : 1) - 1));
		return `${lo}..${hi}`;
	};
	const pal = palette.map((c) => `${c.id} = ${c.name} (${c.hex})`).join('\n');
	const r = await gemini<{ groups: { color: number; bricks: number[] }[] }>(
		[
			{
				text: `You colour a LEGO model made of plain rectangular bricks so it looks like: "${prompt}".
Shape description: ${caption}
Bounding box: x ${ext('x')}, y ${ext('y')}, z ${ext('z')} (z is height, 0 = ground layer).
First work out which bricks form which part (head, body, legs, eyes, roof, wheels, ...), using
positions and the description. Then pick realistic, cheerful colours like an official LEGO set:
a main colour, a secondary colour and small accents (eyes, teeth, windows, details).
${variation > 0 ? `Variation #${variation}: choose a clearly different but still fitting colour scheme.` : ''}
Allowed colours (id = name):
${pal}

Bricks (index: size at position):
${list}

Answer with groups of brick indices per colour id. Every brick index must appear exactly once.`
			}
		],
		{
			type: 'object',
			properties: {
				groups: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							color: { type: 'integer' },
							bricks: { type: 'array', items: { type: 'integer' } }
						},
						required: ['color', 'bricks']
					}
				}
			},
			required: ['groups']
		},
		variation > 0 ? 1.0 : 0.5
	);
	const allowed = new Set(palette.map((c) => c.id));
	const out: number[] = new Array(bricks.length).fill(-1);
	for (const g of r.groups ?? []) {
		if (!allowed.has(g.color)) continue;
		for (const i of g.bricks) if (i >= 0 && i < out.length && out[i] === -1) out[i] = g.color;
	}
	// any brick that was left out takes the most used colour
	const counts = new Map<number, number>();
	for (const c of out) if (c >= 0) counts.set(c, (counts.get(c) ?? 0) + 1);
	const main = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? palette[0].id;
	return out.map((c) => (c >= 0 ? c : main));
}

export type Detection = { box: [number, number, number, number]; size: string; color: string };

/** Finds loose bricks on a photo. Boxes are [ymin, xmin, ymax, xmax] in 0..1000. */
export async function detectBricks(jpegBase64: string): Promise<Detection[]> {
	const names = PALETTE.map((c) => c.name).join(', ');
	const r = await gemini<{ bricks: Detection[] }>(
		[
			{ inline_data: { mime_type: 'image/jpeg', data: jpegBase64 } },
			{
				text: `This photo shows loose LEGO pieces spread out on a surface.
Detect EVERY separate LEGO piece. For each, give a tight bounding box as [ymin, xmin, ymax, xmax]
normalised to 0-1000, its stud size if it is a plain brick or plate (like "2x4", "1x2"; use "?" when
unsure or not a plain brick) and its colour as one of: ${names}.`
			}
		],
		{
			type: 'object',
			properties: {
				bricks: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							box: { type: 'array', items: { type: 'integer' } },
							size: { type: 'string' },
							color: { type: 'string' }
						},
						required: ['box', 'size', 'color']
					}
				}
			},
			required: ['bricks']
		},
		0.1
	);
	return (r.bricks ?? []).filter((d) => Array.isArray(d.box) && d.box.length === 4);
}

function mock(parts: Part[]): unknown {
	const text = parts.map((p) => ('text' in p ? p.text : '')).join('');
	if (text.includes('Suggest 3 different things'))
		return { ideas: [
			{ title: 'Brandweerauto', prompt: 'Een rode brandweerauto met een grijze ladder', why: 'Je hebt veel rode en grijze stenen.' },
			{ title: 'Krokodil', prompt: 'Een groene krokodil met witte tanden', why: 'Al dat groen is perfect voor een krokodil.' },
			{ title: 'Vuurtoren', prompt: 'Een rood-witte vuurtoren op een rots', why: 'Rood en wit, net als een echte vuurtoren.' }
		] };
	if (text.includes('Request:')) return { caption: 'A simple test object.', title: 'Testbouwwerk', subject: 'a test object' };
	if (text.includes('Bricks (index')) {
		const n = (text.match(/^\d+: /gm) ?? []).length;
		const ids = [4, 14, 1, 15];
		return { groups: ids.map((c, k) => ({ color: c, bricks: [...Array(n).keys()].filter((i) => i % 4 === k) })) };
	}
	return { bricks: [{ box: [100, 100, 300, 400], size: '2x4', color: 'Rood' }] };
}

/** Draws the requested thing as a simple toy on a white background (for the 3D route). Returns base64. */
export async function drawToy(prompt: string, variation: number, studs = 24): Promise<{ data: string; mime: string }> {
	if (process.env.MOCK_GEMINI) {
		const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
		return { data: png, mime: 'image/png' };
	}
	const key = process.env.GEMINI_API_KEY;
	if (!key) throw new Error('GEMINI_API_KEY ontbreekt');
	const text = `A small, simple LEGO model of: ${prompt}.
Built only from standard LEGO bricks, plates, slopes and tiles, about ${studs} studs long, so the
shapes are blocky and stepped like a real brick-built model (no smooth curves, no special parts,
no minifigures, no stickers, no baseplate). Use classic bright LEGO colours.
Show the whole model in a three-quarter view from slightly above, centred, on a flat, evenly lit,
solid pure green (#00FF00) background like a green screen, no shadow, no floor, no text.
If the model itself contains green, use a solid pure magenta (#FF00FF) background instead.${variation > 0 ? ` Variation #${variation}: a clearly different design or pose.` : ''}`;
	const models = [process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image', 'gemini-2.5-flash-image'];
	let last = '';
	for (const m of models) {
		// a small image is plenty for the 3D step and costs a third less; fall back if not supported
		for (const imageConfig of [{ aspectRatio: '1:1', imageSize: '512' }, { aspectRatio: '1:1' }]) {
			const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
				body: JSON.stringify({
					contents: [{ role: 'user', parts: [{ text }] }],
					generationConfig: { responseModalities: ['IMAGE'], imageConfig }
				})
			});
			if (res.status === 400) { last = `${m} 400`; continue; }
			if (!res.ok) { last = `${m} ${res.status}`; break; }
			const j = await res.json();
			for (const p of j.candidates?.[0]?.content?.parts ?? [])
				if (p.inlineData?.data) return { data: p.inlineData.data, mime: p.inlineData.mimeType ?? 'image/png' };
			last = `${m}: geen afbeelding`;
			break;
		}
	}
	throw new Error('Tekenen mislukt (' + last + ')');
}
