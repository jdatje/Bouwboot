<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';
	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#ffcf00" />
	<title>Bouwboot</title>
</svelte:head>

{@render children()}

<style>
	:global(*) { box-sizing: border-box; }
	:global(html, body) {
		margin: 0;
		font-family: ui-rounded, 'SF Pro Rounded', 'Nunito', 'Segoe UI', system-ui, sans-serif;
		color: #1d2330;
		background: #f7f8fa;
		-webkit-tap-highlight-color: transparent;
	}
	:global(a) { color: #0a5bd3; }
	:global(button) {
		font: inherit;
		cursor: pointer;
		border: none;
		border-radius: 14px;
		padding: 0.7em 1.1em;
		background: #e9edf2;
		color: #1d2330;
		font-weight: 600;
		transition: transform 0.08s, background 0.15s;
	}
	:global(button:active) { transform: scale(0.97); }
	:global(button:disabled) { opacity: 0.5; cursor: default; }
	:global(button.primary) { background: #ffcf00; color: #1d2330; }
	:global(button.red) { background: #d01012; color: white; }
	:global(input, select) {
		font: inherit;
		border: 2px solid #dfe4ea;
		border-radius: 12px;
		padding: 0.55em 0.75em;
		background: white;
	}
	:global(.card) { background: white; border-radius: 20px; box-shadow: 0 1px 3px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.04); }
	:global(.muted) { color: #6b7380; }
</style>
