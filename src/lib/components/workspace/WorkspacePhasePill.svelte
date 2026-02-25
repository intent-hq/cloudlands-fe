<script lang="ts">
  import { PHASE_META, type WorkspacePhase } from './workspace-phase';
  import WorkspacePhaseIndicator from './WorkspacePhaseIndicator.svelte';
  import { cn } from '$lib/utils';

  interface Props {
    phase: WorkspacePhase;
    /** Progress 0–1 for the building phase pie-chart fill */
    progress?: number;
    size?: number;
    class?: string;
  }

  let { phase, progress = 0, size = 12, class: className = '' }: Props = $props();

  const colors = {
    planning: 'var(--color-muted)',
    building: '#54B1F3',
    reviewing: '#6D7FF5',
    shipped: 'var(--color-foreground)',
  };
  const bgColors = {
    planning: 'hsl(var(--color-muted) / 0.1)',
    building: 'hsl(204 73% 74% / 0.1)',
    reviewing: 'hsl(247 53% 75% / 0.1)',
    shipped: 'hsl(var(--color-foreground) / 0.1)',
  };
  let pillStyle = $derived(`color: ${colors[phase]}; background-color: ${bgColors[phase]}`);
</script>

<div
  class={cn('inline-flex items-center gap-1 rounded-full px-1 pr-2 py-0.5', className)}
  style={pillStyle}
>
  <WorkspacePhaseIndicator {phase} {progress} {size} />
  <span class="text-xs font-medium">{PHASE_META[phase].label}</span>
</div>
