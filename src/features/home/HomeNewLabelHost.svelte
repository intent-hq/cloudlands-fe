<script lang="ts">
  import { selectWorkspaceLabelsInUse } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import { setWorkspaceLabel } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { store } from '$store/renderer/store';
  import HomeNewLabelDialog from './HomeNewLabelDialog.svelte';
  import { homeNewLabel } from './home-new-label.svelte';
  import { focusHomeWorkspaceRow } from './home-workspace-menu';
  import { homeLabelGroupKey } from './home-workspace-labels';

  const labelsInUse$ = selectWorkspaceLabelsInUse();

  function create(label: string) {
    const request = homeNewLabel.request;
    homeNewLabel.close();
    if (!request?.isCurrent()) return;
    store.dispatch(setWorkspaceLabel(request.workspaceId, label));
    request.expandGroup(homeLabelGroupKey(label));
    focusHomeWorkspaceRow(request.getHomeElement, request.workspaceId, request.isCurrent);
  }

  function cancel() {
    const request = homeNewLabel.request;
    homeNewLabel.close();
    if (request?.isCurrent())
      focusHomeWorkspaceRow(request.getHomeElement, request.workspaceId, request.isCurrent);
  }
</script>

{#if homeNewLabel.request}
  <HomeNewLabelDialog open existingLabels={$labelsInUse$} onCreate={create} onCancel={cancel} />
{/if}
