<script lang="ts">
	let { size = 1 }: { size?: number } = $props();
	const letters = 'Bouwboot'.split('');
	const cols = ['#d01012', '#ffcf00', '#0a5bd3', '#237841', '#fe8a18', '#d01012', '#0a5bd3', '#ffcf00'];
</script>

<a href="/" class="logo" style:font-size="{size * 2}rem" aria-label="Bouwboot">
	{#each letters as l, i}<span style:background={cols[i]} style:color={cols[i] === '#ffcf00' ? '#1d2330' : 'white'}>{l}</span>{/each}
</a>

<style>
	.logo { display: inline-flex; gap: 0.08em; text-decoration: none; font-weight: 900; letter-spacing: 0; }
	span {
		display: inline-block; padding: 0.05em 0.18em; border-radius: 0.18em;
		box-shadow: inset 0 -0.12em 0 rgba(0,0,0,.18);
		line-height: 1.15;
	}
	span:nth-child(odd) { transform: translateY(-0.04em); }
</style>
