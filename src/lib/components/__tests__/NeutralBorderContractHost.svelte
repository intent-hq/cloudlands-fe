<script lang="ts">
  import type { PanelState } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import { store as appStore } from '$store/renderer/store';
  import Panel from '$lib/components/layout/panel-system/Panel.svelte';
  import ParkedWorkspaceSurface from '$lib/components/workspace/ParkedWorkspaceSurface.svelte';
  import SidebarBrowserLauncher from '$lib/components/workspace/SidebarBrowserLauncher.svelte';
  import EventSubscriptionsCard from '$lib/components/chat/EventSubscriptionsCard.svelte';
  import PinnedUserPrompt from '$lib/components/chat/PinnedUserPrompt.svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Menu from '$lib/components/ui/menu';
  import { Input } from '$lib/components/ui/input';

  let { theme = 'light', zoom = 1 }: { theme?: 'light' | 'dark'; zoom?: number } = $props();
  let dialogOpen = $state(true);
  let menuOpen = $state(true);
  const panel: PanelState = { id: 'neutral-border-panel', tabs: [], activeTabId: null };

  appStore.init();

  $effect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.body.style.zoom = String(zoom);
    return () => {
      document.documentElement.classList.remove('dark');
      document.body.style.zoom = '';
    };
  });
</script>

<main class="grid w-[900px] grid-cols-2 gap-6 bg-background p-6 text-foreground">
  <section class="h-48" data-testid="workspace-border-fixture">
    <ParkedWorkspaceSurface
      workspaceId="neutral-border-workspace"
      title="Workspace"
      panelTabCount={1}
      sidebarWidth={240}
      onCloseWorkspace={() => {}}
    />
  </section>

  <section class="h-48" data-testid="panel-border-fixture">
    <Panel {panel} workspaceId="neutral-border-workspace" layoutId="neutral-border-layout" />
  </section>

  <section class="w-80" data-testid="subscription-border-fixture">
    <EventSubscriptionsCard
      workspaceId="neutral-border-workspace"
      agentId="neutral-border-agent"
      isolatedPreview={{ count: 2, initiallyExpanded: true, mode: 'generic' }}
    />
  </section>

  <section class="w-80" data-testid="chat-border-fixture">
    <PinnedUserPrompt text="Pinned user prompt" onActivate={() => {}} />
  </section>

  <section class="w-80" data-testid="launcher-border-fixture">
    <SidebarBrowserLauncher workspaceId="neutral-border-workspace" onExpand={() => {}} />
  </section>

  <section class="w-80" data-testid="form-border-fixture">
    <Input aria-label="Neutral border form control" value="Canonical input" />
  </section>

  <section data-testid="popover-border-fixture">
    <Menu.Root bind:open={menuOpen}>
      <Menu.Trigger>Border menu</Menu.Trigger>
      <Menu.Content portal={false}>
        <Menu.Item>Menu item</Menu.Item>
      </Menu.Content>
    </Menu.Root>
  </section>

  <section data-testid="dialog-border-fixture">
    <Dialog.Root bind:open={dialogOpen}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Border dialog</Dialog.Title>
          <Dialog.Description>Production dialog border fixture</Dialog.Description>
        </Dialog.Header>
      </Dialog.Content>
    </Dialog.Root>
  </section>
</main>
