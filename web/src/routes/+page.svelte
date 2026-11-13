<script lang="ts">
	import SearchBar from '#lib/components/SearchBar.svelte';
	import Logo from '#lib/components/Logo.svelte';
</script>

<main>
	<div class="center">
		<Logo size={1.6} />
		<p class="muted tag">Typ iets, en zie het in stenen verschijnen.</p>
		<SearchBar big autofocus />
		<a class="idea" href="/verzin">Wat kan ik bouwen met mijn stenen?</a>
	</div>
	<nav>
		<a href="/bouwwerken">Opgeslagen bouwwerken</a>
		<a href="/magazijn">Magazijn</a>
	</nav>
</main>

<style>
	main { min-height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1.25rem; }
	.center { width: min(640px, 100%); display: flex; flex-direction: column; align-items: center; gap: 0.6rem; margin-top: -10vh; }
	.tag { margin: 0.2rem 0 1.4rem; }
	.idea { margin-top: 1.2rem; background: #fff6cc; color: #1d2330; text-decoration: none; font-weight: 600; padding: 0.6rem 1.1rem; border-radius: 999px; }
	.idea:hover { background: #ffeb99; }
	nav { position: fixed; bottom: 1.4rem; display: flex; gap: 1.6rem; }
	nav a { color: #4a5260; text-decoration: none; font-weight: 600; }
	nav a:hover { color: #1d2330; text-decoration: underline; }
</style>
