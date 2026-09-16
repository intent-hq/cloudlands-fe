<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  /**
   * BranchDisplay - Branch display/edit with trunk branch picker
   * Shows working branch (editable) and trunk branch (selectable).
   */
  import { workspaceClient } from '$store/renderer/slices/workspace/utils/workspace.client';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';

  import GitBranchIcon from '$lib/components/icons/GitBranchIcon.svelte';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { notify } from '$lib/components/patterns/notify';
  import { m } from '$shared/paraglide/messages.js';
  import BranchSelector from '$lib/components/workspace/initializer/BranchSelector.svelte';
  import { getBranchNameValidationError } from './sidebar-changes-utils';
  import { logger } from '$lib/utils/client-logger';
  import { WORKSPACE_CHANNELS } from '$shared/ipc/channels';
  import { invoke } from '$shared/generated/ipc-client';
  import type { WorkspaceId } from '$shared/types/branded-ids';
  import { faCheck } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { tick } from 'svelte';
  import { writable } from 'svelte/store';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    workspaceId: string;
    trunkBranch: string;
    repoPath: string;
    repoType: 'local' | 'github';
    canChangeTrunk: boolean;
  }

  let { workspaceId, trunkBranch, repoPath, repoType, canChangeTrunk }: Props = $props();

  const workspaceIdStore = writable('');
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });

  const workspace = selectWorkspaceById(workspaceIdStore);

  // Branch rename state
  let branchRename = $state<{
    active: boolean;
    value: string;
    inputRef: HTMLInputElement | null;
    saving: boolean;
  }>({ active: false, value: '', inputRef: null, saving: false });

  // Branch copy state
  let branchCopy = $state({
    copiedWorking: false,
    workingTooltip: false,
    copiedTrunk: false,
    trunkTooltip: false,
  });

  // Reset branch rename state when workspace changes
  $effect(() => {
    // Subscribe to workspaceId changes
    void workspaceId;
    branchRename.active = false;
    branchRename.value = '';
    branchRename.saving = false;
  });

  async function persistWorkspaceChanges(changes: Record<string, unknown>) {
    const result = await workspaceClient.update({ id: workspaceId as WorkspaceId, ...changes });
    if (result.ok) {
      appStore.dispatch(setWorkspaceEntity(result.data));
    }
    return result;
  }

  function startEditingBranch() {
    if (!$workspace) return;
    branchRename.active = true;
    branchRename.value = $workspace.branch || '';
    tick().then(() => {
      if (branchRename.inputRef) {
        branchRename.inputRef.focus();
        branchRename.inputRef.select();
      }
    });
  }

  async function saveBranch() {
    if (branchRename.saving) return;

    if (!$workspace || !branchRename.value.trim()) {
      branchRename.active = false;
      return;
    }

    const newBranch = branchRename.value.trim();
    if (newBranch === $workspace.branch) {
      branchRename.active = false;
      return;
    }

    const validationError = getBranchNameValidationError(newBranch);
    if (validationError) {
      logger.error('Invalid branch name format', { branchName: newBranch, error: validationError });
      notify.error(validationError);
      branchRename.value = $workspace.branch || '';
      branchRename.active = false;
      return;
    }

    branchRename.saving = true;
    try {
      const result = await invoke<any>(WORKSPACE_CHANNELS.RENAME_BRANCH, {
        id: $workspace.id,
        newBranchName: newBranch,
      });

      if (result.success) {
        await persistWorkspaceChanges({ branch: newBranch });
      } else {
        logger.error('Failed to rename branch', { error: result.error });
        notify.error(result.error || m.workspace_sidebarHeader_renameBranchFailed_error());
        branchRename.value = $workspace.branch || '';
      }
    } catch (error) {
      logger.error('Error renaming branch:', error);
      notify.error(m.workspace_sidebarHeader_renameBranchFailed_error());
      branchRename.value = $workspace.branch || '';
    } finally {
      branchRename.active = false;
      branchRename.saving = false;
    }
  }

  function handleBranchKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveBranch();
    } else if (e.key === 'Escape') {
      branchRename.active = false;
      branchRename.value = $workspace?.branch || '';
    }
  }

  function handleBranchClickOutside(e: MouseEvent) {
    if (
      branchRename.active &&
      branchRename.inputRef &&
      !branchRename.inputRef.contains(e.target as Node)
    ) {
      saveBranch();
    }
  }

  $effect(() => {
    if (branchRename.active) {
      document.addEventListener('mousedown', handleBranchClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleBranchClickOutside);
      };
    }
  });
</script>

<!-- Branch display/edit with trunk branch picker -->
<div
  class="grid grid-cols-[minmax(0,auto)_minmax(1rem,1fr)_auto] items-start gap-x-1 text-subtle text-xs mt-1 mb-2"
