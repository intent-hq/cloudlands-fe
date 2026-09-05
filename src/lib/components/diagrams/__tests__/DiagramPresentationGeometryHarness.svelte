<script lang="ts">
  import DiagramPresentation from '../DiagramPresentation.svelte';
</script>

<div class="diagram-stack">
  <div class="neighbor" data-testid="before">Before</div>
  <DiagramPresentation kind="custom" selected>
    <div class="diagram-content">Custom diagram</div>
  </DiagramPresentation>
  <DiagramPresentation kind="mermaid">
    <div class="diagram-content">Mermaid diagram</div>
  </DiagramPresentation>
  <div class="neighbor" data-testid="after">After</div>
</div>

<style>
  .diagram-stack {
    display: flow-root;
    width: 30rem;
  }

  .neighbor,
  .diagram-content {
    height: 2rem;
  }
</style>
