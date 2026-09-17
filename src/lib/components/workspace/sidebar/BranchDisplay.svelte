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
  const fieldId = $props.id();

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
      e.preventDefault();
      e.stopPropagation();
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
<div class="flex min-w-0 flex-col gap-3 mt-1 mb-3" data-branch-summary>
  <div class="flex min-w-0 flex-col gap-1">
    <p
      id={`${fieldId}-working`}
      class="branch-label text-subtle leading-snug type-caption font-normal"
    >
      {m.workspace_sidebarChanges_codeLivesIn_label()}
    </p>

    <!-- Working branch -->
    <div class="min-w-0 w-full" data-branch-field="working">
      {#if branchRename.active}
        <Input
          bind:ref={branchRename.inputRef}
          type="text"
          bind:value={branchRename.value}
          onblur={saveBranch}
          onkeydown={handleBranchKeydown}
          disabled={branchRename.saving}
          size="compact"
          aria-labelledby={`${fieldId}-working`}
          class="text-ui font-normal"
          placeholder={m.workspace_sidebarHeader_branchName_placeholder()}
        />
      {:else}
        <Tooltip
          class="w-full min-w-0"
          side="top"
          disableCloseOnTriggerClick
          bind:open={branchCopy.workingTooltip}
        >
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
            variant="outline"
            size="sm"
            aria-labelledby={`${fieldId}-working ${fieldId}-working-value`}
            class="w-full min-w-0 cursor-text justify-start text-left text-ui font-normal"
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
            {#snippet leadingIcon()}<GitBranchIcon size={14} class="text-subtle" />{/snippet}
            {#if $workspace}
              <span id={`${fieldId}-working-value`} class="truncate">
                {$workspace.branch || m.workspace_branchDisplay_noBranch_label()}
              </span>
            {/if}
          </Button>
        </Tooltip>
      {/if}
    </div>
  </div>

  <!-- Trunk branch picker -->
  <div class="flex min-w-0 flex-col gap-1" data-branch-field="target">
    <p
      id={`${fieldId}-target`}
      class="branch-label text-subtle leading-snug type-caption font-normal"
    >
      {m.workspace_sidebarChanges_mergedInto_label()}
    </p>
    <Tooltip
      class="min-w-0 w-full"
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
        class="min-w-0 w-full"
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
            variant="default"
            value={trunkBranch}
            {repoPath}
            {repoType}
            dropUp={false}
            portal={true}
            triggerClass="h-(--control-height-small) text-ui font-normal text-foreground"
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
          <Input
            readonly
            size="compact"
            aria-labelledby={`${fieldId}-target`}
            value={trunkBranch || m.workspace_branchSelector_noBranchSelected_label()}
            class="text-ui font-normal cursor-default"
          />
        {/if}
      </div>
    </Tooltip>
  </div>
</div>
