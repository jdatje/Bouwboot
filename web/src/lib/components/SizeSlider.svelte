<script lang="ts">
	import { onMount } from 'svelte';
	import { TICKS, loadPieces, piecesToPos, posToPieces, storePieces } from '#lib/size.ts';
	let { value = $bindable(200), fixed = false, max = 0 }: { value?: number; fixed?: boolean; max?: number } = $props();
	// fixed: value came from the address (an existing build); don't overwrite it with the remembered one
	onMount(() => { if (!fixed) value = loadPieces(); });
	let pos = $derived(piecesToPos(value) * 1000);
	function input(e: Event) {
		let n = posToPieces(Number((e.currentTarget as HTMLInputElement).value) / 1000);
		if (max && n > max) n = max;
		value = n;
		storePieces(n);
	}
</script>

<div class="slider">
	<div class="top">
		<span>Grootte</span>
		<b>ongeveer {value.toLocaleString('nl-NL')} onderdelen</b>
	</div>
	<input type="range" min="0" max="1000" step="1" value={pos} oninput={input} aria-label="Grootte in onderdelen" />
	<div class="ticks">
		{#each TICKS as [n, label]}
			<button type="button" style="left: {piecesToPos(n) * 100}%" onclick={() => { value = max && n > max ? max : n; storePieces(value); }}>{label}</button>
		{/each}
	</div>
	{#if max}<p class="max">Je magazijn heeft genoeg voor hooguit {max.toLocaleString('nl-NL')} onderdelen.</p>{/if}
</div>

<style>
	.slider { width: 100%; }
	.top { display: flex; justify-content: space-between; align-items: baseline; font-size: 0.9rem; color: #4a5260; gap: 0.5rem; }
	.top b { color: #1d2330; font-weight: 600; }
	input { width: 100%; margin: 0.35rem 0 0; accent-color: #ffcf00; height: 1.6rem; }
	.ticks { position: relative; height: 1.5rem; margin: 0 0.6rem; }
	.ticks button { position: absolute; transform: translateX(-50%); background: none; padding: 0.1rem 0.3rem; font-size: 0.8rem; color: #6a7380; border-radius: 6px; }
	.ticks button:hover { color: #1d2330; background: #eef1f5; }
	.max { margin: 0.2rem 0 0; font-size: 0.8rem; color: #8a93a0; }
</style>
