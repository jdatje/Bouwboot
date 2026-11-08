<script lang="ts">
	import { partInfo } from '#lib/bricks.ts';
	// A brick or plate seen from slightly above: the top with studs, and a front edge whose
	// height shows the difference (a plate is a third as high as a brick).
	let { part = null, size = null, plate = false, hex = '#999', px = 12 }:
		{ part?: string | null; size?: string | null; plate?: boolean; hex?: string; px?: number } = $props();
	const info = $derived(part ? partInfo(part) : size ? { size, plate } : null);
	const dims = $derived(info ? info.size.split('x').map(Number).sort((a, b) => a - b) : [2, 2]);
	const kind0 = $derived((info as any)?.kind ?? (plate ? 'plate' : 'brick'));
	// slopes: rows = depth (2 for 45°, 3 for 33°), columns = width; others: short x long
	const depth = $derived(kind0 === 's45' ? 2 : kind0 === 's33' ? 3 : 0);
	const rows = $derived(depth || dims[0]);
	const cols = $derived(depth ? dims[0] * dims[1] / depth : dims[1]);
	const kind = $derived(kind0);
	const side = $derived(info?.plate ? 2.6 : 7);
	const slope = $derived(kind === 's45' || kind === 's33');
	const dark = $derived.by(() => {
		const n = parseInt(hex.replace('#', ''), 16);
		return ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11 < 60;
	});
</script>

<svg width={cols * px + 2} height={(rows * 10 + side) * px / 10 + 2} viewBox="-1 -1 {cols * 10 + 2} {rows * 10 + side + 2}" aria-hidden="true">
	<rect x="0" y={rows * 10 - 2} width={cols * 10} height={side + 2} rx="1.4" fill={hex} stroke={dark ? '#555' : 'rgba(0,0,0,.35)'} stroke-width="0.6" />
	<rect x="0" y={rows * 10 - 2} width={cols * 10} height={side + 2} rx="1.4" fill="rgba(0,0,0,.18)" />
	<rect x="0" y="0" width={cols * 10} height={rows * 10} rx="1.6" fill={hex} stroke={dark ? '#555' : 'rgba(0,0,0,.35)'} stroke-width="0.6" />
	{#if slope}
		<!-- slope: studs only on the top row, the rest slants down (shaded) -->
		<rect x="0" y="10" width={cols * 10} height={rows * 10 - 10} fill="rgba(0,0,0,.16)" />
		{#each Array(cols) as _, c}
			<circle cx={c * 10 + 5} cy="5" r="3" fill={hex} stroke={dark ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.28)'} stroke-width="0.7" />
		{/each}
	{:else if kind === 'tile'}
		<rect x="1.5" y="1.5" width={cols * 10 - 3} height={rows * 10 - 3} rx="1" fill="rgba(255,255,255,.18)" />
	{:else}
		{#each Array(rows) as _, r}
			{#each Array(cols) as _, c}
				<circle cx={c * 10 + 5} cy={r * 10 + 5} r="3" fill={hex} stroke={dark ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.28)'} stroke-width="0.7" />
				<circle cx={c * 10 + 4} cy={r * 10 + 4} r="1.1" fill="rgba(255,255,255,.35)" />
			{/each}
		{/each}
	{/if}
</svg>
