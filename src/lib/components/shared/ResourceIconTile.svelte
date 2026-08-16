<script lang="ts">
  import Fa from 'svelte-fa';
  import { RESOURCE_ICON_BY_KIND, type ResourceIconKind } from './resource-icon';

  interface Props {
    kind: ResourceIconKind;
    class?: string;
  }

  let { kind, class: className = '' }: Props = $props();
</script>

<span
  class="resource-icon-tile {className}"
  data-resource-icon-tile
  data-resource-kind={kind}
  aria-hidden="true"
>
  <span class="resource-icon-glyph" data-resource-icon-glyph>
    <Fa icon={RESOURCE_ICON_BY_KIND[kind]} />
  </span>
</span>

<style>
  .resource-icon-tile {
    display: inline-flex;
    box-sizing: border-box;
    width: var(--agent-avatar-standard-surface-size);
    height: var(--agent-avatar-standard-surface-size);
    flex: none;
    align-items: center;
    justify-content: center;
    border-radius: var(--agent-avatar-standard-corner-radius);
    background: hsl(var(--muted));
    color: hsl(var(--muted-foreground));
  }

  .resource-icon-glyph {
    display: inline-flex;
    width: 12px;
    height: 12px;
    align-items: center;
    justify-content: center;
  }

  .resource-icon-glyph :global(svg) {
    display: block;
    width: 12px;
    height: 12px;
  }

  @media (forced-colors: active) {
    .resource-icon-tile {
      background: Canvas;
      color: CanvasText;
    }
  }
</style>
