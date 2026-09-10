<script lang="ts">
  let { onMounted }: { onMounted?: () => void } = $props();
  let preEffectRan = $state(false);

  $effect.pre(() => {
    preEffectRan = true;
    onMounted?.();
  });
</script>

<div data-teardown-effect-probe={preEffectRan}></div>
