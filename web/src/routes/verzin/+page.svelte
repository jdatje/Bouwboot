<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import TopBar from '#lib/components/TopBar.svelte';
	import SizeSlider from '#lib/components/SizeSlider.svelte';

	type Idea = { title: string; prompt: string; why: string };
	let pieces = $state(200);
	let withAssembled = $state(true);
	let total = $state<number | null>(null);
	let ideas = $state<Idea[]>([]);
	let seen: string[] = [];
	let busy = $state(false);
	let err = $state('');

	async function loadTotal() {
		const r = await fetch(`/api/ideas?ib=${withAssembled ? 1 : 0}`);
		if (r.ok) total = (await r.json()).total;
	}
	onMount(loadTotal);
	$effect(() => { withAssembled; loadTotal(); });

	async function think() {
		busy = true; err = '';
		try {
			const r = await fetch('/api/ideas', {
				method: 'POST', headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ pieces, withAssembled, avoid: seen })
			});
			if (!r.ok) throw new Error('Bedenken lukte niet (' + r.status + ')');
			const j = await r.json();
			total = j.total;
			ideas = j.ideas;
			seen = [...seen, ...ideas.map((i) => i.title)];
			if (!ideas.length) err = total && total < 20 ? 'Er liggen te weinig losse stenen in het magazijn.' : 'Geen ideeën gevonden. Probeer het nog eens.';
		} catch (e: any) {
			err = e?.message ?? String(e);
		}
		busy = false;
	}

	function build(i: Idea) {
		goto(`/bouwwerk/nieuw?q=${encodeURIComponent(i.prompt)}&mijn=1&n=${Math.min(pieces, total ?? pieces)}${withAssembled ? '&ib=1' : ''}&t=${Date.now()}`);
	}
</script>

<TopBar search={false} />
<main>
	<h1>Wat kan ik bouwen?</h1>
	<p class="muted">Bouwboot verzint iets dat past bij de stenen die jullie in huis hebben.</p>

	<div class="card">
		<SizeSlider bind:value={pieces} max={total ?? 0} />
		<label class="check">
			<input type="checkbox" bind:checked={withAssembled} />
			<span>Ook stenen uit bouwwerken die in elkaar staan <small class="muted">(die moet je dan eerst uit elkaar halen)</small></span>
		</label>
		<button class="primary go" onclick={think} disabled={busy || total === 0}>
			{busy ? 'Even nadenken…' : ideas.length ? 'Verzin iets anders' : 'Verzin iets'}
		</button>
		{#if total === 0}<p class="muted">Het magazijn is nog leeg. Voeg eerst sets of een foto van je stenen toe.</p>{/if}
		{#if err}<p class="err">{err}</p>{/if}
	</div>

	{#if ideas.length}
		<ul class="ideas">
			{#each ideas as i}
				<li>
					<button onclick={() => build(i)}>
						<b>{i.title}</b>
						<span>{i.why}</span>
						<em>Bouw dit →</em>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	main { width: min(640px, 100%); margin: 0 auto; padding: 1rem 1.25rem 3rem; }
	h1 { margin: 0.6rem 0 0.2rem; }
	.card { background: white; border-radius: 18px; padding: 1.1rem 1.2rem; box-shadow: 0 2px 10px rgba(0,0,0,.05); margin-top: 1rem; display: flex; flex-direction: column; gap: 0.8rem; }
	.check { display: flex; gap: 0.5rem; align-items: flex-start; font-size: 0.95rem; color: #4a5260; cursor: pointer; }
	.check input { margin-top: 0.2rem; }
	.go { align-self: flex-start; }
	.err { color: #c91a09; margin: 0; }
	.ideas { list-style: none; padding: 0; margin: 1rem 0 0; display: grid; gap: 0.7rem; }
	.ideas button { width: 100%; text-align: left; background: white; border-radius: 16px; padding: 0.9rem 1.1rem; box-shadow: 0 2px 10px rgba(0,0,0,.05); display: flex; flex-direction: column; gap: 0.25rem; }
	.ideas button:hover { box-shadow: 0 2px 14px rgba(255,207,0,.35); }
	.ideas b { font-size: 1.1rem; color: #1d2330; }
	.ideas span { color: #4a5260; }
	.ideas em { font-style: normal; color: #b38f00; font-weight: 600; font-size: 0.9rem; }
</style>
