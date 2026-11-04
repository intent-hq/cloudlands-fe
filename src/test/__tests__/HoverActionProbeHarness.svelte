<!--
  Fixture for ct-hover-action.ct.spec.ts: rows whose "Expand" action takes pointer events
  only while the row is hovered or holds focus, like the chat message action bars
  (message-action-surface.ts). With `growOnHover`, hovering the target row grows a spacer
  above it, so the row slides out from under the pointer.
-->
<script lang="ts">
  let { growOnHover = false, growBy = 240 }: { growOnHover?: boolean; growBy?: number } = $props();

  let grown = $state(false);
  let expanded = $state(false);
  let activations = $state(0);
</script>

<!-- `component.getByTestId` searches inside the mounted root, so the list is not the root. -->
<div>
  <div class="list" data-testid="list">
    <div
      class="spacer"
      data-testid="spacer"
      data-grown={grown}
      style:height={grown ? `${growBy}px` : '0px'}
    ></div>
    <div
      class="row"
      role="listitem"
      data-testid="target-row"
      onpointerenter={() => {
        if (growOnHover) grown = true;
      }}
    >
      <span class="text">The row text covers the action until the row is hovered</span>
      <button
        class="action"
        type="button"
        data-activations={activations}
        onclick={() => {
          activations++;
          expanded = !expanded;
        }}>Expand</button
      >
      {#if expanded}
        <div class="details" data-testid="details">Details</div>
      {/if}
    </div>
    <div class="row" role="listitem" data-testid="other-row">
      <span class="text">Another row</span>
      <button class="action" type="button" onclick={() => activations++}>Open menu</button>
    </div>
  </div>
</div>

<style>
  .list {
    display: flex;
    width: 320px;
    flex-direction: column;
  }

  .spacer {
    transition: height 200ms linear;
  }

  .row {
    position: relative;
    padding: 8px;
  }

  .text {
    display: block;
    height: 40px;
  }

  /* The action sits over the row text and lets pointer events through until the row is
     hovered, so a click that misses the hover hits the text instead. */
  .action {
    position: absolute;
    top: 8px;
    right: 8px;
    pointer-events: none;
    opacity: 0;
  }

  .row:hover .action,
  .row:focus-within .action {
    pointer-events: auto;
    opacity: 1;
  }

  .details {
    height: 40px;
  }
</style>
