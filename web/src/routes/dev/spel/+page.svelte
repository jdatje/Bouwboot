<script lang="ts">
	// test page for the wait games (not linked from the app)
	import { page } from '$app/state';
	import BrickCatch from '#lib/components/BrickCatch.svelte';
	import BrickTower from '#lib/components/BrickTower.svelte';
	import WhichPiece from '#lib/components/WhichPiece.svelte';
	const g = page.url.searchParams.get('g') ?? 'welk';
</script>
<div style="position:relative;width:100%;height:80vh;background:#eef1f5;border-radius:18px;overflow:hidden">
	{#if g === 'vang'}<BrickCatch />{:else if g === 'toren'}<BrickTower />{:else}<WhichPiece />{/if}
</div>
