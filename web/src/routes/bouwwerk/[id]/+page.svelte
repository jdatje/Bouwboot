<script lang="ts">
	import { piecesFromParams } from '#lib/size.ts';
	import { page } from '$app/state';
	import { goto, replaceState } from '$app/navigation';
	import { onMount, untrack } from 'svelte';
	import TopBar from '#lib/components/TopBar.svelte';
	import Viewer from '#lib/components/Viewer.svelte';
	import PartIcon from '#lib/components/PartIcon.svelte';
	import { BrickScene, RAW } from '#lib/scene.ts';
	import { PALETTE_BY_ID, partInfo, partLabel, countParts, makeSteps, parseBrick, type Brick } from '#lib/bricks.ts';

	type Info = {
		build: {
			id: string; prompt: string; title: string; caption: string; bricks: Brick[]; saved: number;
			assembled: number; only_mine: number; order_status: string | null; engine: string | null; sketch: string | null;
			order_list: { part: string; color: number; qty: number; received: boolean }[] | null;
		};
		coverage: { have: number; total: number; missing: { part: string; color: number; qty: number }[] };
		teardown?: string[];
		colors: Record<string, { id: number; name: string; hex: string; bl: number }>;
	};

	let scene = $state<BrickScene | null>(null);
	let info = $state<Info | null>(null);
	let phase = $state<'idle' | 'thinking' | 'building' | 'painting' | 'done' | 'error'>('idle');
	let message = $state('');
	let liveTitle = $state('');
	let sketch = $state<string | null>(null);
	let liveEngine = $state('direct');
	let liveCount = $state(0);
	let kid = $state(false);
	let step = $state(0);
	let tab = $state<'bouwen' | 'kopen'>('bouwen');
	let busy = $state('');
	let received = $state<Set<number>>(new Set());
	let startedKey = '';
	let abort: AbortController | null = null;

	const q = $derived(page.url.searchParams.get('q') ?? info?.build.prompt ?? '');
	const mine = $derived(page.url.searchParams.get('mijn') === '1' || !!info?.build.only_mine);
	const hex = (c?: number) => (c === undefined ? RAW : (info?.colors[c]?.hex ?? PALETTE_BY_ID.get(c)?.hex ?? '#999'));
	const cname = (c: number) => info?.colors[c]?.name ?? PALETTE_BY_ID.get(c)?.name ?? `Kleur ${c}`;
	const pname = (p: string) => partLabel(p);

	const steps = $derived(info ? makeSteps(info.build.bricks, kid ? 1 : 2, kid ? 3 : 5) : []);
	const stepParts = $derived.by(() => {
		if (!info) return [];
		const idx = step === 0 ? info.build.bricks.map((_, i) => i) : (steps[step - 1] ?? []);
		return countParts(idx.map((i) => info!.build.bricks[i]));
	});

	onMount(() => {
		try { kid = localStorage.getItem('bb-kind') === '1'; } catch {}
	});
	function setKid(v: boolean) {
		kid = v;
		goStep(0);
		try { localStorage.setItem('bb-kind', v ? '1' : '0'); } catch {}
	}

	// start a new design or load a saved one whenever the URL asks for it
	$effect(() => {
		const id = page.url.pathname.split('/')[2];
		const key = page.url.pathname + page.url.search;
		if (!scene || key === startedKey) return;
		startedKey = key;
		untrack(() => (id === 'nieuw' ? design() : load(id!)));
	});

	async function load(id: string) {
		phase = 'idle';
		const r = await fetch(`/api/builds/${id}`);
		if (!r.ok) { phase = 'error'; message = 'Dit bouwwerk bestaat niet (meer).'; return; }
		info = await r.json();
		sketch = info!.build.sketch;
		step = 0;
		phase = 'done';
		scene!.setBricks(info!.build.bricks, (b) => hex(b.c));
		scene!.refit();
		scene!.fit(true);
		scene!.setAutoRotate(false);
	}

	async function design() {
		abort?.abort();
		abort = new AbortController();
		const prompt = page.url.searchParams.get('q') ?? '';
		const variation = Number(page.url.searchParams.get('v') ?? 0);
		info = null; step = 0; tab = 'bouwen'; sketch = null;
		phase = 'thinking'; message = ''; liveTitle = ''; liveCount = 0;
		scene!.clear();
		scene!.centreOn([{ h: 1, w: 1, x: 9, y: 9, z: 0 }]);
		scene!.refit();
		scene!.setAutoRotate(true);
		const live: Brick[] = [];
		try {
			const res = await fetch('/api/design', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ prompt, onlyMine: page.url.searchParams.get('mijn') === '1', variation, engine: page.url.searchParams.get('m') ?? undefined, pieces: piecesFromParams(page.url.searchParams), withAssembled: page.url.searchParams.get('ib') === '1' }),
				signal: abort.signal
			});
			if (!res.ok || !res.body) throw new Error(res.status === 401 ? 'Je bent niet (meer) ingelogd.' : 'De server reageert niet.');
			const reader = res.body.getReader();
			const dec = new TextDecoder();
			let buf = '';
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buf += dec.decode(value, { stream: true });
				let i;
				while ((i = buf.indexOf('\n\n')) >= 0) {
					const line = buf.slice(0, i);
					buf = buf.slice(i + 2);
					if (!line.startsWith('data: ')) continue;
					const ev = JSON.parse(line.slice(6));
					if (ev.type === 'caption') { liveTitle = ev.title; phase = 'building'; }
					else if (ev.type === 'sketch') { sketch = ev.image; }
					else if (ev.type === 'engine') { liveEngine = ev.engine; }
					else if (ev.type === 'brick') {
						const b: Brick | null = ev.o ?? parseBrick(ev.b);
						if (b) { live.push(b); scene!.add(b); liveCount = live.length; }
					} else if (ev.type === 'rollback') {
						live.length = ev.keep; scene!.truncate(ev.keep); liveCount = live.length;
					} else if (ev.type === 'final') {
						phase = 'painting';
					} else if (ev.type === 'colors') {
						scene!.paint(ev.colors.map((c: number) => PALETTE_BY_ID.get(c)?.hex ?? '#999'));
					} else if (ev.type === 'saved') {
						const r = await fetch(`/api/builds/${ev.id}`);
						info = await r.json();
						phase = 'done';
						scene!.setAutoRotate(false);
						startedKey = `/bouwwerk/${ev.id}`;
						replaceState(`/bouwwerk/${ev.id}`, {});
					} else if (ev.type === 'error') {
						throw new Error(ev.message);
					}
				}
			}
			if (phase !== 'done') throw new Error('De verbinding werd onderbroken. Probeer het nog eens.');
		} catch (e: any) {
			if (e?.name === 'AbortError') return;
			phase = 'error';
			message = e?.message ?? String(e);
			scene?.setAutoRotate(false);
		}
	}

	function goStep(n: number) {
		if (!info || !scene) return;
		step = Math.max(0, Math.min(steps.length, n));
		if (step === 0) {
			scene.showOnly(new Set(info.build.bricks.map((_, i) => i)), new Set());
		} else {
			const vis = new Set(steps.slice(0, step).flat());
			scene.showOnly(vis, new Set(steps[step - 1]));
		}
	}

	const engine = $derived(info?.build.engine ?? page.url.searchParams.get('m') ?? 'direct');
	const ENGINES: [string, string][] = [['direct', 'Direct in stenen'], ['trellis', 'Via tekening (TRELLIS)']];
	function reshape(other: string | false = false) {
		const v = Number(page.url.searchParams.get('v') ?? 0) + 1;
		const m = other || engine;
		goto(`/bouwwerk/nieuw?q=${encodeURIComponent(q)}${mine ? '&mijn=1' : ''}&v=${v}&m=${m}&n=${piecesFromParams(page.url.searchParams)}${page.url.searchParams.get('ib') === '1' ? '&ib=1' : ''}&t=${Date.now()}`);
	}

	let recolorN = 1;
	async function recolor() {
		if (!info) return;
		busy = 'kleuren';
		try {
			const r = await fetch(`/api/builds/${info.build.id}/recolor`, {
				method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ variation: recolorN++ })
			});
			if (!r.ok) throw new Error();
			info = await r.json();
			goStep(0);
			scene!.paint(info!.build.bricks.map((b) => hex(b.c)));
		} catch { alert('Nieuwe kleuren kiezen lukte niet. Probeer het nog eens.'); }
		busy = '';
	}

	async function patch(body: object) {
		const r = await fetch(`/api/builds/${info!.build.id}`, {
			method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
		});
		if (r.ok) info = await r.json();
	}

	async function save() {
		if (!info || !scene) return;
		busy = 'opslaan';
		goStep(0);
		scene.refit();
		scene.fit(true);
		const thumb = scene.capture(480, 360);
		await patch({ saved: true, thumb });
		busy = '';
	}

	async function remove() {
		if (!info || !confirm(`"${info.build.title}" verwijderen?`)) return;
		await fetch(`/api/builds/${info.build.id}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: '{}' });
		goto('/bouwwerken');
	}

	async function order(cancel = false) {
		busy = 'bestellen';
		const r = await fetch(`/api/builds/${info!.build.id}/order`, { method: cancel ? 'DELETE' : 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
		if (r.ok) info = await r.json();
		busy = '';
	}

	async function markReceived(all: boolean) {
		const lines = all ? info!.build.order_list!.map((_, i) => i) : [...received];
		if (!lines.length) return;
		busy = 'binnen';
		const r = await fetch(`/api/builds/${info!.build.id}/received`, {
			method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lines })
		});
		if (r.ok) info = await r.json();
		received = new Set();
		busy = '';
	}

	function replay() {
		goStep(0);
		scene?.replay(Math.min(9000, 60 * (info?.build.bricks.length ?? 60)));
	}

	// funny messages while waiting; a new one every few seconds, in random order
	const WAIT = [
		'Even nadenken over de vorm…', 'Stenen tellen… 1, 2, 3… veel!', 'Op zoek naar dat ene rode steentje…',
		'Au! Op een steen gestapt…', 'De bouwrobot drinkt even limonade…', 'Stenen sorteren op kleur…',
		'Handleiding ondersteboven gehouden…', 'Even vragen aan de bouwkabouters…', 'Noppen poetsen…',
		'Nog één steentje… nee, toch twee…', 'Even onder de bank kijken…', 'De doos is groter dan gedacht…',
		'Plannetje tekenen op een servetje…', 'Wie heeft de 1x1 verstopt?', 'Bijna… de robot moest even niezen…',
		'Stenen uit de stofzuiger halen…', 'Hmm, waar komt dit stukje?', 'Opwarmen met wat strekoefeningen…'
	];
	let waitIdx = $state(0);
	const waiting = $derived(phase === 'thinking' || (phase === 'building' && liveCount === 0));
	$effect(() => {
		if (!waiting) return;
		waitIdx = 0;
		const order = [0, ...WAIT.slice(1).map((_, i) => i + 1).sort(() => Math.random() - 0.5)];
		let k = 0;
		const t = setInterval(() => { k = (k + 1) % order.length; waitIdx = order[k]; }, 3500);
		return () => clearInterval(t);
	});

	const statusText = $derived(
		phase === 'thinking' || (phase === 'building' && liveCount === 0 && liveEngine === 'direct') ? WAIT[waitIdx]
		: phase === 'building' && liveCount === 0 ? WAIT[waitIdx]
		: phase === 'building' ? `Bouwen… ${liveCount} onderdelen`
		: phase === 'painting' ? 'Kleuren kiezen…'
		: ''
	);
</script>

<svelte:head><title>{info?.build.title ?? liveTitle ?? 'Bouwen'} · Bouwboot</title></svelte:head>

<TopBar {q} onlyMine={mine} pieces={page.url.searchParams.has('n') || page.url.searchParams.has('g') ? piecesFromParams(page.url.searchParams) : 0} />

<main class:kid>
	<section class="stage">
		<div class="view card">
			<Viewer bind:scene />
			{#if phase !== 'done' && phase !== 'idle'}
				<div class="status" class:err={phase === 'error'}>
					{#if phase === 'error'}
						<p>{message}</p>
						<button class="primary" onclick={() => { startedKey = ''; design(); }}>Opnieuw proberen</button>
					{:else}
						<span class="dot"></span>{statusText}
					{/if}
				</div>
			{/if}
			{#if sketch && step === 0}
				<img class="sketch" src={sketch} alt="Schets" title="De schets waar dit bouwwerk op is gebaseerd" />
			{/if}
			{#if phase === 'done' && step === 0}
				<button class="replay" onclick={replay} title="Opnieuw afspelen">▶ Afspelen</button>
			{/if}
			{#if info && step > 0}
				<div class="overlay">
					<button class="nav" onclick={() => goStep(step - 1)} aria-label="Vorige">◀</button>
					<div class="oparts">
						<b>{step}/{steps.length}</b>
						{#each stepParts as p}<span><PartIcon part={p.part} hex={hex(p.color)} px={kid ? 14 : 10} />{p.qty}×</span>{/each}
					</div>
					<button class="nav primary" onclick={() => goStep(step + 1)} disabled={step === steps.length} aria-label="Volgende">▶</button>
				</div>
			{/if}
		</div>
		<div class="headline">
			<h1>{info?.build.title ?? liveTitle ?? ''}</h1>
			{#if info}
				<p class="muted small">{info.build.bricks.length} onderdelen · “{info.build.prompt}”</p>
			{/if}
		</div>
		{#if info}
			<div class="actions">
				<button onclick={() => reshape()} disabled={!!busy}>Andere vorm</button>
				<button onclick={recolor} disabled={!!busy}>{busy === 'kleuren' ? 'Kleuren kiezen…' : 'Andere kleuren'}</button>
				{#if info.build.saved}
					<button disabled>Bewaard ✓</button>
				{:else}
					<button onclick={save} disabled={!!busy}>{busy === 'opslaan' ? 'Bewaren…' : 'Bewaar'}</button>
				{/if}
				<button class="red" onclick={() => { tab = 'kopen'; goStep(0); document.querySelector('.panel')?.scrollIntoView({ behavior: 'smooth' }); }}>Koop stenen</button>
			</div>
			<p class="have">
				{#if info.coverage.have === info.coverage.total}
					Je hebt alle {info.coverage.total} onderdelen al in huis!
				{:else}
					Je hebt al <b>{info.coverage.have}</b> van de {info.coverage.total} onderdelen.
				{/if}
				{#if info.teardown?.length}
					<br />Haal eerst uit elkaar: <b>{info.teardown.join(', ')}</b>
				{/if}
			</p>
			{#if info.build.saved}
				<div class="saved-row">
					<label class="switch">
						<input type="checkbox" checked={!!info.build.assembled} onchange={(e) => patch({ assembled: e.currentTarget.checked })} />
						<span>Staat in elkaar <small class="muted">(stenen zijn in gebruik)</small></span>
					</label>
					<button class="link" onclick={remove}>Verwijderen</button>
				</div>
			{/if}
			<p class="small muted method">
				Bouwmethode:
				{#each ENGINES as [id, label], i}
					{#if i}·{/if}
					{#if id === engine}<b>{label}</b>{:else}<button class="link plain" onclick={() => reshape(id)} disabled={!!busy}>{label}</button>{/if}
				{/each}
			</p>
		{/if}
	</section>

	{#if info}
		<aside class="card panel">
			<div class="tabs">
				<button class:on={tab === 'bouwen'} onclick={() => (tab = 'bouwen')}>Bouwinstructies</button>
				<button class:on={tab === 'kopen'} onclick={() => { tab = 'kopen'; goStep(0); }}>
					Stenen kopen {#if info.build.order_status === 'besteld'}<span class="chip">besteld</span>{/if}
				</button>
			</div>

			{#if tab === 'bouwen'}
				<div class="kidrow">
					<label class="switch">
						<input type="checkbox" checked={kid} onchange={(e) => setKid(e.currentTarget.checked)} />
						<span>Kindermodus</span>
					</label>
					<a class="print" href="/bouwwerk/{info.build.id}/print{kid ? '?kind=1' : ''}" target="_blank">Afdrukken</a>
				</div>

				<div class="stepnav">
					<button class="nav" onclick={() => goStep(step - 1)} disabled={step === 0} aria-label="Vorige stap">◀</button>
					<div class="stepno">
						{#if step === 0}
							<b>{kid ? 'Klaar?' : 'Overzicht'}</b>
							<small class="muted">{steps.length} stappen</small>
						{:else}
							<b>{step}</b><small class="muted">van {steps.length}</small>
						{/if}
					</div>
					<button class="nav primary" onclick={() => goStep(step + 1)} disabled={step === steps.length} aria-label="Volgende stap">▶</button>
				</div>
				<input class="slider" type="range" min="0" max={steps.length} value={step} oninput={(e) => goStep(Number(e.currentTarget.value))} aria-label="Stap" />

				<div class="parts">
					{#if step === 0}<p class="muted small">{kid ? 'Zoek deze stenen bij elkaar:' : 'Alle onderdelen:'}</p>{/if}
					{#each stepParts as p}
						<div class="part">
							<PartIcon part={p.part} hex={hex(p.color)} px={kid ? 18 : 12} />
							<span class="qty">{p.qty}×</span>
							{#if !kid}<span class="pname">{pname(p.part)} <small class="muted">{cname(p.color)}</small></span>{/if}
						</div>
					{/each}
				</div>
				{#if step === 0}
					<button class="primary big" onclick={() => goStep(1)}>{kid ? 'Start! ▶' : 'Begin met bouwen ▶'}</button>
				{:else if step === steps.length}
					<p class="done">Klaar! 🎉</p>
				{/if}
			{:else}
				<div class="buy">
					{#if info.build.order_status === 'besteld' && info.build.order_list}
						<p><b>Besteld.</b> Vink aan wat er binnen is; het gaat dan direct je magazijn in.</p>
						<ul class="order">
							{#each info.build.order_list as l, i}
								<li class:got={l.received}>
									<label>
										<input type="checkbox" disabled={l.received} checked={l.received || received.has(i)}
											onchange={(e) => { const s = new Set(received); e.currentTarget.checked ? s.add(i) : s.delete(i); received = s; }} />
										<PartIcon part={l.part} hex={hex(l.color)} />
										<span>{l.qty}× {pname(l.part)} <small class="muted">{cname(l.color)}</small></span>
									</label>
								</li>
							{/each}
						</ul>
						<div class="row">
							<button class="primary" onclick={() => markReceived(true)} disabled={!!busy}>Alles is binnen</button>
							<button onclick={() => markReceived(false)} disabled={!!busy || !received.size}>Aangevinkte zijn binnen</button>
						</div>
						<p class="small"><a href="/api/builds/{info.build.id}/bricklink.xml">Bestellijst opnieuw downloaden</a> · <button class="link" onclick={() => order(true)}>Bestelling annuleren</button></p>
					{:else if info.build.order_status === 'binnen'}
						<p><b>Alles is binnen</b> en staat in je magazijn. Veel bouwplezier!</p>
					{:else if info.coverage.missing.length === 0}
						<p>Je hebt alle onderdelen al. Niks te kopen!</p>
					{:else}
						<p>Je mist nog <b>{info.coverage.total - info.coverage.have}</b> onderdelen:</p>
						<ul class="order">
							{#each info.coverage.missing as l}
								<li><PartIcon part={l.part} hex={hex(l.color)} /> <span>{l.qty}× {pname(l.part)} <small class="muted">{cname(l.color)}</small></span></li>
							{/each}
						</ul>
						<ol class="howto">
							<li><a class="btnlink" href="/api/builds/{info.build.id}/bricklink.xml" download>Download de bestellijst</a></li>
							<li>
								<a class="btnlink" href="https://www.bricklink.com/v2/wanted/upload.page" target="_blank" rel="noopener">Open BrickLink</a>
								<small class="muted">Kies het bestand, maak er een nieuwe Wanted List van en klik daarna op <i>Easy Buy</i>.</small>
							</li>
							<li><button class="primary" onclick={() => order()} disabled={!!busy}>Ik heb besteld</button></li>
						</ol>
					{/if}
				</div>
			{/if}
		</aside>
	{/if}
</main>

<style>
	main { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 1.2rem; padding: 0 1.2rem 2rem; max-width: 1400px; margin: 0 auto; }
	.stage { min-width: 0; }
	.view { position: relative; height: min(68vh, 680px); padding: 0; overflow: hidden; }
	.status { position: absolute; left: 50%; bottom: 1rem; transform: translateX(-50%); background: rgba(255,255,255,.92); padding: 0.6rem 1rem; border-radius: 999px; font-weight: 600; display: flex; align-items: center; gap: 0.6rem; box-shadow: 0 2px 10px rgba(0,0,0,.08); }
	.status.err { border-radius: 16px; flex-direction: column; text-align: center; max-width: 90%; }
	.status.err p { margin: 0; color: #a10c0e; }
	.dot { width: 10px; height: 10px; border-radius: 50%; background: #ffcf00; animation: pulse 0.9s infinite alternate; }
	@keyframes pulse { to { transform: scale(1.6); background: #d01012; } }
	.overlay { position: absolute; left: 0.6rem; right: 0.6rem; bottom: 0.6rem; display: flex; align-items: center; gap: 0.5rem; }
	.overlay .nav { width: 58px; height: 52px; font-size: 1.3rem; box-shadow: 0 2px 8px rgba(0,0,0,.12); }
	.overlay .nav:not(.primary) { background: rgba(255,255,255,.95); }
	.oparts { flex: 1; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 0.35rem 0.7rem; background: rgba(255,255,255,.92); border-radius: 14px; padding: 0.4rem 0.6rem; min-height: 52px; font-weight: 700; }
	.oparts span { display: inline-flex; align-items: center; gap: 0.25rem; }
	.sketch { position: absolute; left: 0.8rem; top: 0.8rem; width: 110px; height: 110px; object-fit: contain; background: white; border-radius: 14px; box-shadow: 0 2px 10px rgba(0,0,0,.12); }
	.method { margin-top: 1rem; }
	button.link.plain { color: #0a5bd3; font-weight: 500; }
	.replay { position: absolute; right: 0.8rem; bottom: 0.8rem; background: rgba(255,255,255,.9); }
	.headline h1 { margin: 0.9rem 0 0.1rem; font-size: 1.7rem; }
	.small { font-size: 0.88rem; }
	.actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.8rem; }
	.have { margin: 0.8rem 0 0; }
	.saved-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-top: 0.8rem; }
	.switch { display: inline-flex; align-items: center; gap: 0.5rem; cursor: pointer; }
	.switch input { width: 1.15rem; height: 1.15rem; accent-color: #d01012; }
	button.link { background: none; padding: 0; color: #a10c0e; font-weight: 500; text-decoration: underline; }
	.panel { padding: 1rem; align-self: start; position: sticky; top: 1rem; }
	.tabs { display: flex; gap: 0.3rem; background: #eef1f5; padding: 0.25rem; border-radius: 14px; margin-bottom: 0.9rem; }
	.tabs button { flex: 1; background: none; padding: 0.55em 0.4em; font-size: 0.95rem; }
	.tabs button.on { background: white; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
	.chip { background: #ffcf00; border-radius: 999px; padding: 0 0.45em; font-size: 0.75rem; margin-left: 0.2rem; }
	.kidrow { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.8rem; }
	.print { font-size: 0.9rem; }
	.stepnav { display: flex; align-items: center; gap: 0.6rem; }
	.stepnav .nav { width: 64px; height: 56px; font-size: 1.4rem; border-radius: 16px; }
	.stepno { flex: 1; display: flex; flex-direction: column; align-items: center; line-height: 1.1; }
	.stepno b { font-size: 1.6rem; }
	.slider { width: 100%; margin: 0.8rem 0 0.4rem; accent-color: #d01012; }
	.parts { display: flex; flex-direction: column; gap: 0.45rem; margin: 0.6rem 0 1rem; max-height: 46vh; overflow: auto; }
	.part { display: flex; align-items: center; gap: 0.6rem; }
	.qty { font-weight: 800; min-width: 2.4em; text-align: right; }
	.big { width: 100%; padding: 0.9rem; font-size: 1.05rem; }
	.done { text-align: center; font-size: 1.3rem; font-weight: 800; }
	.buy p { margin: 0 0 0.6rem; }
	.order { list-style: none; padding: 0; margin: 0 0 1rem; display: flex; flex-direction: column; gap: 0.45rem; max-height: 40vh; overflow: auto; }
	.order li, .order label { display: flex; align-items: center; gap: 0.6rem; }
	.order li.got { opacity: 0.5; }
	.howto { padding-left: 1.2rem; display: flex; flex-direction: column; gap: 0.8rem; }
	.howto small { display: block; margin-top: 0.3rem; }
	.btnlink { display: inline-block; background: #e9edf2; color: #1d2330; text-decoration: none; padding: 0.6em 1em; border-radius: 14px; font-weight: 600; }
	.row { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.6rem; }

	/* kid mode: big and simple */
	.kid .stepnav .nav { width: 84px; height: 72px; font-size: 1.8rem; }
	.kid .stepno b { font-size: 2.4rem; }
	.kid .part { gap: 0.9rem; }
	.kid .qty { font-size: 1.5rem; }

	@media (max-width: 900px) {
		main { grid-template-columns: 1fr; padding: 0 0.8rem 2rem; }
		.view { height: 52vh; }
		.panel { position: static; }
		.parts { max-height: none; }
	}
</style>
