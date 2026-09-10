<script lang="ts">
  import type { CatalogRendererProps } from '../catalog-renderers';
  import FieldPreviewCell from './FieldPreviewCell.svelte';
  import { fieldControls, fieldStates } from './field-controls';

  let { fixture }: CatalogRendererProps = $props();
</script>

<div
  class="fields-matrix"
  data-catalog-renderer-fixture={fixture.id}
  data-catalog-rendered-state={fixture.states.join(' ')}
>
  {#each fieldControls as control (control.id)}
    <section class="field-family" aria-labelledby={`fields-${control.id}`}>
      <h3 id={`fields-${control.id}`} class="family-title">{control.label}</h3>
      <div class="state-grid">
        {#each fieldStates as state (state)}
          <FieldPreviewCell control={control.id} {state} label={control.label} />
        {/each}
      </div>
    </section>
  {/each}
</div>

<style>
  .fields-matrix {
    display: grid;
    min-width: 0;
    gap: var(--space-6);
  }
  .field-family {
    display: grid;
    min-width: 0;
    gap: var(--space-2);
  }
  .family-title {
    font-size: var(--text-body);
    font-weight: 600;
    color: hsl(var(--foreground));
  }
  .state-grid {
    display: grid;
    min-width: 0;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr));
    align-items: start;
    gap: var(--space-3);
  }
</style>
