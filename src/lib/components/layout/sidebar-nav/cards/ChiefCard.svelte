<script lang="ts" module>
  import { Button } from '$lib/components/ui/button';
  // The Chief chat can render in two sidebar hosts at once (the hover card and
  // combined workspace panel). The chief virtual workspace is shared, so
  // mount/unmount is refcounted: only the last live instance unmounts it.
  let chiefMountCount = 0;
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { faChevronDown, faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { m } from '$shared/paraglide/messages.js';
  import { notify } from '$lib/components/patterns/notify';
  import ChatPanel from '$lib/components/chat/ChatPanel.svelte';
  import { Select } from '$lib/components/ui/select';
  import { store as appStore } from '$store/renderer/store';
  import {
    setChiefActiveAgentId,
    openPanel,
    setChiefCollapsed,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import {
    selectChiefActiveAgentId,
    selectCurrentChiefThread,
    selectChiefThreadPreview,
    selectChiefThreads,
    selectReusableChiefThread,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import {
    workspaceMounted,
    workspaceUnmounted,
  } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
  import { agentSessionLaunchAgentRequested } from '$store/renderer/slices/agent-session/agent-session-slice';
  import {
    deleteAgentWithUndoRequested,
    setActiveAgentId,
  } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import { selectAgentsLoaded } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { selectHasResolvableProvider } from '$store/renderer/slices/model/model-selectors';
  import { selectHidesAgentLifecycleActions } from '$store/renderer/slices/workspace/workspace-selectors';
  import { createAgentTypeId } from '$shared/types/agent.types';
  import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
  import {
    buildChiefBehaviorPrompt,
    CHIEF_PROMPT_VERSION,
    CHIEF_SPECIALIST_ID,
  } from '$shared/chief-agent-config';
  import { WorkspaceStatus, type Workspace } from '$shared/types';
  import { formatChiefThreadName } from './chief-thread-name';
  import { ensureChiefThreadCreation } from './chief-thread-creation';
  import { resolveChiefThreadOnExpansion } from './chief-thread-selection';
  import {
    selectEffectiveBehaviorPrompt,
    selectSpecialists,
  } from '$store/renderer/slices/specialists/specialists-selectors';

  const chiefPreview$ = selectChiefThreadPreview();
  const chiefThreads$ = selectChiefThreads();
  const currentChiefThread$ = selectCurrentChiefThread();
  const chiefActiveAgentId$ = selectChiefActiveAgentId();
  const chiefAgentsLoaded$ = selectAgentsLoaded(CHIEF_WORKSPACE_ID);
  const hasResolvableProvider$ = selectHasResolvableProvider();
  // Chief threads are agents: creating / deleting one is refused (-32003) for
  // a collaborator connection, so the affordances (and the auto-start) are
  // withheld in a guest window.
  const hidesAgentLifecycleActions$ = selectHidesAgentLifecycleActions(CHIEF_WORKSPACE_ID);

  interface Props {
    expanded?: boolean;
    /** Rendered inside the combined Home panel: the panel owns the close
        button and height, so hide the close X and don't force a min height. */
    embedded?: boolean;
    /** Mount chat on first activation, then retain drafts without claiming focus or read state. */
    isActive?: boolean;
    collapsed?: boolean;
    ontoggle?: () => void;
  }

  let {
    expanded = false,
    embedded = false,
    isActive = true,
    collapsed = false,
    ontoggle,
  }: Props = $props();

  const CHIEF_WORKSPACE_TIMESTAMP = '2026-01-01T00:00:00.000Z';
  const chiefWorkspace: Workspace = {
    id: CHIEF_WORKSPACE_ID,
    title: m.layout_chiefCard_title(),
    branch: '',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    createdAt: CHIEF_WORKSPACE_TIMESTAMP,
    updatedAt: CHIEF_WORKSPACE_TIMESTAMP,
    lastActivity: CHIEF_WORKSPACE_TIMESTAMP,
  };

  let selectedAgentId = $state<string | null>(null);
  let isCreatingThread = $state(false);
  let hasAutoStartedRef = $state(false);
  let isWorkspaceRegistered = $state(false);
  let hasActivatedChat = $state(false);

  const activeChiefThread = $derived(
    $chiefActiveAgentId$
      ? $chiefThreads$.find((thread) => thread.agentId === $chiefActiveAgentId$)
      : null,
  );
  const defaultThread = $derived(
    activeChiefThread ??
      $chiefThreads$.find((thread) => thread.isActive) ??
      $chiefThreads$.find((thread) => thread.messageCount > 0) ??
      $chiefThreads$[0] ??
      null,
  );
  const activeThread = $derived(
    activeChiefThread ??
      $chiefThreads$.find((thread) => thread.agentId === selectedAgentId) ??
      defaultThread,
  );
  // ChatPanel prop/key expressions re-evaluate lazily, so they must never
  // dereference a possibly-null activeThread (it can empty while mounted).
  const activeAgentId = $derived(activeThread?.agentId ?? null);
  const currentPreview = $derived(activeThread ?? $chiefPreview$);
  const title = $derived(currentPreview?.title ?? m.layout_chiefCard_startThread_label());
  const preview = $derived(currentPreview?.preview ?? m.layout_chiefCard_preview_description());

  function ensureChiefWorkspaceRegistered() {
    if (isWorkspaceRegistered) return;
    appStore.dispatch(setWorkspaceEntity(chiefWorkspace));
    if (chiefMountCount === 0) {
      appStore.dispatch(workspaceMounted(CHIEF_WORKSPACE_ID));
    }
    chiefMountCount++;
    isWorkspaceRegistered = true;
  }

  $effect.pre(() => {
    ensureChiefWorkspaceRegistered();
  });

  $effect.pre(() => {
    // ChatPanel initializes its transcript on mount, even when inactive.
    // Defer that first mount until selection, then keep the draft alive on tab changes.
    if (expanded && isActive && activeAgentId) hasActivatedChat = true;
  });

  $effect(() => {
    if (activeChiefThread && selectedAgentId !== activeChiefThread.agentId) {
      selectedAgentId = activeChiefThread.agentId;
      return;
    }
    if (selectedAgentId && $chiefThreads$.some((thread) => thread.agentId === selectedAgentId))
      return;
    selectedAgentId = defaultThread?.agentId ?? null;
  });

  $effect(() => {
    if (
      !expanded ||
      !isActive ||
      !isWorkspaceRegistered ||
      !$chiefAgentsLoaded$ ||
      isCreatingThread ||
      hasAutoStartedRef
    ) {
      return;
    }
    // Preserve an exact-message deep-link selection, including an older Chief
    // thread. Otherwise migrate to the latest current-identity thread.
    const threadToSelect = resolveChiefThreadOnExpansion(
      $chiefThreads$,
      $chiefActiveAgentId$,
      $currentChiefThread$,
    );
    if (threadToSelect) {
      hasAutoStartedRef = true;
      const agentId = threadToSelect.agentId;
      selectedAgentId = agentId;
      appStore.dispatch(setChiefActiveAgentId(agentId));
      appStore.dispatch(setActiveAgentId(CHIEF_WORKSPACE_ID, agentId));
      return;
    }
    // No resolvable provider/model (fresh backend, providers.active unset):
    // agent.create would be rejected by the daemon, so skip silently and let
    // this effect retry once a provider is configured. Likewise for a
    // collaborator connection, whose agent.create is refused (-32003).
    if (!$hasResolvableProvider$ || $hidesAgentLifecycleActions$) return;
    hasAutoStartedRef = true;
    void createNewThread();
  });

  onDestroy(() => {
    if (!isWorkspaceRegistered) return;
    chiefMountCount = Math.max(0, chiefMountCount - 1);
    if (chiefMountCount === 0) {
      appStore.dispatch(workspaceUnmounted(CHIEF_WORKSPACE_ID));
    }
  });

  function openChiefPanel() {
    appStore.dispatch(openPanel('chief'));
  }

  function handleHeaderRowClick() {
    if (collapsed) ontoggle?.();
  }

  function handleToggleClick(event: MouseEvent) {
    event.stopPropagation();
    ontoggle?.();
  }

  function handleThreadChange(value: string | string[]) {
    if (typeof value === 'string') {
      selectedAgentId = value;
      appStore.dispatch(setChiefActiveAgentId(value));
      appStore.dispatch(setActiveAgentId(CHIEF_WORKSPACE_ID, value));
    }
  }

  function handleNewThreadClick() {
    if ($hidesAgentLifecycleActions$) return;
    appStore.dispatch(setChiefCollapsed(false));
    void createNewThread();
  }

  function handleDeleteThread(event: MouseEvent, agentId: string, threadTitle: string) {
    event.preventDefault();
    event.stopPropagation();
    if ($hidesAgentLifecycleActions$) return;
    appStore.dispatch(deleteAgentWithUndoRequested(CHIEF_WORKSPACE_ID, agentId, threadTitle));
  }

  async function createNewThread() {
    if (isCreatingThread) return;
    ensureChiefWorkspaceRegistered();

    const reduxState = appStore.state;

    // Reuse only blank threads created with the current Chief identity contract.
    // A system prompt is fixed at agent creation, so selecting an older blank
    // thread would silently preserve its stale generic-agent identity.
    const emptyThread = selectReusableChiefThread.select(reduxState);
    if (emptyThread) {
      selectedAgentId = emptyThread.agentId;
      appStore.dispatch(setChiefActiveAgentId(emptyThread.agentId));
      appStore.dispatch(setActiveAgentId(CHIEF_WORKSPACE_ID, emptyThread.agentId));
      return;
    }

    isCreatingThread = true;
    let ownsCreation = false;
    const creation = ensureChiefThreadCreation(() => {
      ownsCreation = true;
      const chiefSpecialist = selectSpecialists
        .select(reduxState)
        .find((s) => s.id === CHIEF_SPECIALIST_ID);
      const chiefBehaviorPrompt = buildChiefBehaviorPrompt(
        selectEffectiveBehaviorPrompt.select(reduxState, CHIEF_SPECIALIST_ID),
      );
      const action = agentSessionLaunchAgentRequested(
        CHIEF_WORKSPACE_ID,
        {
          name: formatChiefThreadName(new Date()),
          // Generated timestamp name — keep the session self-renameable.
          nameExplicitlySet: false,
          agentType: createAgentTypeId('workspace'),
          source: 'chief-card',
          behaviorPrompt: chiefBehaviorPrompt,
          metadata: {
            source: 'chief-card',
            chiefWorkspace: true,
            chiefPromptVersion: CHIEF_PROMPT_VERSION,
            specialist: CHIEF_SPECIALIST_ID,
            specialistName: chiefSpecialist?.name ?? m.layout_chiefCard_title(),
            roleReminder: chiefSpecialist?.roleReminder,
            behaviorPrompt: chiefBehaviorPrompt,
          },
        },
        { openAgent: false },
      );

      return appStore.dispatch(action).then((session) => String(session.id));
    });

    try {
      const agentId = await creation;
      selectedAgentId = agentId;
      appStore.dispatch(setChiefActiveAgentId(agentId));
      appStore.dispatch(setActiveAgentId(CHIEF_WORKSPACE_ID, agentId));
    } catch (error) {
      if (ownsCreation) {
        const message = error instanceof Error ? error.message : String(error);
        notify.error(m.layout_chiefCard_startFailed_error({ message }));
      }
    } finally {
      isCreatingThread = false;
    }
  }
</script>

{#if !expanded}
  <div class="p-3">
    <Button
      variant="ghost"
      type="button"
      class="block w-full cursor-pointer rounded-sm text-left outline-none"
      onclick={openChiefPanel}
      aria-label={m.layout_chiefCard_open_ariaLabel()}
    >
      <p class="type-body truncate font-medium text-foreground">{title}</p>
      <p class="type-caption mt-1 text-muted-foreground line-clamp-3">{preview}</p>
    </Button>
  </div>
{:else}
  <div class="flex h-full flex-col {embedded ? 'min-h-0' : 'min-h-[460px]'}">
    <!-- Keyboard users can use either child button; the row click expands empty space. -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="flex shrink-0 items-center justify-between gap-1 px-2 pb-1.5 pt-2 {collapsed
        ? 'cursor-pointer'
        : ''}"
      data-chief-header-row
      onclick={handleHeaderRowClick}
    >
      <div class="flex min-w-0 flex-1 items-center gap-1.5">
        {#if collapsed && ontoggle}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            class="flex h-7! min-w-0 max-w-full flex-1 items-center justify-start px-1.5! text-foreground"
            aria-expanded="false"
            aria-controls="combined-panel-chief-content"
          >
            <span class="text-ui min-w-0 flex-1 truncate text-left font-medium">
              {activeThread?.title ?? m.layout_chiefCard_startThread_label()}
            </span>
          </Button>
        {:else}
          <Select.Root value={selectedAgentId ?? ''} onchange={handleThreadChange}>
            <Select.Trigger
              variant="ghost"
              aria-label={m.layout_chiefCard_threadPicker_ariaLabel()}
              class="h-7! max-w-full min-w-0 justify-start gap-1.5 px-1.5! text-foreground hover:bg-muted/50"
            >
              <span class="text-ui min-w-0 flex-1 truncate text-left font-medium">
                {activeThread?.title ?? m.layout_chiefCard_startThread_label()}
              </span>
            </Select.Trigger>
            <Select.Content portal class="min-w-48 max-w-[calc(100vw-32px)] sm:max-w-80">
              {#each $chiefThreads$ as thread (thread.agentId)}
                <Select.Item value={thread.agentId} label={thread.title}>
                  <span class="flex min-w-0 items-center gap-1.5">
                    {#if thread.isActive}
                      <span
                        class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                        aria-label={m.layout_chiefCard_activeThread_ariaLabel()}
                      ></span>
                    {/if}
                    <span class="truncate">{thread.title}</span>
                  </span>
                </Select.Item>
              {:else}
                <div role="status" class="type-caption px-3 py-4 text-center text-subtle">
                  {m.layout_chiefCard_noThreads_label()}
                </div>
              {/each}
            </Select.Content>
          </Select.Root>
          {#if activeThread && !$hidesAgentLifecycleActions$}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={m.layout_chiefCard_deleteThread_ariaLabel({ title: activeThread.title })}
              title={m.layout_chiefCard_deleteThread_tooltip()}
              onclick={(event) => {
                if (activeThread)
                  handleDeleteThread(event, activeThread.agentId, activeThread.title);
              }}
            >
              <Fa icon={faTrash} size="xs" />
            </Button>
          {/if}
        {/if}
      </div>
      {#if !$hidesAgentLifecycleActions$}
        <div
          class="flex shrink-0 items-center overflow-hidden transition-[width,opacity,margin] duration-spring-moderate ease-spring-moderate motion-reduce:transition-none {collapsed
            ? 'pointer-events-none -mr-1 w-0 opacity-0'
            : 'mr-0 w-6 opacity-100'}"
        >
          <Button
            variant="ghost"
            size="icon-compact"
            class="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            onclick={handleNewThreadClick}
            disabled={isCreatingThread || collapsed}
            tabindex={collapsed ? -1 : undefined}
            aria-hidden={collapsed ? 'true' : undefined}
            aria-label={m.layout_chiefCard_newThread_tooltip()}
            title={m.layout_chiefCard_newThread_tooltip()}
          >
            {#if isCreatingThread}
              <IntentMarkLoader size={12} />
            {:else}
              <Fa icon={faPlus} size="xs" />
            {/if}
          </Button>
        </div>
      {/if}
      {#if ontoggle}
        <Button
          type="button"
          variant="ghost-light"
          size="icon-xs"
          class="flex h-7 w-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:outline-1 focus-visible:outline-ring"
          aria-label={m.layout_chiefCard_title()}
          aria-expanded={!collapsed}
          aria-controls="combined-panel-chief-content"
          data-chief-section-toggle
          onclick={handleToggleClick}
        >
          <Fa
            icon={faChevronDown}
            size="xs"
            class="shrink-0 transition-transform {collapsed ? 'rotate-90' : ''}"
          />
        </Button>
      {/if}
    </div>

    <!-- Clip on the padded wrapper (not the inner section) with an 8px clip
         margin so the composer's streaming aurora can bleed across the px-2
         inset and the app frame's window inset, while transcript content
         still cannot overflow the panel. The margin is omnidirectional (no
         per-side form exists, and a clip-path here would clip fixed-position
         dialogs rendered in this subtree), so a very short pane can overdraw
         up to 8px above — accepted as cosmetic. -->
    <div
      id={ontoggle ? 'combined-panel-chief-content' : undefined}
      class="min-h-0 flex-1 overflow-clip px-2 pt-0 [overflow-clip-margin:0.5rem]"
      hidden={Boolean(ontoggle && collapsed)}
    >
      <section class="flex h-full min-h-0 flex-col">
        {#if hasActivatedChat && activeAgentId}
          {#key activeAgentId}
            <div class="min-h-0 flex-1">
              <ChatPanel
                workspace={chiefWorkspace}
                agentId={activeAgentId}
                agentName={m.layout_chiefCard_title()}
                isActive={isActive && !collapsed}
                autoFocus={isActive && !collapsed && !embedded}
              />
            </div>
          {/key}
        {/if}
      </section>
    </div>
  </div>
{/if}
