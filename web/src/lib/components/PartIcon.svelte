<script lang="ts">
	import { partInfo } from '#lib/bricks.ts';
	// A brick or plate seen from slightly above: the top with studs, and a front edge whose
	// height shows the difference (a plate is a third as high as a brick).
	let { part = null, size = null, plate = false, hex = '#999', px = 12 }:
		{ part?: string | null; size?: string | null; plate?: boolean; hex?: string; px?: number } = $props();
	const info = $derived(part ? partInfo(part) : size ? { size, plate } : null);
	const dims = $derived(info ? info.size.split('x').map(Number).sort((a, b) => a - b) : [2, 2]);
	const rows = $derived(dims[0]);
	const cols = $derived(dims[1]);
	const side = $derived(info?.plate ? 2.6 : 7);
	const dark = $derived.by(() => {
		const n = parseInt(hex.replace('#', ''), 16);
		return ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11 < 60;
	});
</script>

<svg width={cols * px + 2} height={(rows * 10 + side) * px / 10 + 2} viewBox="-1 -1 {cols * 10 + 2} {rows * 10 + side + 2}" aria-hidden="true">
	<rect x="0" y={rows * 10 - 2} width={cols * 10} height={side + 2} rx="1.4" fill={hex} stroke={dark ? '#555' : 'rgba(0,0,0,.35)'} stroke-width="0.6" />
	<rect x="0" y={rows * 10 - 2} width={cols * 10} height={side + 2} rx="1.4" fill="rgba(0,0,0,.18)" />
	<rect x="0" y="0" width={cols * 10} height={rows * 10} rx="1.6" fill={hex} stroke={dark ? '#555' : 'rgba(0,0,0,.35)'} stroke-width="0.6" />
	{#each Array(rows) as _, r}
		{#each Array(cols) as _, c}
			<circle cx={c * 10 + 5} cy={r * 10 + 5} r="3" fill={hex} stroke={dark ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.28)'} stroke-width="0.7" />
			<circle cx={c * 10 + 4} cy={r * 10 + 4} r="1.1" fill="rgba(255,255,255,.35)" />
		{/each}
	{/each}
</svg>
