<script lang="ts">
  import { onMount } from 'svelte';
  import type { AgentMessage, AgentSession } from '$shared/types';
  import { CHIEF_PROMPT_VERSION, CHIEF_SPECIALIST_ID } from '$shared/chief-agent-config';
  import { CHIEF_WORKSPACE_ID } from '$store/renderer/slices/sidebar-nav/sidebar-nav-types';
  import { store } from '$store/renderer/store';
  import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
  import { setAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import ChatPanelOperationalGeometryHost from '$lib/components/chat/__tests__/ChatPanelOperationalGeometryHost.svelte';
  import ChiefCard from '$lib/components/layout/sidebar-nav/cards/ChiefCard.svelte';
  import PanelEmptyState from '$lib/components/layout/panel-system/PanelEmptyState.svelte';
  import SidebarBrowserLauncher from '$lib/components/workspace/SidebarBrowserLauncher.svelte';
  import ModelPicker from '$lib/components/chat/input/ModelPicker.svelte';
  import AgentAvatarWithState from '$features/agent/components/agent-avatar/AgentAvatarWithState.svelte';
  import NoteContentSurface from '$features/layout/tab-types/NoteContentSurface.svelte';
  import * as Menu from '$lib/components/ui/menu';

  let {
    preference = 'light',
    resolvedTheme = 'light',
    zoom = 1,
    viewportWidth = 1280,
  }: {
    preference?: 'light' | 'dark' | 'system';
    resolvedTheme?: 'light' | 'dark';
    zoom?: number;
    viewportWidth?: number;
  } = $props();

  const workspaceId = 'chat-panel-operational-geometry';
  const chiefAgentId = 'deferred-theme-chief';
  const timestamp = '2026-08-21T12:00:00.000Z';
  const logicalWidth = $derived(Math.max(300, Math.floor((viewportWidth - 24) / zoom)));
  const chatWidth = $derived(Math.max(260, Math.min(720, logicalWidth - 32)));
  let menuOpen = $state(true);

  const chiefMessages: AgentMessage[] = [
    {
      id: 'chief-user',
      role: 'user',
      content: 'Review the deferred theme surfaces.',
      contentBlocks: [{ type: 'text', text: 'Review the deferred theme surfaces.' }],
      timestamp,
    } as AgentMessage,
    {
      id: 'chief-assistant',
      role: 'assistant',
      content: 'The semantic surface review is ready.',
      contentBlocks: [{ type: 'text', text: 'The semantic surface review is ready.' }],
      timestamp,
    } as AgentMessage,
  ];
  const chiefSession = {
    id: chiefAgentId,
    workspaceId: CHIEF_WORKSPACE_ID,
    name: 'Chief',
    status: 'idle',
    isActive: false,
    messages: chiefMessages,
    metadata: { specialist: CHIEF_SPECIALIST_ID, chiefPromptVersion: CHIEF_PROMPT_VERSION },
    createdAt: timestamp,
    updatedAt: timestamp,
  } as unknown as AgentSession;

  onMount(() => {
    store.dispatch(bulkUpsertSessions([chiefSession], { preserveExplicitRuntimeFlags: false }));
    store.dispatch(setAgents(CHIEF_WORKSPACE_ID, [chiefSession]));
  });

  $effect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
    return () => document.documentElement.classList.remove('dark');
  });
</script>

<main
  class:dark={resolvedTheme === 'dark'}
  class="grid grid-cols-1 gap-4 bg-background p-3 text-foreground xl:grid-cols-2"
  style:width="{logicalWidth}px"
  style:zoom
  data-testid="deferred-theme-real-surface-host"
  data-theme-preference={preference}
  data-resolved-theme={resolvedTheme}
>
  <section data-real-surface="regular-chat">
    <ChatPanelOperationalGeometryHost theme={resolvedTheme} width={chatWidth} zoom={1} />
  </section>

  <div class="grid min-w-0 gap-4">
    <aside
      class="grid gap-3 rounded-lg border border-border bg-sidebar p-3"
      data-real-surface="sidebar"
    >
      <SidebarBrowserLauncher {workspaceId} panelLayoutId={workspaceId} onExpand={() => {}} />
      <div class="flex flex-wrap items-center gap-3">
        <div data-real-surface="model-picker">
          <ModelPicker
            selectedModel={null}
            defaultModelLabel="Sonnet 4.6"
            variant="outline"
            portal={false}
          />
        </div>
        <div data-real-surface="avatar">
          <AgentAvatarWithState agentId="deferred-theme-avatar" state="idle" variant="standard" />
        </div>
        <div data-real-surface="menu">
          <Menu.Root bind:open={menuOpen}>
            <Menu.Trigger>Surface menu</Menu.Trigger>
            <Menu.Content portal={false}>
              <Menu.Item>Open surface</Menu.Item>
              <Menu.Item>Inspect tokens</Menu.Item>
            </Menu.Content>
          </Menu.Root>
        </div>
      </div>
    </aside>

    <section class="min-w-0" style:height="34rem" data-real-surface="chief">
      <ChiefCard expanded />
    </section>

    <section class="h-48 overflow-hidden rounded-lg border border-border" data-real-surface="note">
      <NoteContentSurface state="editor">
        <article class="p-5">
          <h2 class="text-lg font-semibold">Semantic note surface</h2>
          <p class="mt-2 text-muted-foreground">Muted note metadata remains readable.</p>
        </article>
      </NoteContentSurface>
    </section>

    <section
      class="overflow-hidden rounded-lg border border-border"
      style:height="28rem"
      data-real-surface="empty-state"
    >
      <PanelEmptyState {workspaceId} panelId="deferred-theme-empty-panel" />
    </section>
  </div>
</main>
