<script lang="ts">
	import Logo from './Logo.svelte';
	import SearchBar from './SearchBar.svelte';
	let { q = '', onlyMine = false, search = true }: { q?: string; onlyMine?: boolean; search?: boolean } = $props();
</script>

<header>
	<Logo size={0.62} />
	{#if search}<div class="s"><SearchBar value={q} {onlyMine} /></div>{/if}
	<nav>
		<a href="/bouwwerken">Opgeslagen</a>
		<a href="/magazijn">Magazijn</a>
	</nav>
</header>

<style>
	header { display: flex; align-items: flex-start; gap: 1rem; padding: 0.9rem 1.2rem; flex-wrap: wrap; }
	header > :global(a.logo) { margin-top: 0.55rem; }
	.s { flex: 1; min-width: 260px; max-width: 640px; }
	.s :global(.mine) { margin-top: 0.35rem; font-size: 0.85rem; }
	nav { display: flex; gap: 1rem; margin-left: auto; margin-top: 0.8rem; }
	nav a { color: #4a5260; text-decoration: none; font-weight: 600; }
	@media (max-width: 640px) {
		header { gap: 0.6rem; }
		.s { order: 3; flex-basis: 100%; }
		nav { margin-top: 0.6rem; }
	}
</style>
