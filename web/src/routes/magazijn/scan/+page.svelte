<script lang="ts">
	import { goto } from '$app/navigation';
	import TopBar from '#lib/components/TopBar.svelte';
	import { LIBRARY, PALETTE, PART_TO_SIZE } from '#lib/bricks.ts';

	type Item = { crop: string; part: string; partName: string; color: number; confidence: 'hoog' | 'laag'; note?: string; include: boolean; qty: number };
	let items = $state<Item[]>([]);
	let phase = $state<'start' | 'busy' | 'review' | 'saving'>('start');
	let err = $state('');
	let preview = $state('');

	/** Scales the photo down to max 2400px before uploading (phones make huge photos). */
	async function shrink(f: File): Promise<Blob> {
		try {
			const bmp = await createImageBitmap(f);
			const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
			const c = document.createElement('canvas');
			c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
			c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
			return await new Promise((res) => c.toBlob((b) => res(b ?? f), 'image/jpeg', 0.9));
		} catch {
			return f;
		}
	}

	async function upload(e: Event) {
		const f = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!f) return;
		preview = URL.createObjectURL(f);
		phase = 'busy'; err = '';
		const fd = new FormData();
		fd.append('photo', await shrink(f), 'foto.jpg');
		const r = await fetch('/api/scan', { method: 'POST', body: fd });
		if (!r.ok) {
			err = (await r.json().catch(() => ({}))).message ?? 'Scannen mislukt.';
			phase = 'start';
			return;
		}
		const j = await r.json();
		items = [...items, ...j.items.map((i: Item) => ({ ...i, include: true, qty: 1 }))];
		phase = 'review';
		if (!j.items.length) err = 'Geen stenen gevonden. Leg ze los van elkaar op een lichte ondergrond.';
	}

	async function confirm() {
		phase = 'saving';
		const r = await fetch('/api/stock/scan', {
			method: 'POST', headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ items: items.filter((i) => i.include).map((i) => ({ part: i.part, color: i.color, qty: i.qty })) })
		});
		if (r.ok) goto('/magazijn');
		else { err = 'Opslaan mislukt.'; phase = 'review'; }
	}

	const sizes = Object.entries(LIBRARY);
	const count = $derived(items.filter((i) => i.include).reduce((a, i) => a + i.qty, 0));
</script>

<svelte:head><title>Scannen · Bouwboot</title></svelte:head>
<TopBar />
<main>
	<h1>Stenen scannen</h1>
	{#if phase === 'start' || phase === 'busy'}
		<div class="card tips">
			<ol>
				<li>Leg de stenen op een <b>lichte, effen ondergrond</b> (wit laken of tafel).</li>
				<li>Zorg dat ze <b>elkaar niet raken</b>, liefst 30 tot 60 per foto.</li>
				<li>Fotografeer recht van boven, met goed licht.</li>
			</ol>
			<label class="pick primary" class:disabled={phase === 'busy'}>
				{phase === 'busy' ? 'Stenen herkennen…' : '📷 Foto maken of kiezen'}
				<input type="file" accept="image/*" capture="environment" onchange={upload} disabled={phase === 'busy'} hidden />
			</label>
			{#if phase === 'busy' && preview}<img class="prev" src={preview} alt="" />{/if}
		</div>
	{/if}
	{#if err}<p class="err">{err}</p>{/if}

	{#if items.length}
		<p class="muted">Controleer de stenen. <span class="o">Oranje</span> = niet zeker. Klopt iets niet? Pas het aan of zet het vinkje uit.</p>
		<div class="grid">
			{#each items as it}
				<div class="card item" class:unsure={it.confidence === 'laag'} class:off={!it.include}>
					<label class="inc"><input type="checkbox" bind:checked={it.include} /></label>
					<img src={it.crop} alt="" />
					<select bind:value={it.part}>
						{#each sizes as [s, p]}<option value={p}>Steen {s}</option>{/each}
						{#if !PART_TO_SIZE[it.part]}<option value={it.part}>{it.partName} ({it.part})</option>{/if}
					</select>
					<select bind:value={it.color}>{#each PALETTE as c}<option value={c.id}>{c.name}</option>{/each}</select>
					{#if it.note}<small class="note">{it.note}</small>{/if}
				</div>
			{/each}
		</div>
		<div class="bottom">
			<label class="pick">Nog een foto<input type="file" accept="image/*" capture="environment" onchange={upload} hidden /></label>
			<button class="primary" onclick={confirm} disabled={phase === 'saving' || phase === 'busy' || !count}>{count} stenen toevoegen</button>
		</div>
	{/if}
</main>

<style>
	main { max-width: 1100px; margin: 0 auto; padding: 0 1.2rem 6rem; }
	.tips { padding: 1rem 1.3rem; }
	.tips ol { padding-left: 1.2rem; line-height: 1.7; }
	.pick { display: inline-block; background: #e9edf2; padding: 0.8em 1.2em; border-radius: 14px; font-weight: 700; cursor: pointer; }
	.pick.primary { background: #ffcf00; }
	.pick.disabled { opacity: 0.6; }
	.prev { display: block; max-width: 100%; max-height: 40vh; margin-top: 1rem; border-radius: 12px; }
	.err { color: #a10c0e; font-weight: 600; }
	.o { color: #e07b00; font-weight: 700; }
	.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 0.8rem; }
	.item { padding: 0.6rem; display: flex; flex-direction: column; gap: 0.4rem; position: relative; border: 3px solid transparent; }
	.item.unsure { border-color: #ffa630; }
	.item.off { opacity: 0.45; }
	.item img { width: 100%; aspect-ratio: 1; object-fit: contain; background: #f4f5f7; border-radius: 10px; }
	.item select { width: 100%; padding: 0.35em 0.5em; font-size: 0.9rem; }
	.inc { position: absolute; top: 0.8rem; right: 0.8rem; }
	.inc input { width: 1.3rem; height: 1.3rem; accent-color: #d01012; }
	.note { color: #b35f00; }
	.bottom { position: fixed; left: 0; right: 0; bottom: 0; background: white; box-shadow: 0 -2px 12px rgba(0,0,0,.08); padding: 0.8rem 1.2rem; display: flex; justify-content: flex-end; gap: 0.6rem; }
</style>
