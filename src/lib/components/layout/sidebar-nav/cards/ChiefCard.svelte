<script lang="ts" module>
  import { Button } from '$lib/components/ui/button';
  let chiefMountCount = 0;
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { faChevronDown, faPen, faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { m } from '$shared/paraglide/messages.js';
  import { v4 as uuidv4 } from 'uuid';
  import ChatPanel from '$lib/components/chat/ChatPanel.svelte';
  import AssistantThreadRenameDialog from '$lib/components/chat/AssistantThreadRenameDialog.svelte';
  import type { ChiefThreadSummary } from '$store/renderer/slices/sidebar-nav/sidebar-nav-types';
  import { Select } from '$lib/components/ui/select';
  import { store as appStore } from '$store/renderer/store';
  import {
    closePanel,
    setChiefActiveAgentId,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import {
    selectChiefActiveAgentId,
    selectCurrentChiefThread,
    selectChiefThreads,
    selectReusableChiefThread,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import {
    workspaceMounted,
    workspaceUnmounted,
  } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
  import {
    clearAgentCreationOutcome,
    createAgentFromConfigRequested,
    deleteAgentWithUndoRequested,
    setActiveAgentId,
  } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import {
    selectAgentCreationOutcome,
    selectAgentsLoaded,
  } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { selectContextSelectedModel } from '$store/renderer/slices/provider-catalog/workspace-catalog-selectors';
  import { selectEffectiveDefaultProviderId } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
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
  import { resolveChiefThreadOnExpansion } from './chief-thread-selection';
  import {
    selectEffectiveBehaviorPrompt,
    selectSpecialists,
  } from '$store/renderer/slices/specialists/specialists-selectors';

  const chiefThreads$ = selectChiefThreads();
  const currentChiefThread$ = selectCurrentChiefThread();
  const chiefActiveAgentId$ = selectChiefActiveAgentId();
  const chiefAgentsLoaded$ = selectAgentsLoaded(CHIEF_WORKSPACE_ID);
  const creationConsumer = { id: uuidv4(), resourceId: 'chief-thread' };
  const creationOutcome$ = selectAgentCreationOutcome(
    creationConsumer.id,
    CHIEF_WORKSPACE_ID,
    creationConsumer.resourceId,
  );
  const hasResolvableProvider$ = selectHasResolvableProvider();
  // Chief threads are agents: creating / deleting one is refused (-32003) for
  // a collaborator connection, so the affordances (and the auto-start) are
  // withheld in a guest window.
  const hidesAgentLifecycleActions$ = selectHidesAgentLifecycleActions(CHIEF_WORKSPACE_ID);

  let { isActive = true, threadPicker = true }: { isActive?: boolean; threadPicker?: boolean } =
    $props();

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
  let renaming = $state<{ thread: ChiefThreadSummary; returnFocus: HTMLButtonElement } | null>(
    null,
  );
  const isCreatingThread = $derived($creationOutcome$?.status === 'pending');
  let hasAutoStartedRef = $state(false);
  let isWorkspaceRegistered = $state(false);
  let hasActivatedChat = $state(false);
  let hadThreads = false;

  $effect(() => {
    const hasThreads = $chiefThreads$.length > 0;
    // Removing the last thread should return Assistant to its first-start flow.
    // Reset only on that transition so a failed creation cannot retry forever.
    if (hadThreads && !hasThreads) hasAutoStartedRef = false;
    hadThreads = hasThreads;
  });

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
    if (isActive && activeAgentId) hasActivatedChat = true;
  });

  $effect(() => {
    if (activeChiefThread && selectedAgentId !== activeChiefThread.agentId) {
      selectedAgentId = activeChiefThread.agentId;
      return;
    }
    if (selectedAgentId && $chiefThreads$.some((thread) => thread.agentId === selectedAgentId))
      return;
    selectedAgentId = defaultThread?.agentId ?? null;
    if ($chiefActiveAgentId$ && selectedAgentId !== $chiefActiveAgentId$) {
      appStore.dispatch(setChiefActiveAgentId(selectedAgentId));
      appStore.dispatch(setActiveAgentId(CHIEF_WORKSPACE_ID, selectedAgentId));
    }
  });

  $effect(() => {
    if (
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
    appStore.dispatch(clearAgentCreationOutcome(creationConsumer.id));
    if (!isWorkspaceRegistered) return;
    chiefMountCount = Math.max(0, chiefMountCount - 1);
    if (chiefMountCount === 0) {
      appStore.dispatch(closePanel());
      appStore.dispatch(workspaceUnmounted(CHIEF_WORKSPACE_ID));
    }
  });

  function handleThreadChange(value: string | string[]) {
    if (typeof value === 'string') {
      selectedAgentId = value;
      appStore.dispatch(setChiefActiveAgentId(value));
      appStore.dispatch(setActiveAgentId(CHIEF_WORKSPACE_ID, value));
    }
  }

  function handleNewThreadClick() {
    if ($hidesAgentLifecycleActions$) return;
    void createNewThread();
  }

  function handleDeleteThread(event: MouseEvent, agentId: string, threadTitle: string) {
    event.preventDefault();
    event.stopPropagation();
    if ($hidesAgentLifecycleActions$) return;
    appStore.dispatch(deleteAgentWithUndoRequested(CHIEF_WORKSPACE_ID, agentId, threadTitle));
  }

  function createNewThread() {
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

    const chiefSpecialist = selectSpecialists
      .select(reduxState)
      .find((s) => s.id === CHIEF_SPECIALIST_ID);
    const chiefBehaviorPrompt = buildChiefBehaviorPrompt(
      selectEffectiveBehaviorPrompt.select(reduxState, CHIEF_SPECIALIST_ID),
    );
    appStore.dispatch(
      createAgentFromConfigRequested(
        CHIEF_WORKSPACE_ID,
        {
          workspaceId: CHIEF_WORKSPACE_ID,
          name: formatChiefThreadName(new Date()),
          // Generated timestamp name — keep the session self-renameable.
          nameExplicitlySet: false,
          model: selectContextSelectedModel.select(reduxState, CHIEF_WORKSPACE_ID),
          provider: selectEffectiveDefaultProviderId.select(reduxState, CHIEF_WORKSPACE_ID),
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
        { openAgent: false, consumer: creationConsumer },
      ),
    );
  }
</script>

<div
  class="flex h-full min-h-0 flex-col"
  style:--chief-aurora-left="-1.5rem"
  style:--chief-aurora-right="-1.5rem"
  style:--chief-aurora-bottom="-1.25rem"
  style:--chief-aurora-radius="calc(var(--radius-large) * 1.5)"
>
  <div
    class="home-assistant-header flex shrink-0 items-center justify-between gap-1 border-b border-border px-6"
    data-chief-header-row
  >
    <div class="flex min-w-0 flex-1 items-center gap-1.5">
      {#if threadPicker}
        <Select.Root value={selectedAgentId ?? ''} onchange={handleThreadChange}>
          <Select.Trigger
            variant="ghost"
            aria-label={m.layout_chiefCard_threadPicker_ariaLabel()}
            class="h-7! max-w-full min-w-0 justify-start gap-1.5 px-1.5! text-foreground hover:bg-muted/50"
          >
            <span class="type-body min-w-0 flex-1 truncate text-left font-medium">
              {activeThread?.title ?? m.layout_chiefCard_startThread_label()}
            </span>
            <Fa icon={faChevronDown} class="shrink-0 text-muted-foreground" />
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
      {:else}
        <h2 class="min-w-0 truncate type-body font-medium" title={activeThread?.title}>
          {activeThread?.title ?? m.layout_chiefCard_startThread_label()}
        </h2>
      {/if}
    </div>
    {#if activeThread && !$hidesAgentLifecycleActions$}
      <Button
        variant="ghost"
        size="icon-compact"
        aria-label={m.layout_chiefCard_renameThread_ariaLabel({ title: activeThread.title })}
        title={m.layout_chiefCard_renameThread_title()}
        onclick={(event) => {
          if (activeThread && event.currentTarget instanceof HTMLButtonElement)
            renaming = { thread: activeThread, returnFocus: event.currentTarget };
        }}
      >
        <Fa icon={faPen} size="xs" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={m.layout_chiefCard_deleteThread_ariaLabel({ title: activeThread.title })}
        title={m.layout_chiefCard_deleteThread_tooltip()}
        onclick={(event) => {
          if (activeThread) handleDeleteThread(event, activeThread.agentId, activeThread.title);
        }}
      >
        <Fa icon={faTrash} size="xs" />
      </Button>
    {/if}
    {#if !$hidesAgentLifecycleActions$}
      <div class="flex w-6 shrink-0 items-center">
        <Button
          variant="ghost"
          size="icon-compact"
          class="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          onclick={handleNewThreadClick}
          disabled={isCreatingThread}
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
  </div>

  <div class="min-h-0 flex-1 overflow-clip px-6 pt-4 pb-5 [overflow-clip-margin:0.5rem]">
    <section class="flex h-full min-h-0 flex-col">
      {#if hasActivatedChat && activeAgentId}
        {#key activeAgentId}
          <div class="min-h-0 flex-1">
            <ChatPanel
              workspace={chiefWorkspace}
              agentId={activeAgentId}
              agentName={m.layout_chiefCard_title()}
              {isActive}
              autoFocus={false}
            />
          </div>
        {/key}
      {/if}
    </section>
  </div>
</div>

{#if renaming}
  <AssistantThreadRenameDialog {...renaming} onClose={() => (renaming = null)} />
{/if}
