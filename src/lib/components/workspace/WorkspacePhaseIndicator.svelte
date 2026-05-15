<script lang="ts">
  import type { WorkspacePhase } from './workspace-phase';

interface Props {
    phase: WorkspacePhase;
    /** Progress 0–1 for the building phase pie-chart fill */
    progress?: number;
    size?: number;
    class?: string;
  }

  let { phase, progress = 0, size = 16, class: className = '' }: Props = $props();

  let r = $derived(size / 2);
  let cx = $derived(r);
  let cy = $derived(r);
  let strokeWidth = $derived(size * 0.12);
  let circleR = $derived(r - strokeWidth / 2);

  // Pie-chart math for building phase
  // Use a circle with stroke-width = radius so the stroke fills the circle area
  let pieR = $derived(r * 0.35);
  let pieCircumference = $derived(2 * Math.PI * pieR);
  let pieFilled = $derived(Math.max(0, Math.min(1, progress)) * pieCircumference);

  // Scale factor to fit 16×16 viewBox icons into the circle

  const colors = {
    planning: '#99999999',
    building: '#54B1F3',
    reviewing: '#6D7FF5',
    shipped: 'var(--color-foreground)',
  };
  let color = $derived(colors[phase] || 'currentColor');
</script>

<div class="relative">
  <svg
    width={size}
    height={size}
    viewBox="0 0 {size} {size}"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    class={className}
  >
    <!-- outline -->
    <circle {cx} {cy} r={circleR} stroke={color} stroke-width={strokeWidth} fill="none" />

    <!-- fill -->
    <!-- <circle
      {cx}
      {cy}
      r={['planning', 'building'].includes(phase) ? 0 : circleR}
      fill={color}
      style="transition: r 0.3s ease-out"
    /> -->

    {#if phase === 'planning'}{:else if phase === 'building'}
      <!-- Pie-chart fill using stroke-dasharray -->
      <circle
        {cx}
        {cy}
        r={pieR * 0.8}
        fill="none"
        stroke={color}
        stroke-width={pieR * 1.5}
        stroke-dasharray="{pieFilled} {pieCircumference}"
        stroke-dashoffset={pieCircumference * 0.25}
        transform="rotate(-90 {cx} {cy})"
        style="transition: stroke-dasharray 0.3s ease-out"
      />
    {:else if phase === 'reviewing'}
      <circle {cx} {cy} r={circleR * 0.6} fill={color} />
    {:else if phase === 'shipped'}
      <circle {cx} {cy} r={circleR} fill={color} />
    {/if}
  </svg>

  {#if phase === 'reviewing'}
    <!-- <svg
      width={size * 0.85}
      height={size * 0.85}
      viewBox="0 0 16 16"
      fill="none"
      class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2"
    >
      <path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" fill="var(--color-background)" />
      <path
        fill-rule="evenodd"
        clip-rule="evenodd"
        d="M1.38 8.28a.87.87 0 0 1 0-.566 7.003 7.003 0 0 1 13.238.006.87.87 0 0 1 0 .566A7.003 7.003 0 0 1 1.379 8.28ZM11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
        fill="var(--color-background)"
      />
    </svg> -->
    <!-- <svg
      class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 fill-background"
      width={size * 0.5}
      viewBox="0 0 8 6"
    >
      <path
        fill-rule="evenodd"
        clip-rule="evenodd"
        d="M7.69471 1.69471C7.87687 1.50611 7.97766 1.25351 7.97539 0.991311C7.97311 0.729114 7.86794 0.478302 7.68253 0.292894C7.49712 0.107485 7.24631 0.00231622 6.98411 3.78025e-05C6.72192 -0.00224062 6.46931 0.0985542 6.28071 0.280712L2.98771 3.57371L1.69471 2.28071C1.50611 2.09855 1.25351 1.99776 0.991311 2.00004C0.729114 2.00232 0.478302 2.10749 0.292894 2.29289C0.107485 2.4783 0.00231622 2.72911 3.78025e-05 2.99131C-0.00224062 3.25351 0.0985542 3.50611 0.280712 3.69471L2.28071 5.69471C2.46824 5.88218 2.72255 5.9875 2.98771 5.9875C3.25288 5.9875 3.50718 5.88218 3.69471 5.69471L7.69471 1.69471Z"
      />
    </svg> -->
  {:else if phase === 'shipped'}
    <!-- Filled dark circle with checkmark -->

    <svg
      class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 fill-background"
      width={size * 0.5}
      viewBox="0 0 8 6"
    >
      <path
        fill-rule="evenodd"
        clip-rule="evenodd"
        d="M7.69471 1.69471C7.87687 1.50611 7.97766 1.25351 7.97539 0.991311C7.97311 0.729114 7.86794 0.478302 7.68253 0.292894C7.49712 0.107485 7.24631 0.00231622 6.98411 3.78025e-05C6.72192 -0.00224062 6.46931 0.0985542 6.28071 0.280712L2.98771 3.57371L1.69471 2.28071C1.50611 2.09855 1.25351 1.99776 0.991311 2.00004C0.729114 2.00232 0.478302 2.10749 0.292894 2.29289C0.107485 2.4783 0.00231622 2.72911 3.78025e-05 2.99131C-0.00224062 3.25351 0.0985542 3.50611 0.280712 3.69471L2.28071 5.69471C2.46824 5.88218 2.72255 5.9875 2.98771 5.9875C3.25288 5.9875 3.50718 5.88218 3.69471 5.69471L7.69471 1.69471Z"
      />
    </svg>
  {/if}
</div>
