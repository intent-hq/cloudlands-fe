<script lang="ts">
  import { ListRow } from '$lib/components/patterns/collection';
  import { Button } from '$lib/components/ui/button';
  import * as Popover from '$lib/components/ui/popover';
  import GitLabPickerList from './GitLabPickerList.svelte';
  import type { GitLabBranchPickerProps } from './gitlab-picker-types';

  let {
    projectPath,
    selectedBranch,
    placeholder,
    protectedLabel,
    triggerClass,
    onSelect,
    onOpenChange,
    ...list
  }: GitLabBranchPickerProps = $props();
  let open = $state(false);
</script>

<Popover.Root bind:open onOpenChange={(next) => onOpenChange?.(next, list.scopeKey)}>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button {...props} variant="ghost" type="button" class={triggerClass}>
        <span class="truncate">{selectedBranch?.name || placeholder}</span>
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content class="w-80 max-w-[calc(100vw-2rem)] space-y-2" align="start">
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
