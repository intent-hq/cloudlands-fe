<script lang="ts">
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import OpenComboButton from '$features/external-editors/components/OpenComboButton.svelte';

  interface Props {
    theme?: 'light' | 'dark';
    width?: number;
    zoom?: number;
  }

  let { theme = 'light', width = 720, zoom = 1 }: Props = $props();

  const mockEditors = [
    {
      id: 'vscode',
      name: 'Visual Studio Code',
      shortLabel: 'VS Code',
      category: 'ide' as const,
      installed: true,
    },
    {
      id: 'cursor',
      name: 'Cursor',
      shortLabel: 'Cursor',
      category: 'ide' as const,
      installed: true,
    },
  ];

  const mockActions = [
    ...mockEditors.map((editor) => ({
      id: editor.id,
      label: editor.name,
      shortLabel: editor.shortLabel,
      category: editor.category,
      action: () => handleAction(editor.id),
    })),
    {
      id: 'copy-path',
      label: 'Copy path',
      shortLabel: 'Copy path',
      category: 'utility' as const,
      action: () => handleAction('copy-path'),
    },
  ];

  let actionCount = $state(0);

  function handleAction(actionId: string) {
    actionCount += 1;
    console.log('Action executed:', actionId);
  }
</script>

<div
  class="test-container"
  style={`width: ${width}px; zoom: ${zoom}; padding: 20px;`}
  data-theme={theme}
>
  <div class="test-surface" data-testid="outside-area" style="min-height: 400px; background: var(--color-background);">
    <div style="padding: 100px 20px;">
      <OpenComboButton
        actions={mockActions}
        selectedAction="vscode"
        onChange={(action) => action.action()}
        data-testid="files-open-in"
      />
    </div>
  </div>

  <div data-testid="action-count" style="position: absolute; top: 0; left: 0; opacity: 0;">
    {actionCount}
  </div>
</div>

<style>
  .test-container {
    font-family: system-ui, -apple-system, sans-serif;
  }

  .test-container[data-theme='dark'] {
    --color-background: #1a1a1a;
    --color-card: #2a2a2a;
    --color-foreground: #ffffff;
    --color-muted-foreground: #a0a0a0;
  }

  .test-container[data-theme='light'] {
    --color-background: #ffffff;
    --color-card: #f5f5f5;
    --color-foreground: #000000;
    --color-muted-foreground: #666666;
  }

  .test-surface {
    border-radius: 8px;
  }
</style>
