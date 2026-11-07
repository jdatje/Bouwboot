<script lang="ts">
	import Logo from '#lib/components/Logo.svelte';
	import { page } from '$app/state';
	let pw = $state('');
	let err = $state('');
	let busy = $state(false);
	async function login(e: Event) {
		e.preventDefault();
		busy = true; err = '';
		const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
		busy = false;
		if (r.ok) location.href = page.url.searchParams.get('terug') || '/';
		else err = 'Dat wachtwoord klopt niet.';
	}
</script>

<main>
	<Logo size={1.2} />
	<form class="card" onsubmit={login}>
		<label for="pw">Wachtwoord van het huis</label>
		<input id="pw" type="password" bind:value={pw} autocomplete="current-password" />
		{#if err}<p class="err">{err}</p>{/if}
		<button class="primary" disabled={busy || !pw}>Binnenkomen</button>
	</form>
</main>

<style>
	main { min-height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1.5rem; padding: 1rem; }
	form { display: flex; flex-direction: column; gap: 0.7rem; padding: 1.4rem; width: min(360px, 100%); }
	label { font-weight: 700; }
	.err { color: #d01012; margin: 0; }
</style>
