<script lang="ts">
  interface Props {
    value?: string | null;
    variant?: 'pill' | 'bare';
    onchange?: (specialistId: string | null) => void;
  }

  let { value = null, variant = 'pill', onchange }: Props = $props();
</script>

<div data-testid="mock-specialist-dropdown" data-variant={variant}>
  <span>{value ?? 'general'}</span>
  <button
    type="button"
    onclick={() => {
      value = 'ui-designer';
      onchange?.('ui-designer');
    }}
  >
    Mock specialist change
  </button>
  <button
    type="button"
    onclick={() => {
      value = null;
      onchange?.(null);
    }}
  >
    Mock general specialist
  </button>
</div>
