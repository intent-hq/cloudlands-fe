<script lang="ts">
  import PullConflictDialog from '../PullConflictDialog.svelte';

  let open = $state(false);
  let error = $state('');
  let dismissCount = $state(0);

  function showFailure() {
    error = 'The branch has conflicting changes.';
    open = true;
  }
</script>

<button type="button" onclick={showFailure}>Retry pull</button>

<PullConflictDialog
  bind:open
  {error}
  repoPath="/tmp/example"
  branchName="main"
  onCancel={() => {
    dismissCount += 1;
    error = '';
  }}
/>

<output aria-label="dialog state">{open ? 'open' : 'closed'}</output>
<output aria-label="pull error">{error || 'cleared'}</output>
<output aria-label="dismiss count">{dismissCount}</output>
