<script lang="ts">
  import type { StartOnPlacement } from '$features/remote-machines/start-on';

  // Stands in for ProposalStartOn: keeps the card's bindings and can pick a
  // remote machine the way the real picker reports one.
  interface Props {
    value?: string;
    placement?: StartOnPlacement | null;
    unavailable?: boolean;
  }
  let {
    value = $bindable(''),
    placement = $bindable(),
    unavailable = $bindable(false),
  }: Props = $props();
</script>

<div data-testid="mock-proposal-start-on" data-value={value} data-unavailable={String(unavailable)}>
  <button
    type="button"
    onclick={() => {
      value = 'd-mac';
      placement = { target: 'remote', checkout: 'isolated', nodeId: 'd-mac' };
    }}>Mock start on remote machine</button
  >
</div>
