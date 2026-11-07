<script lang="ts">
	import { onMount } from 'svelte';
	import { BrickScene } from '#lib/scene.ts';

	let { scene = $bindable<BrickScene | null>(null), height = '100%' }: { scene?: BrickScene | null; height?: string } = $props();
	let el: HTMLDivElement;

	onMount(() => {
		scene = new BrickScene(el);
		return () => {
			scene?.dispose();
			scene = null;
		};
	});
</script>

<div class="viewer" bind:this={el} style:height></div>

<style>
	.viewer {
		width: 100%;
		position: relative;
		touch-action: none;
		border-radius: 20px;
		background: radial-gradient(circle at 50% 35%, #ffffff 0%, #eef1f5 60%, #e3e8ee 100%);
		overflow: hidden;
	}
</style>
