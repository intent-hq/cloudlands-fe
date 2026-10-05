<script lang="ts">
  import DiagramActionsMenu from '../DiagramActionsMenu.svelte';
  import DiagramPresentation from '../DiagramPresentation.svelte';
</script>

<div data-testid="top-margin-menu">
  <DiagramPresentation kind="mermaid" actionsInTopMargin>
    <div>Top-margin diagram</div>
  </DiagramPresentation>
</div>

<div data-testid="default-presentation-menu">
  <DiagramPresentation kind="mermaid">
    <div>Default diagram</div>
  </DiagramPresentation>
</div>

<div data-testid="standalone-menu">
  <DiagramActionsMenu />
</div>
