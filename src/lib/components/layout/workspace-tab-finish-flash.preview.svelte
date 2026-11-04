<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';

  type Phase = 'working' | 'finished' | 'settled' | 'current-finished';

  export interface WorkspaceTabFinishFlashPreviewProps {
    phase?: Phase;
  }

  export const preview = definePreview<WorkspaceTabFinishFlashPreviewProps>({
    id: 'workspace-tab-finish-flash',
    title: 'Workspace tab finish flash',
    defaultState: 'finished',
    states: {
      working: { props: { phase: 'working' } },
      finished: { props: { phase: 'finished' } },
      settled: { props: { phase: 'settled' } },
      'current-finished': { props: { phase: 'current-finished' } },
    },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { WorkspaceStatus, type Workspace } from '$shared/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { store } from '$store/renderer/configured-store';
  import { loadWorkspaceTabsState } from '$store/renderer/slices/tab-state/tab-state-slice';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import WorkspaceTabStrip from './WorkspaceTabStrip.svelte';

  let { phase = 'finished' }: WorkspaceTabFinishFlashPreviewProps = $props();

  const timestamp = '2026-11-04T12:00:00.000Z';
  const ids = ['finish-alpha', 'finish-beta', 'finish-gamma'];
  const titles = ['Tab strip polish', 'Fix toast routing', 'Docs refresh'];

  function workspace(index: number, patch: Partial<Workspace> = {}): Workspace {
    return {
      id: WorkspaceId(ids[index]),
      title: titles[index],
      branch: `finish-${index + 1}`,
      changesets: [],
      timeline: [],
      conversationInfo: [],
      status: WorkspaceStatus.Active,
      createdAt: timestamp,
      updatedAt: timestamp,
      displayStatus: 'idle',
      ...patch,
    };
  }

  const working = { displayStatus: 'in_progress' } as const;
  const unread = { displayStatus: 'idle', attention: 'unread' } as const;

  function finishingIndex(): number {
    return phase === 'current-finished' ? 0 : 1;
  }

  function seed() {
    for (const index of ids.keys()) {
      const start = index === finishingIndex() ? (phase === 'settled' ? unread : working) : {};
      store.dispatch(setWorkspaceEntity(workspace(index, index === 2 ? working : start)));
    }
    store.dispatch(
      loadWorkspaceTabsState({
        openTabs: ids,
        currentTabId: ids[0],
        pinnedTabs: [],
        unsavedTabs: [],
        optimisticTabs: [],
        tabOrder: ids,
      }),
    );
  }

  seed();

  onMount(() => {
    if (phase !== 'finished' && phase !== 'current-finished') return;
    const frame = requestAnimationFrame(() =>
      store.dispatch(setWorkspaceEntity(workspace(finishingIndex(), unread))),
    );
    return () => cancelAnimationFrame(frame);
  });
</script>

<div class="finish-flash-preview" data-finish-flash-preview>
  <WorkspaceTabStrip activeWorkspaceId={ids[0]} leadingInsetPx={8} scrollerMarginLeftPx={0} />
</div>

<style>
  .finish-flash-preview {
    width: 520px;
    padding-top: 2px;
  }
</style>
