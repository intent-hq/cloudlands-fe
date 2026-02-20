<script lang="ts">
  import FileActionsDropdown from '../FileActionsDropdown.svelte';

  export let filePath: string = '/test/file.ts';
  export let workspaceId: string = '';
  export let isDirectory: boolean = false;
  export let variant: 'default' | 'ghost' | 'outline' = 'ghost';
  export let size: 'xs' | 'sm' | 'lg' = 'sm';
  export let label: string = 'Open';
  export let isCompact: boolean = false;
  export let workspaceFolderPath: string = '';
  export let isDiff: boolean = false;
  export let isWorkspaceRoot: boolean = false;
  export let additionalActions: any[] = [];
  // These props are for test compatibility but not yet used in FileActionsDropdown
  export let disabled: boolean = false;
  export let showChevron: boolean = false;
  export let onAction: ((action: string) => void) | undefined = undefined;
  export let menuItems: any[] = [];

  // Reference unused props to avoid warnings
  (void disabled, showChevron, onAction, menuItems);
</script>

<!-- Wrapper div to ensure component renders -->
<div data-testid="file-actions-wrapper">
  <FileActionsDropdown
    {filePath}
    {workspaceId}
    {isDirectory}
    {variant}
    {size}
    {label}
    {isCompact}
    {workspaceFolderPath}
    {isDiff}
    {isWorkspaceRoot}
    {additionalActions}
  />
</div>
