<!--
  Fixture for ct-hover-action.ct.spec.ts: rows whose "Expand" action takes pointer events
  only while the row is hovered or holds focus, like the chat message action bars
  (message-action-surface.ts).
-->
<script lang="ts">
  let expanded = $state(false);
  let activations = $state(0);
</script>

<!-- `component.getByTestId` searches inside the mounted root, so the list is not the root. -->
<div>
  <div class="list" data-testid="list">
    <div class="row" role="listitem" data-testid="target-row">
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
