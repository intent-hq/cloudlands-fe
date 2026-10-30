<script lang="ts">
  import '$lib/styles/dock-tokens.css';
</script>

<!-- Decorative preview of the notch dock: a camera-black panel open under the menu bar. -->
<svg class="dock-lab-illustration" width="88" height="56" viewBox="0 0 88 56" aria-hidden="true">
  <defs>
    <clipPath id="dock-lab-screen"><rect x="0" y="0" width="88" height="56" rx="8" /></clipPath>
  </defs>
  <g clip-path="url(#dock-lab-screen)">
    <rect class="screen" x="0" y="0" width="88" height="56" />
    <rect class="menu-bar" x="0" y="0" width="88" height="5" />
    <g data-dock-surface="notch">
      <rect class="notch" x="22" y="-8" width="44" height="44" rx="8" />
      <rect class="row" x="28" y="10" width="22" height="2.5" rx="1.25" />
      <rect class="row" x="28" y="16" width="30" height="2.5" rx="1.25" />
      <rect class="composer" x="26" y="24" width="36" height="9" rx="3" />
      <circle class="accent" cx="57.5" cy="28.5" r="2.5" />
    </g>
  </g>
  <rect class="edge" x="0.5" y="0.5" width="87" height="55" rx="7.5" />
</svg>

<style>
  .dock-lab-illustration {
    display: block;
    flex: none;
  }
  .screen {
    fill: hsl(var(--muted));
  }
  .menu-bar {
    fill: hsl(var(--foreground) / 0.06);
  }
  .edge {
    fill: none;
    stroke: hsl(var(--border));
  }
  .notch {
    fill: hsl(var(--dock-surface));
  }
  .row {
    fill: hsl(var(--dock-border));
  }
  .composer {
    fill: hsl(var(--dock-raised));
    stroke: hsl(var(--dock-border));
    stroke-width: 0.75;
  }
  .accent {
    fill: hsl(var(--primary));
  }
</style>
