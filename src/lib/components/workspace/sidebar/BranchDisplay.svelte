<script lang="ts">
  /**
   * BranchDisplay - Branch display/edit with trunk branch picker
   * Shows working branch (editable) and trunk branch (selectable).
   */
  import { workspaceClient } from '$lib/store/slices/workspace/utils/workspace.client';
  import { selectWorkspaceById } from '$lib/store/slices/workspace/workspace-selectors';
  import { setWorkspaceEntity } from '$lib/store/slices/workspace/workspace-slice';

  import GitBranchIcon from '$lib/components/icons/GitBranchIcon.svelte';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { toast } from '$lib/components/ui/toast';
  import BranchSelector from '$lib/components/workspace/initializer/BranchSelector.svelte';
  import { getBranchNameValidationError } from './sidebar-changes-utils';
  import { logger } from '$lib/utils/client-logger';
  import { WORKSPACE_CHANNELS } from '$shared/ipc/channels';
  import type { WorkspaceId } from '$shared/types/branded-ids';
  import { faCheck } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { tick } from 'svelte';
  import { writable } from 'svelte/store';
  import { store as appStore } from '$lib/store/store';

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
  let branchRename = $state<{ active: boolean; value: string; inputRef: HTMLInputElement | null; saving: boolean }>({ active: false, value: '', inputRef: null, saving: false });

  // Branch copy state
  let branchCopy = $state({ copiedWorking: false, workingTooltip: false, copiedTrunk: false, trunkTooltip: false });

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
      toast.error(validationError);
      branchRename.value = $workspace.branch || '';
      branchRename.active = false;
      return;
    }

    branchRename.saving = true;
    try {
      const result = await window.electronAPI.invoke(WORKSPACE_CHANNELS.RENAME_BRANCH, {
        id: $workspace.id,
        newBranchName: newBranch,
      });

      if (result.success) {
        await persistWorkspaceChanges({ branch: newBranch });
      } else {
        logger.error('Failed to rename branch', { error: result.error });
        toast.error(result.error || 'Failed to rename branch');
        branchRename.value = $workspace.branch || '';
      }
    } catch (error) {
      logger.error('Error renaming branch:', error);
      toast.error('Failed to rename branch');
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
    if (branchRename.active && branchRename.inputRef && !branchRename.inputRef.contains(e.target as Node)) {
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
<div class="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-subtle text-xs mb-3 -ml-0.5">
  <!-- Working branch -->
  <div class="flex items-center shrink-0">
    <GitBranchIcon size={12} class="shrink-0 text-ghost" />
    {#if branchRename.active}
      <input
        bind:this={branchRename.inputRef}
        type="text"
        bind:value={branchRename.value}
        onblur={saveBranch}
        onkeydown={handleBranchKeydown}
        disabled={branchRename.saving}
        class="text-ui text-foreground bg-none
               px-1 py-0.5 rounded
               outline-none min-w-[60px] max-w-[150px] leading-normal
               focus:ring-none! focus:outline-none!
               transition-all duration-150 disabled:opacity-50"
        placeholder="branch name"
        style="width: {Math.max(60, Math.min(150, (branchRename.value || '').length * 6 + 20))}px"
      />
    {:else}
      <Tooltip side="top" disableCloseOnTriggerClick bind:open={branchCopy.workingTooltip}>
        {#snippet content()}<span
            >Working on the {$workspace?.branch || 'no branch'} branch. Click to change name.</span
          ><br /><span class="text-ghost">Shift+click to copy</span
          >{#if branchCopy.copiedWorking}<span
              class="text-green-500 ml-1.5 inline-flex items-center gap-1"
              ><Fa icon={faCheck} size="xs" /></span
            >{/if}{/snippet}
        <button
          class="text-ui text-subtle bg-transparent
                 border-none px-1 py-0.5 rounded cursor-pointer text-left
                 max-w-full overflow-hidden text-ellipsis whitespace-nowrap
                 transition-all duration-150 leading-normal
                 hover:text-foreground hover:opacity-80
                 focus-visible:outline-none!
                 disabled:cursor-default disabled:opacity-50"
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
            {$workspace.branch || 'no branch'}
          {/if}
        </button>
      </Tooltip>
    {/if}
  </div>

  <!-- <span class="text-ghost mx-auto">→</span> -->
  <div
    class="relative flex-1 ml-0.5 mr-1.5 bg-muted-foreground/70 text-subtle h-px flex items-end opacity-30"
  >
    <span class="absolute -right-0.5 top-1/2 transform -translate-y-1/2">→</span>
  </div>

  <!-- Trunk branch picker -->
  <div class="flex items-center shrink-0 min-w-0 max-w-[min(100%,_10rem)]">
    <Tooltip
      class="min-w-0 max-w-full"
      side="top"
      disableCloseOnTriggerClick
      bind:open={branchCopy.trunkTooltip}
    >
      {#snippet content()}{#if canChangeTrunk}<span>Trunk branch - click to change</span
          >{:else}<span>Trunk branch (cannot change after pushing)</span>{/if}<br /><span
          class="text-ghost">Shift+click to copy</span
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
        <BranchSelector
          variant="ghost"
          value={trunkBranch}
          {repoPath}
          {repoType}
          disabled={!canChangeTrunk}
          dropUp={false}
          portal={true}
          triggerClass="pl-0 pr-0 h-6 text-ui"
          hasTriggerIcon={false}
          onchange={async (e) => {
            try {
              const result = await persistWorkspaceChanges({
                baseRef: e.detail.branch,
              });
              if (!result.ok) {
                toast.error('Failed to update base branch');
              }
            } catch (err) {
              console.error('[BranchDisplay] Update error:', err);
              toast.error('Failed to update base branch');
            }
          }}
        />
      </div>
    </Tooltip>
  </div>
</div>
