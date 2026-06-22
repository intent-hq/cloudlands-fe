<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    faClockRotateLeft,
    faPlus,
    faSpinner,
    faThumbtack,
    faTrash,
    faXmark,
    faWandMagicSparkles,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { toast } from 'svelte-sonner';
  import ChatPanel from '$lib/components/chat/ChatPanel.svelte';
  import {
    Dropdown,
    type DropdownItemProps,
    type DropdownOption,
  } from '$lib/components/ui/dropdown';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { store as appStore } from '$store/renderer/store';
  import {
    setChiefActiveAgentId,
    closePanel,
    openPanel,
    toggleCardPinned,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import {
    selectChiefActiveAgentId,
    selectChiefThreadPreview,
    selectChiefThreads,
    selectIsCardPinned,
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
  import { createAgentTypeId } from '$shared/types/agent.types';
  import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
  import { WorkspaceStatus, type Workspace } from '$shared/types';
  import { formatChiefThreadName } from './chief-thread-name';
  import {
    selectEffectiveBehaviorPrompt,
    selectSpecialists,
  } from '$store/renderer/slices/specialists/specialists-selectors';

  const CHIEF_SPECIALIST_ID = 'chief-of-staff';

  const chiefPreview$ = selectChiefThreadPreview();
  const chiefThreads$ = selectChiefThreads();
  const isCardPinned$ = selectIsCardPinned();
  const chiefActiveAgentId$ = selectChiefActiveAgentId();

  interface Props {
    expanded?: boolean;
  }

  let { expanded = false }: Props = $props();

  const CHIEF_WORKSPACE_TIMESTAMP = '2026-01-01T00:00:00.000Z';
  const chiefWorkspace: Workspace = {
    id: CHIEF_WORKSPACE_ID,
    title: 'Chief of Staff',
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
  const threadOptions = $derived<DropdownOption[]>(
    $chiefThreads$.map((thread) => ({
      value: thread.agentId,
      label: thread.title,
      data: { isActive: thread.isActive },
      class: activeThread?.agentId === thread.agentId ? 'bg-muted/70 text-foreground' : '',
    })),
  );
  const currentPreview = $derived(activeThread ?? $chiefPreview$);
  const title = $derived(currentPreview?.title ?? 'Start a Chief thread');
  const preview = $derived(
    currentPreview?.preview ??
      'Ask Chief to help manage workspaces, settings, specialists, and app navigation.',
  );

  function ensureChiefWorkspaceRegistered() {
    if (isWorkspaceRegistered) return;
    appStore.dispatch(setWorkspaceEntity(chiefWorkspace));
    appStore.dispatch(workspaceMounted(CHIEF_WORKSPACE_ID));
    isWorkspaceRegistered = true;
  }

  $effect.pre(() => {
    ensureChiefWorkspaceRegistered();
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
      !isWorkspaceRegistered ||
      $chiefThreads$.length > 0 ||
      isCreatingThread ||
      hasAutoStartedRef
    ) {
      return;
    }
    hasAutoStartedRef = true;
    void createNewThread();
  });

  onDestroy(() => {
    appStore.dispatch(workspaceUnmounted(CHIEF_WORKSPACE_ID));
  });

  function openChiefPanel() {
    appStore.dispatch(openPanel('chief'));
  }

  function handleThreadChange(value: string | string[]) {
    if (typeof value === 'string') {
      selectedAgentId = value;
      appStore.dispatch(setChiefActiveAgentId(value));
      appStore.dispatch(setActiveAgentId(CHIEF_WORKSPACE_ID, value));
    }
  }

  function handleDeleteThread(event: MouseEvent, agentId: string, threadTitle: string) {
    event.preventDefault();
    event.stopPropagation();
    appStore.dispatch(deleteAgentWithUndoRequested(CHIEF_WORKSPACE_ID, agentId, threadTitle));
  }

  async function createNewThread() {
    if (isCreatingThread) return;
    ensureChiefWorkspaceRegistered();

    // Reuse an existing empty thread instead of stacking up blank ones.
    const emptyThread = $chiefThreads$.find((thread) => thread.messageCount === 0);
    if (emptyThread) {
      selectedAgentId = emptyThread.agentId;
      appStore.dispatch(setChiefActiveAgentId(emptyThread.agentId));
      appStore.dispatch(setActiveAgentId(CHIEF_WORKSPACE_ID, emptyThread.agentId));
      return;
    }

    isCreatingThread = true;

    const reduxState = appStore.state;
    const chiefSpecialist = selectSpecialists
      .select(reduxState)
      .find((s) => s.id === CHIEF_SPECIALIST_ID);
    const chiefBehaviorPrompt = chiefSpecialist
      ? selectEffectiveBehaviorPrompt.select(reduxState, CHIEF_SPECIALIST_ID)
      : undefined;

    const action = agentSessionLaunchAgentRequested(
      CHIEF_WORKSPACE_ID,
      {
        name: formatChiefThreadName(new Date()),
        agentType: createAgentTypeId('workspace'),
        source: 'chief-card',
        behaviorPrompt: chiefBehaviorPrompt,
        metadata: {
          source: 'chief-card',
          chiefWorkspace: true,
          specialist: CHIEF_SPECIALIST_ID,
          specialistName: chiefSpecialist?.name ?? 'Chief of Staff',
          behaviorPrompt: chiefBehaviorPrompt,
        },
      },
      { openAgent: false },
    );

    appStore.dispatch(action);
    try {
      const session = await action.promise;
      selectedAgentId = session.id;
      appStore.dispatch(setChiefActiveAgentId(session.id));
      appStore.dispatch(setActiveAgentId(CHIEF_WORKSPACE_ID, session.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Could not start Chief thread: ${message}`);
    } finally {
      isCreatingThread = false;
    }
  }
</script>

{#if !expanded}
  <div class="p-3">
    <button
      type="button"
      class="block w-full cursor-pointer rounded-sm text-left outline-none"
      onclick={openChiefPanel}
      aria-label="Open Chief"
    >
      <p class="truncate text-sm font-semibold text-foreground">{title}</p>
      <p class="mt-1 text-xs leading-snug text-muted-foreground line-clamp-3">{preview}</p>
    </button>
  </div>
{:else}
  <div class="flex h-full min-h-[460px] flex-col">
    <div class="flex shrink-0 items-center justify-between gap-1 px-2 pb-1.5 pt-2">
      <div class="min-w-0 flex-1">
        <h2 class="truncate text-sm font-semibold text-foreground">Chief of Staff</h2>
      </div>
      <div class="flex shrink-0 items-center gap-0.5">
        <Dropdown
          value={selectedAgentId ?? undefined}
          options={threadOptions}
          onchange={handleThreadChange}
          searchable={false}
          portal={true}
          variant="inline"
          size="xs"
          triggerClass="h-6! w-6 justify-center p-0! text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          contentClass="w-64 max-w-[calc(100vw-32px)]"
        >
          {#snippet trigger({
            open: _open,
            value: _value,
          }: {
            open: boolean;
            value: string | string[] | undefined;
          })}
            <Fa icon={faClockRotateLeft} size="xs" />
            <span class="sr-only">Chief thread history</span>
          {/snippet}

          {#snippet item({ option, selected, highlighted }: DropdownItemProps)}
            {@const thread = $chiefThreads$.find((candidate) => candidate.agentId === option.value)}
            <div class="flex min-w-0 flex-1 items-center gap-1.5">
              {#if thread?.isActive}
                <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" aria-label="Active"
                ></span>
              {:else}
                <span class="h-1.5 w-1.5 shrink-0"></span>
              {/if}
              <span class="truncate {selected ? 'font-medium text-foreground' : ''}"
                >{option.label}</span
              >
            </div>
            <span
              role="button"
              tabindex={-1}
              class="ml-1 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-destructive {highlighted
                ? 'opacity-100'
                : 'opacity-0'}"
              onclick={(e) => handleDeleteThread(e, option.value, option.label)}
              aria-label="Delete thread {option.label}"
              title="Delete thread"
            >
              <Fa icon={faTrash} size="xs" />
            </span>
          {/snippet}

          {#snippet empty()}
            <div class="px-3 py-4 text-center text-sm text-subtle">No Chief threads yet.</div>
          {/snippet}
        </Dropdown>
        <button
          class="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          onclick={createNewThread}
          disabled={isCreatingThread}
          aria-label="New Chief thread"
          title="New Chief thread"
        >
          <Fa
            icon={isCreatingThread ? faSpinner : faPlus}
            size="xs"
            class={isCreatingThread ? 'animate-spin' : ''}
          />
        </button>
        <Tooltip
          content={$isCardPinned$ ? 'Unpin panel' : 'Pin panel open'}
          side="bottom"
          sideOffset={4}
        >
          <button
            class="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md transition-colors
              {$isCardPinned$
              ? 'rotate-0 text-foreground'
              : 'rotate-45 text-muted-foreground hover:bg-muted/50 hover:text-foreground'}"
            onclick={() => appStore.dispatch(toggleCardPinned())}
            aria-label={$isCardPinned$ ? 'Unpin panel' : 'Pin panel open'}
          >
            <Fa icon={faThumbtack} size="xs" />
          </button>
        </Tooltip>
        <button
          class="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          onclick={() => appStore.dispatch(closePanel())}
          aria-label="Close panel"
        >
          <Fa icon={faXmark} size="xs" />
        </button>
      </div>
    </div>

    <div class="min-h-0 flex-1 p-2 pb-4 pt-0">
      <section class="flex h-full min-h-0 flex-col overflow-hidden">
        {#if activeThread}
          {#key activeThread.agentId}
            <div class="min-h-0 flex-1">
              <ChatPanel
                workspace={chiefWorkspace}
                agentId={activeThread.agentId}
                agentName="Chief of Staff"
                isActive={true}
                autoFocus={true}
              />
            </div>
          {/key}
        {:else}
          <div class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <div
              class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"
            >
              <Fa icon={faWandMagicSparkles} size="sm" />
            </div>
            <div>
              <p class="text-sm font-semibold text-foreground">Start a Chief thread</p>
              <p class="mt-1 text-xs text-subtle">
                Ask Chief to help with workspaces, settings, specialists, and navigation.
              </p>
            </div>
            <button
              class="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
              onclick={createNewThread}
              disabled={isCreatingThread}
            >
              <Fa
                icon={isCreatingThread ? faSpinner : faPlus}
                size="xs"
                class={isCreatingThread ? 'animate-spin' : ''}
              />
              New thread
            </button>
          </div>
        {/if}
      </section>
    </div>
  </div>
{/if}
