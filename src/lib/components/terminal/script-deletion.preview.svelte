<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import type { ScriptStatus } from '$features/scripts/types';
  interface Props {
    status?: ScriptStatus;
    failDeletion?: boolean;
    pending?: boolean;
    deferEdits?: boolean;
  }
  export const preview = definePreview<Props>({
    id: 'script-deletion',
    title: 'Confirmed script deletion',
    defaultState: 'stopped',
    states: {
      stopped: { props: {} },
      running: { props: { status: 'running' } },
      starting: { props: { status: 'starting' } },
      restarting: { props: { status: 'restarting' } },
      pending: { props: { pending: true } },
      error: { props: { failDeletion: true } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    setupScriptDeletionPreview,
    deletionPreviewWorkspace,
    deletionPreviewScript,
  } from '../../../test/script-deletion-preview';
  import { Button } from '$lib/components/ui/button';
  import * as Menu from '$lib/components/ui/menu';
  import { ConfirmHost } from '$lib/components/patterns/confirm';
  import { Toast } from '$lib/components/ui/toast';
  import { createPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import TerminalTabType from '$features/layout/tab-types/TerminalTabType.svelte';
  import QuakeTerminalOverlay from './QuakeTerminalOverlay.svelte';
  import { store } from '$store/renderer/store';
  import {
    updateRuntimeState,
    startScriptRequested,
  } from '$store/renderer/slices/scripts/scripts-slice';
  import { selectAllTabs } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import { selectWorkspaceTerminalState } from '$store/renderer/slices/terminals/terminals-selectors';

  let {
    status = 'idle',
    failDeletion = false,
    pending = false,
    deferEdits = false,
  }: Props = $props();
  const workspaceId = deletionPreviewWorkspace;
  const scriptId = deletionPreviewScript;
  const header = createPanelHeaderContext();
  let requests = $state<string[]>([]);
  let releaseEdit!: () => void;
  const editGate = new Promise<void>((resolve) => {
    releaseEdit = resolve;
  });
  $effect(() => {
    if (!deferEdits) releaseEdit();
  });
  onDestroy(
    setupScriptDeletionPreview(
      (request) => {
        requests = [...requests, request];
      },
      () => failDeletion,
      () => editGate,
    ),
  );
  const tabs$ = selectAllTabs(workspaceId);
  const terminal$ = selectWorkspaceTerminalState(workspaceId);
  $effect(() => {
    store.dispatch(updateRuntimeState(workspaceId, scriptId, { status }));
  });
  $effect(() => {
    if (pending) store.dispatch(startScriptRequested(workspaceId, scriptId));
  });
</script>

<div
  class="relative h-[600px] w-full bg-background text-foreground"
  data-testid="script-deletion-preview"
>
  <div class="p-4">
    <Menu.Root>
      <Menu.Trigger aria-label="Script panel actions">Script panel actions</Menu.Trigger>
      <Menu.Content>{@render header.actions.current?.actions?.()}</Menu.Content>
    </Menu.Root>
    <Button
      onclick={() =>
        store.dispatch(updateRuntimeState(workspaceId, scriptId, { status: 'running' }))}
      >Simulate start</Button
    >
    <p>Delete requests: {requests.length}</p>
    <p>Selected script: {$terminal$.selectedScriptId ?? 'none'}</p>
    <p>Open script tabs: {$tabs$.length}</p>
  </div>
  {#each $tabs$ as tab (tab.id)}
    <div class="h-40">
      <TerminalTabType {tab} {workspaceId} isActive={true} isPanelFocused={true} />
    </div>
  {/each}
  <QuakeTerminalOverlay {workspaceId} />
  <ConfirmHost />
  <Toast />
</div>
