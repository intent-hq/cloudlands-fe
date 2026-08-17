<script lang="ts">
  import Fa from 'svelte-fa';
  import { RESOURCE_ICON_BY_KIND, type ResourceIconKind } from './resource-icon';

  interface Props {
    kind: ResourceIconKind;
    variant?: 'standard' | 'emphasized';
    class?: string;
  }

  let { kind, variant = 'standard', class: className = '' }: Props = $props();
</script>

<span
  class="resource-icon-tile {className}"
  data-resource-icon-tile
  data-resource-kind={kind}
  data-resource-icon-variant={variant}
  aria-hidden="true"
>
  <span class="resource-icon-glyph" data-resource-icon-glyph>
    <Fa icon={RESOURCE_ICON_BY_KIND[kind]} />
  </span>
</span>

<style>
  .resource-icon-tile {
    --resource-icon-surface-size: var(--agent-avatar-standard-surface-size);
    --resource-icon-corner-radius: var(--agent-avatar-standard-corner-radius);
    --resource-icon-glyph-size: 12px;
    display: inline-flex;
    box-sizing: border-box;
    width: var(--resource-icon-surface-size);
    height: var(--resource-icon-surface-size);
    flex: none;
    align-items: center;
    justify-content: center;
    border-radius: var(--resource-icon-corner-radius);
    background: hsl(var(--muted));
    color: hsl(var(--muted-foreground));
  }

  .resource-icon-tile[data-resource-icon-variant='emphasized'] {
    --resource-icon-surface-size: var(--agent-avatar-emphasized-surface-size);
    --resource-icon-corner-radius: var(--agent-avatar-emphasized-corner-radius);
    --resource-icon-glyph-size: var(--agent-avatar-standard-art-size);
  }

  .resource-icon-glyph {
    display: inline-flex;
    width: var(--resource-icon-glyph-size);
    height: var(--resource-icon-glyph-size);
    align-items: center;
    justify-content: center;
  }

  .resource-icon-glyph :global(svg) {
    display: block;
    width: var(--resource-icon-glyph-size);
    height: var(--resource-icon-glyph-size);
  }

  @media (forced-colors: active) {
    .resource-icon-tile {
      background: Canvas;
      color: CanvasText;
    }
  }
</style>
