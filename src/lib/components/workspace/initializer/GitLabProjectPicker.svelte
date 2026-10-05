<script lang="ts">
  import { ListRow } from '$lib/components/patterns/collection';
  import GitLabPickerList from './GitLabPickerList.svelte';
  import type { GitLabProjectPickerProps } from './gitlab-picker-types';

  let { selectedProjectPath, onSelect, ...list }: GitLabProjectPickerProps = $props();
</script>

<GitLabPickerList
  {...list}
  selectedKey={selectedProjectPath}
  getKey={(project) => project.projectPath}
  getText={(project) => project.projectPath}
  onSelect={(project, scopeKey) => onSelect(project.projectPath, scopeKey)}
>
  {#snippet row({ item })}
    <ListRow>
      {#snippet title()}{item.name}{/snippet}
      {#snippet description()}
        <span class="break-all">{item.projectPath}</span>
      {/snippet}
    </ListRow>
  {/snippet}
</GitLabPickerList>