>
  <p class="branch-label col-start-1 row-start-1 text-subtle leading-snug type-caption">
    {m.workspace_sidebarChanges_codeLivesIn_label()}
  </p>
  <p
    class="branch-label col-start-3 row-start-1 justify-self-end text-right text-subtle leading-snug type-caption"
  >
    {m.workspace_sidebarChanges_mergedInto_label()}
  </p>

  <!-- Working branch -->
  <div class="col-start-1 row-start-2 flex min-w-0 items-center">
    <GitBranchIcon size={12} class="shrink-0 text-ghost" />
    <div class="relative inline-flex min-w-0 items-center">
      {#if branchRename.active}
        <Input
          bind:ref={branchRename.inputRef}
          type="text"
          bind:value={branchRename.value}
          onblur={saveBranch}
          onkeydown={handleBranchKeydown}
          disabled={branchRename.saving}
          class="inline-edit-input relative z-10 min-w-[60px] max-w-[150px] rounded border-none bg-transparent px-1 py-0.5 text-ui leading-normal text-foreground outline-none transition-all duration-150 focus:outline-none! focus:ring-none! disabled:opacity-50"
          placeholder={m.workspace_sidebarHeader_branchName_placeholder()}
          style="width: {Math.max(60, Math.min(150, (branchRename.value || '').length * 6 + 20))}px"
        />
      {:else}
        <Tooltip side="top" disableCloseOnTriggerClick bind:open={branchCopy.workingTooltip}>
          {#snippet content()}<span
              >{m.workspace_branchDisplay_workingOn_tooltip({
                branch: $workspace?.branch || m.workspace_branchDisplay_noBranch_label(),
              })}</span
            ><br /><span class="text-ghost">{m.workspace_branchDisplay_shiftClickCopy_label()}</span
            >{#if branchCopy.copiedWorking}<span
                class="text-green-500 ml-1.5 inline-flex items-center gap-1"
                ><Fa icon={faCheck} size="xs" /></span
              >{/if}{/snippet}
          <Button
            variant="ghost"
            class="relative z-10 h-5 max-w-full cursor-text overflow-hidden text-ellipsis whitespace-nowrap rounded border-none bg-transparent px-1 py-0 text-left text-ui leading-normal text-subtle transition-all duration-150 hover:text-foreground hover:opacity-80 focus-visible:outline-none! disabled:cursor-default disabled:opacity-50"
            onclick={(e) => {
              if (e.shiftKey && $workspace?.branch) {
                navigator.clipboard.writeText($workspace.branch);
                branchCopy.copiedWorking = true;
                branchCopy.workingTooltip = true;
                setTimeout(() => {
                  branchCopy.copiedWorking = false;
                  branchCopy.workingTooltip = false;
                }, 1500);
              } else {
                startEditingBranch();
              }
            }}
            disabled={!$workspace || branchRename.saving}
          >
            {#if $workspace}
              {$workspace.branch || m.workspace_branchDisplay_noBranch_label()}
            {/if}
          </Button>
        </Tooltip>
      {/if}
      <span
        aria-hidden="true"
        class="pointer-events-none absolute z-0 rounded-(--radius-small) border transition-[inset,border-color,background-color] duration-(--motion-standard) ease-(--ease-standard) motion-reduce:transition-none {branchRename.active
          ? '-inset-x-2 -inset-y-1.5 border-ring/60 bg-sidebar'
          : '-inset-x-1 -inset-y-0.5 border-transparent bg-transparent'}"
      ></span>
    </div>
  </div>

  <!-- <span class="text-ghost mx-auto">→</span> -->
  <div
    class="col-start-2 row-start-2 self-center relative flex-1 ml-0.5 mr-1.5 bg-muted-foreground/70 text-subtle h-px flex items-end opacity-30"
  >
    <span class="absolute -right-0.5 top-1/2 transform -translate-y-1/2">→</span>
  </div>

  <!-- Trunk branch picker -->
  <div
    class="col-start-3 row-start-2 justify-self-end flex items-center justify-end shrink-0 min-w-0 max-w-[min(100%,_10rem)]"
  >
    <Tooltip
      class="min-w-0 max-w-full"
      side="top"
      disableCloseOnTriggerClick
      bind:open={branchCopy.trunkTooltip}
    >
      {#snippet content()}{#if canChangeTrunk}<span
            >{m.workspace_branchDisplay_trunkChange_tooltip()}</span
          >{:else}<span>{m.workspace_branchDisplay_trunkLocked_tooltip()}</span>{/if}<br /><span
          class="text-ghost">{m.workspace_branchDisplay_shiftClickCopy_label()}</span
        >{#if branchCopy.copiedTrunk}<span
            class="text-green-500 ml-1.5 inline-flex items-center gap-1"
            ><Fa icon={faCheck} size="xs" /></span
          >{/if}{/snippet}
      <div
        class="flex items-center min-w-0 max-w-full"
        role="button"
        tabindex="-1"
        onclick={(e) => {
          if (e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            navigator.clipboard.writeText(trunkBranch);
            branchCopy.copiedTrunk = true;
            branchCopy.trunkTooltip = true;
            setTimeout(() => {
              branchCopy.copiedTrunk = false;
              branchCopy.trunkTooltip = false;
            }, 1500);
          }
        }}
        onkeydown={() => {}}
      >
        {#if canChangeTrunk}
          <BranchSelector
            variant="ghost"
            value={trunkBranch}
            {repoPath}
            {repoType}
            dropUp={false}
            portal={true}
            triggerClass="pl-0 pr-0 py-0 h-5 text-ui"
            hasTriggerIcon={false}
            onchange={async (e) => {
              try {
                const result = await persistWorkspaceChanges({
                  baseRef: e.detail.branch,
                });
                if (!result.ok) {
                  notify.error('Failed to update base branch');
                }
              } catch (err) {
                console.error('[BranchDisplay] Update error:', err);
                notify.error('Failed to update base branch');
              }
            }}
          />
        {:else}
          <span class="h-5 leading-5 text-ui text-subtle truncate">
            {trunkBranch || m.workspace_branchSelector_noBranchSelected_label()}
          </span>
        {/if}
      </div>
    </Tooltip>
  </div>
</div>

<style>
  @container (max-width: 250px) {
    .branch-label {
      display: none;
    }
  }

  input.inline-edit-input::selection {
    background: hsl(var(--ring) / 0.3);
  }
</style>
