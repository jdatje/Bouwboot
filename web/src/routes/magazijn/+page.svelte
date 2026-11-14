<script lang="ts">
	import { onMount } from 'svelte';
	import TopBar from '#lib/components/TopBar.svelte';
	import PartIcon from '#lib/components/PartIcon.svelte';
	import { LIBRARY, PLATES, SLOPES45, SLOPES33, TILES, PALETTE } from '#lib/bricks.ts';

	type Line = { part: string; color: number; owned: number; lost: number; reserved: number; available: number; size: string | null; plate: boolean; name: string; img: string | null; colorName: string; hex: string };
	type SetRow = { set_num: string; name: string; img: string | null; num_parts: number; assembled: number };
	let lines = $state<Line[]>([]);
	let sets = $state<SetRow[]>([]);
	let loaded = $state(false);
	let filter = $state<'los' | 'alles'>('los');
	let setNum = $state('');
	let setMsg = $state('');
	let busy = $state(false);
	let addSize = $state('s2x4');
	const TABLES: Record<string, Record<string, string>> = { s: LIBRARY, p: PLATES, a: SLOPES45, b: SLOPES33, t: TILES };
	const addPart = $derived(TABLES[addSize[0]][addSize.slice(1)]);
	let addColor = $state(4);
	let addQty = $state(1);
	let search = $state('');

	async function refresh() {
		const r = await (await fetch('/api/stock')).json();
		lines = r.lines; sets = r.sets; loaded = true;
	}
	onMount(refresh);

	const shown = $derived(
		lines.filter((l) => (filter === 'alles' || l.size) &&
			(!search || `${l.name} ${l.colorName} ${l.part}`.toLowerCase().includes(search.toLowerCase())))
	);
	const totals = $derived({
		all: lines.reduce((a, l) => a + l.owned, 0),
		loose: lines.filter((l) => l.size).reduce((a, l) => a + l.available, 0)
	});

	async function addSetNow(e: Event) {
		e.preventDefault();
		if (!setNum.trim()) return;
		busy = true; setMsg = 'Set ophalen…';
		const r = await fetch('/api/stock/sets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ set_num: setNum }) });
		const j = await r.json().catch(() => ({}));
		setMsg = r.ok ? `${j.name} toegevoegd (${j.parts} onderdelen).` : (j.message ?? 'Toevoegen mislukt.');
		if (r.ok) setNum = '';
		busy = false;
		refresh();
	}
	async function setAssembled(s: SetRow, v: boolean) {
		await fetch(`/api/stock/sets/${s.set_num}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assembled: v }) });
		refresh();
	}
	async function removeSet(s: SetRow) {
		if (!confirm(`${s.name} en al zijn onderdelen uit het magazijn halen?`)) return;
		await fetch(`/api/stock/sets/${s.set_num}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: '{}' });
		refresh();
	}
	async function lost(l: Line, delta: number) {
		await fetch('/api/stock/lost', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ part: l.part, color: l.color, delta }) });
		refresh();
	}
	async function adjust(part: string, color: number, delta: number) {
		await fetch('/api/stock/adjust', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ part, color, delta }) });
		refresh();
	}
</script>

