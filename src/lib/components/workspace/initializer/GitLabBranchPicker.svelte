<script lang="ts">
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { ListRow } from '$lib/components/patterns/collection';
  import { Button } from '$lib/components/ui/button';
  import * as Popover from '$lib/components/ui/popover';
  import { useDialogPortalTarget } from '$lib/components/ui/dialog';
  import GitLabPickerList from './GitLabPickerList.svelte';
  import type { GitLabBranchPickerProps } from './gitlab-picker-types';

  let {
    projectPath,
    selectedBranch,
    placeholder,
    protectedLabel,
    triggerClass,
    isLoading = false,
    showTriggerChevron = false,
    triggerChevronClass,
    onSelect,
    onOpenChange,
    ...list
  }: GitLabBranchPickerProps = $props();
  let open = $state(false);
  const dialogPortalTarget = useDialogPortalTarget();
  const loading = $derived(isLoading || list.page.status === 'loading');
</script>

<Popover.Root bind:open onOpenChange={(next) => onOpenChange?.(next, list.scopeKey)}>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="ghost"
        type="button"
        class={`min-w-0 max-w-full text-muted-foreground ${triggerClass ?? ''}`}
        aria-busy={loading}
      >
        <span class="flex min-w-0 items-center gap-0.75 truncate">
          {#if !selectedBranch && loading}
            <IntentMarkLoader size={14} class="text-ghost" />
            <span class="sr-only">{list.copy.loadingLabel}</span>
          {:else}
            <span class="flex-1 min-w-0 text-left truncate"
              >{selectedBranch?.name || placeholder}</span
            >
          {/if}
          {#if showTriggerChevron && !loading}<Fa
              icon={faChevronDown}
              size={10}
              class={triggerChevronClass}
            />{/if}
        </span>
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content
    role="dialog"
    aria-label={list.copy.listLabel}
    class="w-80 max-w-[calc(100vw-2rem)] max-h-[min(600px,var(--bits-popover-content-available-height,100dvh))] overflow-y-auto space-y-2 p-3"
    align="start"
    portalProps={{ to: dialogPortalTarget() }}
    strategy={dialogPortalTarget() ? 'absolute' : 'fixed'}
    onkeydown={(event) => {
      if (event.key === 'Enter') event.stopPropagation();
    }}
  >
    <p class="break-all type-caption text-foreground">{projectPath}</p>
    <GitLabPickerList
      {...list}
      selectedKey={selectedBranch?.name}
      getKey={(branch) => branch.name}
      getText={(branch) => branch.name}
      onSelect={(branch, scopeKey) => {
        onSelect({ name: branch.name, commitSha: branch.commitSha }, scopeKey);
        open = false;
      }}
    >
      {#snippet row({ item })}
        <ListRow>
          {#snippet title()}{item.name}{/snippet}
          {#snippet meta()}{item.protected ? protectedLabel : ''}{/snippet}
        </ListRow>
      {/snippet}
    </GitLabPickerList>
  </Popover.Content>
</Popover.Root>
