<script lang="ts">
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { ListRow } from '$lib/components/patterns/collection';
  import { Button } from '$lib/components/ui/button';
  import GitBranchIcon from '$lib/components/icons/GitBranchIcon.svelte';
  import * as Popover from '$lib/components/ui/popover';
  import { useDialogPortalTarget } from '$lib/components/ui/dialog';
  import GitLabPickerList from './GitLabPickerList.svelte';
  import type { GitLabBranchPickerProps } from './gitlab-picker-types';
  import { IsMobile } from '$lib/hooks/is-mobile.svelte.js';
  import { Indicator } from '$lib/components/ui/menu';
  import { workspacePickerStyles } from './workspace-picker-styles';

  let {
    projectPath,
    selectedBranch,
    placeholder,
    protectedLabel,
    triggerClass,
    rowLabel,
    isLoading = false,
    showTriggerChevron = false,
    triggerChevronClass,
    onSelect,
    onOpenChange,
    ...list
  }: GitLabBranchPickerProps = $props();
  let open = $state(false);
  const dialogPortalTarget = useDialogPortalTarget();
  const isMobile = new IsMobile();
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
        wrapContent={!rowLabel}
      >
        <span class="flex w-full min-w-0 items-center truncate {rowLabel ? 'gap-2' : 'gap-0.75'}">
          {#if rowLabel}
            <span class={workspacePickerStyles.fieldLabel}>{rowLabel}</span>
          {/if}
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
    aria-label={rowLabel ?? list.copy.listLabel}
    class={rowLabel
      ? 'flex w-[360px] max-w-[calc(100vw-1rem)] min-w-0 max-h-[min(440px,var(--bits-popover-content-available-height,calc(100dvh-1rem)))] flex-col overflow-hidden'
      : 'w-80 max-w-[calc(100vw-2rem)] max-h-[min(600px,var(--bits-popover-content-available-height,100dvh))] overflow-y-auto space-y-2 p-3'}
    side={rowLabel ? (isMobile.current ? 'bottom' : 'left') : undefined}
    sideOffset={rowLabel ? (isMobile.current ? 4 : 24) : undefined}
    align={rowLabel && isMobile.current ? 'end' : 'start'}
    portalProps={{ to: dialogPortalTarget() }}
    strategy={dialogPortalTarget() ? 'absolute' : 'fixed'}
    onkeydown={(event) => {
      if (event.key === 'Enter') event.stopPropagation();
    }}
  >
    {#if rowLabel}
      <div class={workspacePickerStyles.header}>
        <h2 class={workspacePickerStyles.title}>{rowLabel}</h2>
        <p class="{workspacePickerStyles.description} break-all">{projectPath}</p>
      </div>
    {:else}
      <p class="break-all type-caption text-foreground">{projectPath}</p>
    {/if}
    <GitLabPickerList
      {...list}
      compact={Boolean(rowLabel)}
      selectedKey={selectedBranch?.name}
      getKey={(branch) => branch.name}
      getText={(branch) => branch.name}
      onSelect={(branch, scopeKey) => {
        onSelect({ name: branch.name, commitSha: branch.commitSha }, scopeKey);
        open = false;
      }}
    >
      {#snippet row({ item, selected })}
        {#if rowLabel}
          <div class="flex {workspacePickerStyles.row}">
            <GitBranchIcon size={16} class={workspacePickerStyles.icon} />
            <span class="min-w-0 flex-1 truncate">{item.name}</span>
            {#if item.protected}
              <span class="type-caption shrink-0 text-muted-foreground">{protectedLabel}</span>
            {/if}
            <Indicator state={selected ? 'checked' : 'empty'} class={workspacePickerStyles.check} />
          </div>
        {:else}
          <ListRow>
            {#snippet title()}{item.name}{/snippet}
            {#snippet meta()}{item.protected ? protectedLabel : ''}{/snippet}
          </ListRow>
        {/if}
      {/snippet}
    </GitLabPickerList>
  </Popover.Content>
</Popover.Root>