<svelte:head><title>Magazijn · Bouwboot</title></svelte:head>
<TopBar />
<main>
	<div class="title">
		<h1>Magazijn</h1>
		<a class="scan primary" href="/magazijn/scan">📷 Stenen scannen</a>
		<a class="scan" href="/onderdelen">Onderdelen</a>
	</div>
	<p class="muted">{totals.all} onderdelen in huis, waarvan <b>{totals.loose}</b> stenen en platen die de ontwerper kan gebruiken.</p>

	<div class="cols">
		<section class="card box">
			<h2>Sets</h2>
			<form onsubmit={addSetNow} class="row">
				<input bind:value={setNum} placeholder="Setnummer, bijv. 60337" inputmode="numeric" />
				<button class="primary" disabled={busy || !setNum.trim()}>Toevoegen</button>
			</form>
			{#if setMsg}<p class="small">{setMsg}</p>{/if}
			<ul class="sets">
				{#each sets as s}
					<li>
						{#if s.img}<img src={s.img} alt="" />{/if}
						<div class="sinfo">
							<b>{s.name}</b>
							<small class="muted">{s.set_num} · {s.num_parts} onderdelen</small>
							<label class="switch"><input type="checkbox" checked={!!s.assembled} onchange={(e) => setAssembled(s, e.currentTarget.checked)} /> staat in elkaar</label>
						</div>
						<button class="x" onclick={() => removeSet(s)} aria-label="Verwijderen">✕</button>
					</li>
				{:else}
					<li class="muted small">Nog geen sets. Typ het nummer van de doos.</li>
				{/each}
			</ul>

			<h2>Los toevoegen</h2>
			<div class="addgrid">
				<select bind:value={addSize} aria-label="Maat">
					{#each Object.keys(LIBRARY) as s}<option value={'s' + s}>Steen {s}</option>{/each}
					{#each Object.keys(PLATES) as s}<option value={'p' + s}>Plaat {s}</option>{/each}
					{#each Object.keys(SLOPES45) as s}<option value={'a' + s}>Dakpan 45° {s}</option>{/each}
					{#each Object.keys(SLOPES33) as s}<option value={'b' + s}>Dakpan 33° {s}</option>{/each}
					{#each Object.keys(TILES) as s}<option value={'t' + s}>Tegel {s}</option>{/each}
				</select>
				<select bind:value={addColor} aria-label="Kleur">{#each PALETTE as c}<option value={c.id}>{c.name}</option>{/each}</select>
				<input type="number" min="1" max="999" bind:value={addQty} aria-label="Aantal" />
				<button onclick={() => adjust(addPart, addColor, addQty)}>Toevoegen</button>
			</div>
		</section>

		<section class="card box">
			<div class="row between">
				<h2>Onderdelen</h2>
				<div class="seg">
					<button class:on={filter === 'los'} onclick={() => (filter = 'los')}>Stenen &amp; platen</button>
					<button class:on={filter === 'alles'} onclick={() => (filter = 'alles')}>Alles</button>
				</div>
			</div>
			<input class="find" bind:value={search} placeholder="Zoeken…" />
			{#if !loaded}<p class="muted">Laden…</p>{/if}
			<ul class="parts">
				{#each shown as l (l.part + '/' + l.color)}
					<li class:gone={l.available === 0}>
						{#if l.part}<PartIcon part={l.part} hex={l.hex} px={10} />{:else if l.img}<img src={l.img} alt="" />{:else}<span class="sw" style:background={l.hex}></span>{/if}
						<div class="pinfo">
							<span>{l.name}</span>
							<small class="muted"><span class="dotc" style:background={l.hex}></span>{l.colorName}
								{#if l.reserved} · {l.reserved} in gebruik{/if}
								{#if l.lost} · <b class="lost">{l.lost} kwijt</b>{/if}</small>
						</div>
						<span class="count"><b>{l.available}</b><small class="muted">/{l.owned}</small></span>
						<div class="btns">
							{#if l.lost}<button title="Teruggevonden" onclick={() => lost(l, -1)}>gevonden</button>{/if}
							{#if l.lost < l.owned}<button title="Eén kwijt" onclick={() => lost(l, 1)}>kwijt</button>{/if}
						</div>
					</li>
				{:else}
					{#if loaded}<li class="muted small">Niks gevonden.</li>{/if}
				{/each}
			</ul>
		</section>
	</div>
</main>

<style>
	main { max-width: 1200px; margin: 0 auto; padding: 0 1.2rem 2rem; }
	.title { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
	.scan { background: #ffcf00; color: #1d2330; text-decoration: none; padding: 0.7em 1.1em; border-radius: 14px; font-weight: 700; }
	.cols { display: grid; grid-template-columns: 380px 1fr; gap: 1rem; align-items: start; }
	.box { padding: 1rem 1.1rem; }
	h2 { font-size: 1.15rem; margin: 0.2rem 0 0.7rem; }
	.box h2:not(:first-child) { margin-top: 1.4rem; }
	.row { display: flex; gap: 0.5rem; align-items: center; }
	.row input { flex: 1; min-width: 0; }
	.addgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
	.addgrid input { min-width: 0; }
	.between { justify-content: space-between; }
	.small { font-size: 0.9rem; }
	.sets { list-style: none; padding: 0; margin: 0.8rem 0 0; display: flex; flex-direction: column; gap: 0.6rem; }
	.sets li { display: flex; gap: 0.7rem; align-items: center; }
	.sets img { width: 64px; height: 48px; object-fit: contain; }
	.sinfo { display: flex; flex-direction: column; flex: 1; min-width: 0; }
	.switch { display: inline-flex; gap: 0.4rem; align-items: center; font-size: 0.88rem; cursor: pointer; }
	.switch input { accent-color: #d01012; }
	.x { background: none; color: #999; padding: 0.3rem 0.5rem; }
	.seg { display: flex; background: #eef1f5; border-radius: 12px; padding: 0.2rem; }
	.seg button { background: none; padding: 0.4em 0.8em; font-size: 0.88rem; }
	.seg button.on { background: white; }
	.find { width: 100%; margin-bottom: 0.6rem; }
	.parts { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; }
	.parts li { display: flex; align-items: center; gap: 0.7rem; padding: 0.45rem 0; border-bottom: 1px solid #f0f2f5; }
	.parts li.gone { opacity: 0.55; }
	.parts img { width: 40px; height: 32px; object-fit: contain; }
	.sw { width: 32px; height: 22px; border-radius: 5px; }
	.pinfo { flex: 1; display: flex; flex-direction: column; min-width: 0; }
	.dotc { display: inline-block; width: 0.7em; height: 0.7em; border-radius: 50%; margin-right: 0.3em; vertical-align: -0.05em; border: 1px solid rgba(0,0,0,.2); }
	.lost { color: #a10c0e; }
	.count { min-width: 3.5em; text-align: right; }
	.btns { display: flex; gap: 0.3rem; }
	.btns button { padding: 0.35em 0.6em; font-size: 0.82rem; }
	@media (max-width: 900px) { .cols { grid-template-columns: minmax(0, 1fr); } }
</style>
