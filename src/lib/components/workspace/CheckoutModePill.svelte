<script lang="ts">
  /**
   * CheckoutModePill - Tiny, quiet metadata pill showing how the workspace
   * checkout was provisioned (PROTOCOL §5.1). Renders nothing when
   * `checkoutMode` is absent (direct / non-daemon-provisioned checkouts).
   */
  interface Props {
    checkoutMode?: 'cow' | 'worktree';
    class?: string;
  }

  let { checkoutMode, class: className = '' }: Props = $props();

  const label = $derived(
    checkoutMode === 'cow' ? 'CoW' : checkoutMode === 'worktree' ? 'Worktree' : null,
  );
</script>

{#if label}
  <span
    class="inline-flex items-center shrink-0 rounded-full bg-muted/20 px-1 text-ui-sm leading-4 text-subtle {className}"
    title="Checkout mode: {label}"
  >
    {label}
  </span>
{/if}
