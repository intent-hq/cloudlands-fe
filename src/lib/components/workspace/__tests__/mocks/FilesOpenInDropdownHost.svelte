<script lang="ts">
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import * as Menu from '$lib/components/ui/menu';
  import { faArrowUpRightFromSquare } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  interface Props {
    theme?: 'light' | 'dark';
    width?: number;
    zoom?: number;
  }

  let { theme = 'light', width = 720, zoom = 1 }: Props = $props();

  let open = $state(false);
  let actionCount = $state(0);

  const actions = [
    { id: 'vscode', label: 'Visual Studio Code' },
    { id: 'cursor', label: 'Cursor' },
    { id: 'copy-path', label: 'Copy path' },
  ];

  function handleAction(actionId: string) {
    actionCount += 1;
    open = false;
    console.log('Action executed:', actionId);
  }
</script>

<div
  class="test-container"
  style={`width: ${width}px; zoom: ${zoom}; padding: 20px;`}
  data-theme={theme}
>
  <div
    class="test-surface"
    data-testid="outside-area"
    style="min-height: 400px; background: var(--color-background); padding: 100px 20px;"
  >
    <DropdownMenu bind:open align="end" portal={true} side="bottom">
      {#snippet trigger({ props })}
        <button type="button" data-testid="files-open-in-trigger" class="trigger-button" {...props}>
          <Fa icon={faArrowUpRightFromSquare} size="sm" />
          <span>Open in</span>
        </button>
      {/snippet}
      {#snippet content()}
        <div data-testid="files-open-in-content">
          {#each actions as action}
            <Menu.Item onclick={() => handleAction(action.id)}>
              <span>{action.label}</span>
            </Menu.Item>
          {/each}
        </div>
      {/snippet}
    </DropdownMenu>
  </div>

  <div data-testid="action-count" style="position: absolute; top: 0; left: 0; opacity: 0;">
    {actionCount}
  </div>
</div>

<style>
  .test-container {
    font-family:
      system-ui,
      -apple-system,
      sans-serif;
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
