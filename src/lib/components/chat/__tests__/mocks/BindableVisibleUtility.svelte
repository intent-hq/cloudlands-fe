<script lang="ts">
  /**
   * Stand-in for a transcript utility card (EventSubscriptionsCard) that owns
   * a bindable `visible` flag, so tests can drive the child→parent binding the
   * real card exercises when its subscription lane appears or empties.
   */
  let { visible = $bindable(false) }: { visible?: boolean } = $props();
</script>

<button
  type="button"
  data-testid="mock-transcript-utility"
  data-visible={visible}
  aria-label="toggle utility"
  onclick={() => (visible = !visible)}
></button>
