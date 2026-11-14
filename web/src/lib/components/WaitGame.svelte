<script lang="ts">
	/** One of the mini games while a design is being made: random, but not the same one twice in a row. */
	import BrickCatch from '#lib/components/BrickCatch.svelte';
	import BrickTower from '#lib/components/BrickTower.svelte';
	import WhichPiece from '#lib/components/WhichPiece.svelte';
	let { active = true }: { active?: boolean } = $props();
	const GAMES = ['vang', 'toren', 'welk'] as const;
	let prev = '';
	try { prev = localStorage.getItem('bouwboot.lastgame') ?? ''; } catch {}
	const options = GAMES.filter((g) => g !== prev);
	const game = options[Math.floor(Math.random() * options.length)];
	try { localStorage.setItem('bouwboot.lastgame', game); } catch {}
</script>

{#if game === 'vang'}<BrickCatch {active} />
{:else if game === 'toren'}<BrickTower {active} />
{:else}<WhichPiece {active} />{/if}
