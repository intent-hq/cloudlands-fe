<script lang="ts">
  /**
   * AgentCard Component
   *
   * A compact card that shows an agent's avatar, name, status, and message preview.
   * Uses subscription for real-time updates and displays line changes stats.
   * Reads Redux-owned streaming state for real-time response updates.
   */
  import { tick, type Snippet } from 'svelte';
  import { writable } from 'svelte/store';
  import { toast } from 'svelte-sonner';
  import { createLogger } from '$lib/utils/client-logger';
  import LineChangeStats from '$lib/components/shared/LineChangeStats.svelte';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import {
    selectAgentSession,
    selectAgentIsResponding,
    selectAgentSessionHasStreamOwnedMessage,
    selectAgentSessionStreamingContent,
    selectAgentIsBlockedWaiting,
  } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { selectChatReceivedFirstChunk } from '$store/renderer/slices/chat-state/chat-state-selectors';
  import {
    deleteAgentWithUndoRequested,
    ensureAgentSessionLoaded,
    renameAgentSessionRequested,
    stopAgentSessionRequested,
  } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';

  import { getAgentPeekData } from '$lib/utils/agent-peek-utils';
  import { getAgentAttentionRequest } from '$shared/utils/agent-attention';
  import { getLastMeaningfulLine, stripUserMessagePrefixes } from '$lib/utils/text-utils';
  import { classifyTool } from './tool-classifier';
  import { deriveAgentCardPreview } from './agent-card-preview';
  import AgentPreviewToolLabel from './AgentPreviewToolLabel.svelte';
  import { renderInlineMarkdownPlainText } from './inline-markdown-snippet';
  import { selectAgentLineStats } from '$store/renderer/slices/changes/changes-selectors';
  import AgentAvatarWithState from '$features/agent/components/agent-avatar/AgentAvatarWithState.svelte';
  import { getAvatarStateForSession } from '$features/agent/components/agent-avatar/avatar-state';
  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { selectPendingCount } from '$store/renderer/slices/permission/permission-selectors';
  import { safeSlide } from '$lib/utils/animations';
  import { findSourcePanelId } from '$lib/utils/workspace-navigation';
  import { updateSession as updateAgentSessionFields } from '$store/renderer/slices/agent-session/agent-session-slice';
  import {
    getPanelLayoutManager,
    hasPanelLayoutManager,
  } from '$features/layout/panel-layout-adapter';
  import type { AgentSession, Workspace } from '$shared/types';
  import SidebarContextMenu from '$lib/components/ui/sidebar-context-menu/SidebarContextMenu.svelte';
  import HarnessFeaturesModal from './HarnessFeaturesModal.svelte';

  import type { SidebarMenuEntry } from '$lib/components/ui/sidebar-context-menu/types';
  import {
    faArrowUpRightFromSquare,
    faCircleInfo,
    faFolderOpen,
    faPen,
    faStop,
    faTrash,
  } from '@fortawesome/free-solid-svg-icons';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';
  import { invoke } from '$lib/electron-bridge';
  import { selectIsWorkspaceHostLocal } from '$store/renderer/slices/workspace/workspace-selectors';
  import OpenPanelIndicator from '$lib/components/workspace/sidebar/OpenPanelIndicator.svelte';

  interface Props {
    agentId: string;
    /** Optional static agent name (used when agent data not yet loaded) */
    agentName?: string;
    /** Whether to show background agent indicator */
    isBackground?: boolean;
    /** Optional activation handler override */
    onclick?: (event: MouseEvent | KeyboardEvent) => void;
    /** Completion report from the agent (passed from event data) */
    completionReport?: string;
    /** Last response summary from the agent (passed from event data, used as fallback) */
    lastResponseSummary?: string;
    /** Whether this card is selected/active */
    selected?: boolean;
    /** Hierarchy depth for indentation (0 = root) */
    depth?: number;
    /** Always show border (useful for overview/standalone cards) */
    showBorder?: boolean;
    /** Show colored border based on agent state (green for running, red for failed, etc.) */
    showStateBorder?: boolean;
    /** Hide the message preview / second line */
    hidePreview?: boolean;
    /** Render as a compact single row (used by event wake-up banners). */
    inline?: boolean;
    /** Use the stable single-line row grammar for the workspace Agents panel. */
    panelRow?: boolean;
    /** Optional row typography override supplied by compact parent disclosures. */
    typographyClass?: string;
    /** Optional inline-row geometry supplied by compact parent disclosures. */
    inlineRowClass?: string;
    /** Compact status text shown after the agent name. */
    statusLabel?: string;
    /** Optional workspace to load agent session from (for home page usage) */
    workspace?: Workspace | null;
    /** Whether the agent has finished its delegated work (forces completed avatar state) */
    isCompleted?: boolean;
    /**
     * Optional ACP provider id (auggie, claude-code, codex, ...). Takes
     * precedence over the agent-session store lookup — used to render the
     * provider icon before the session loads (e.g. delegate-task results).
     */
    provider?: string;
    /** Optional actions rendered beside, never inside, the row activation button. */
    headerActions?: Snippet;
    openPanelCount?: number;
    activeInPanel?: boolean;
    /** Optional timestamp supplied by list data before the session selector is hydrated. */
    updatedAt?: AgentSession['updatedAt'];
    /** Disable navigation, mutation, editing, and file operations in isolated previews. */
    readOnly?: boolean;
  }

  let {
    agentId,
    agentName,
    isBackground = false,
    onclick,
    completionReport,
    lastResponseSummary,
    selected = false,
    depth = 0,
    showBorder = false,
    showStateBorder = false,
    hidePreview = false,
    inline = false,
    panelRow = false,
    typographyClass = '',
    inlineRowClass = 'px-1.5 py-1',
    statusLabel,
    workspace = null,
    isCompleted = false,
    provider = undefined,
    headerActions,
    openPanelCount = 0,
    activeInPanel = false,
    updatedAt: updatedAtProp = undefined,
    readOnly = false,
  }: Props = $props();

  const logger = createLogger('AgentCard');
  const INLINE_PEEK_TYPOGRAPHY_CLASS = 'font-normal! text-muted-foreground';

  // svelte-ignore state_referenced_locally -- selectors are initialized with the current agent; the effect below mirrors prop changes.
  const agentIdStore = writable(agentId);
  $effect(() => {
    agentIdStore.set(agentId);
  });

  const agentPermCount = selectPendingCount(agentIdStore);

  $effect(() => {
    const wsId = workspace?.id;
    if (wsId && !readOnly) {
      appStore.dispatch(ensureAgentSessionLoaded(String(wsId), agentId));
    }
  });

  // Inline editing state
  let isEditing = $state(false);
  let editingValue = $state('');
  let editInputRef: HTMLInputElement | null = $state(null);

  // Context menu state
  let contextMenu: { x: number; y: number } | null = $state(null);

  // Read-only harness-features modal (opened from the context menu).
  let harnessModalOpen = $state(false);

  // Platform file-manager label (locality-gated reveal ⇒ daemon host is this
  // machine, so the client platform matches; PanelTabBar idiom).
  const isWindows = typeof navigator !== 'undefined' && navigator.platform?.startsWith('Win');
  const isMac =
    typeof navigator !== 'undefined' &&
    // @ts-expect-error - userAgentData is not in all browsers
    (navigator.userAgentData?.platform === 'macOS' ||
      /Mac|iPhone|iPad|iPod/.test(navigator.userAgent));
  // i18n-ignore (Explorer/Finder are OS brand names)
  const fileManagerName = isWindows
    ? 'Explorer'
    : isMac
      ? 'Finder'
      : m.chat_agentCard_fileManager_label();

  // Start editing the agent name
  async function startEditing() {
    if (readOnly) return;
    editingValue = displayName;
    isEditing = true;
    await tick();
    editInputRef?.focus();
    editInputRef?.select();
  }

  // Save the edited name
  function saveEdit() {
    if (editingValue.trim() && editingValue.trim() !== displayName) {
      const wsId = $agent$?.workspaceId
        ? String($agent$.workspaceId)
        : workspace?.id
          ? String(workspace.id)
          : undefined;
      if (wsId) {
        const trimmed = editingValue.trim();
        // Capture previous values before the optimistic dispatch so a failed
        // rename can revert back to exactly what the user saw.
        const previousName = displayName;
        const previousNameExplicitlySet = $agent$?.nameExplicitlySet ?? false;
        appStore.dispatch(
          updateAgentSessionFields(agentId, {
            name: trimmed,
            nameExplicitlySet: true,
          } as any),
        );
        const action = renameAgentSessionRequested(wsId, agentId, trimmed);
        appStore.dispatch(action);
        action.promise.catch(() => {
          // Revert the optimistic dispatch so Redux matches disk, then notify.
          appStore.dispatch(
            updateAgentSessionFields(agentId, {
              name: previousName,
              nameExplicitlySet: previousNameExplicitlySet,
            } as any),
          );
          toast.error(m.chat_agentCard_renameFailed_error());
        });
      }
    }
    cancelEdit();
  }

  // Cancel editing
  function cancelEdit() {
    isEditing = false;
    editingValue = '';
  }

  // Handle keyboard events during editing
  function handleEditKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation(); // Prevent bubbling to parent button which would trigger startEditing again
      saveEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelEdit();
    }
  }

  // Handle double-click on name
  function handleNameDoubleClick(e: MouseEvent) {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    startEditing();
  }

  // Handle keyboard events on the card button
  function handleCardKeydown(e: KeyboardEvent) {
    if (readOnly) return;
    if (onclick && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      e.stopPropagation();
      handleClick(e);
    } else if (e.key === 'Enter') {
      // Enter starts editing when the card owns its default interaction.
      e.preventDefault();
      e.stopPropagation();
      startEditing();
    }
  }

  // Context menu handlers
  function handleContextMenu(e: MouseEvent) {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    contextMenu = { x: e.clientX, y: e.clientY };
  }

  function closeContextMenu() {
    contextMenu = null;
  }

  function getContextMenuItems(): SidebarMenuEntry[] {
    const items: SidebarMenuEntry[] = [
      {
        id: 'open',
        label: m.chat_agentCard_menu_open_label(),
        icon: faArrowUpRightFromSquare,
        onClick: () => {
          {
            const wsId = $agent$?.workspaceId
              ? String($agent$.workspaceId)
              : workspace?.id
                ? String(workspace.id)
                : undefined;
            if (wsId) {
              appStore.dispatch(openAgentTabRequested(wsId, { agentId }));
            }
          }
          closeContextMenu();
        },
      },
      {
        id: 'rename',
        label: m.chat_agentCard_menu_rename_label(),
        icon: faPen,
        onClick: () => {
          startEditing();
          closeContextMenu();
        },
      },
    ];

    // Reveal the agent's CoW sandbox directory. Sandboxes are cloned from the
    // workspace checkout, so they live on the workspace's host — only offered
    // when the agent has a sandbox, the daemon runs on this machine (PROTOCOL
    // §5.14 locality) AND the workspace checkout lives on the daemon host,
    // i.e. not a remote (SSH) workspace (monorepo#2171).
    const sandboxPath = agentSandboxPath;
    const sandboxWsId = $agent$?.workspaceId
      ? String($agent$.workspaceId)
      : workspace?.id
        ? String(workspace.id)
        : '';
    if (sandboxPath && selectIsWorkspaceHostLocal.select(appStore.state, sandboxWsId)) {
      items.push({
        id: 'reveal-sandbox',
        label: m.chat_agentCard_menu_revealIn_label({ fileManager: fileManagerName }),
        icon: faFolderOpen,
        onClick: async () => {
          closeContextMenu();
          try {
            await invoke('shell:showItemInFolder', { path: sandboxPath });
          } catch (error) {
            toast.error(
              error instanceof Error
                ? error.message
                : m.chat_agentCard_revealFailed_error({ fileManager: fileManagerName }),
            );
          }
        },
      });
    }

    // Add stop option if agent is running
    if (avatarState === 'running' || avatarState === 'responding') {
      items.push({
        id: 'stop',
        label: m.chat_agentCard_menu_stop_label(),
        icon: faStop,
        onClick: async () => {
          const wsId = $agent$?.workspaceId
            ? String($agent$.workspaceId)
            : workspace?.id
              ? String(workspace.id)
              : undefined;
          // The stop trigger settles for real now (agent-mutation-service
          // forwards agent.stop) — guard so a daemon-side failure cannot
          // become an unhandled rejection that skips closing the menu.
          try {
            if (wsId) {
              const action = stopAgentSessionRequested(wsId, agentId);
              appStore.dispatch(action);
              await action.promise;
            }
          } catch (error) {
            logger.error('Failed to stop agent', { agentId, error });
          } finally {
            closeContextMenu();
          }
        },
      });
    }

    items.push({ type: 'separator' });
    items.push({
      id: 'delete',
      label: m.chat_agentCard_menu_delete_label(),
      icon: faTrash,
      destructive: true,
      onClick: async () => {
        // Close related panel tabs before deleting
        const sessionWorkspaceId = $agent$?.workspaceId
          ? String($agent$.workspaceId)
          : workspace?.id
            ? String(workspace.id)
            : undefined;
        if (sessionWorkspaceId && hasPanelLayoutManager(sessionWorkspaceId)) {
          const layoutManager = getPanelLayoutManager(sessionWorkspaceId);
          layoutManager.closeTabsByType('agent', 'agentId', agentId);
        }
        closeContextMenu();

        if (sessionWorkspaceId) {
          const action = deleteAgentWithUndoRequested(
            sessionWorkspaceId,
            agentId,
            agentName || undefined,
          );
          appStore.dispatch(action);
          await action.promise;
        }
      },
    });

    // Read-only harness version stamp (PROTOCOL §5.5). Selecting the item
    // opens the harness-features modal (monorepo#2459) — legacy sessions
    // without a harnessFeatures snapshot open it too (every catalog feature
    // renders OFF); sessions from daemons that predate the field omit the
    // item entirely.
    const harnessVersion = $agent$?.harnessVersion;
    if (harnessVersion) {
      items.push({ type: 'separator' });
      items.push({
        id: 'harness-version',
        label: m.chat_agentCard_menu_harnessVersion_label({ version: harnessVersion }),
        icon: faCircleInfo,
        onClick: () => {
          harnessModalOpen = true;
          closeContextMenu();
        },
      });
    }

    return items;
  }

  // Reactive agent session from Redux; ensureAgentSessionLoaded dispatch
  // above handles the disk restore.
  const agent$ = selectAgentSession(agentIdStore);
  const agentIsResponding$ = selectAgentIsResponding(agentIdStore);
  const agentIsBlockedWaiting$ = selectAgentIsBlockedWaiting(agentIdStore);
  const agentData = $derived(getAgentPeekData($agent$));

  // Get parent agent ID from metadata (for delegation info)
  const parentAgentId = $derived(agentData?.parentAgentId);

  // Mirror the parent agent ID into a writable so the Redux selector
  // re-evaluates reactively: the "Delegated by" label appears as soon as
  // the parent session lands in state (e.g. on workspace restore) without
  // requiring a re-render of this component.
  const parentAgentIdStore = writable<string>('');
  $effect(() => {
    parentAgentIdStore.set(parentAgentId ?? '');
  });
  const parentAgent$ = selectAgentSession(parentAgentIdStore);
  const delegatedByName = $derived(parentAgentId ? $parentAgent$?.name : undefined);

  // Get line changes for this agent
  const lineChanges$ = selectAgentLineStats(agentIdStore);

  // Streaming state is derived from Redux-owned stream lifecycle/message state.
  const streamingContent$ = selectAgentSessionStreamingContent(agentIdStore);
  const hasStreamOwnedMessage$ = selectAgentSessionHasStreamOwnedMessage(agentIdStore);
  // Per-turn "response text landed this turn" flag (chat-state): reset by
  // `agent:stream:end`, flipped by the first text-bearing activity ping.
  const receivedFirstChunk$ = selectChatReceivedFirstChunk(agentIdStore);
  const streamingBuffer = $derived($streamingContent$);
  const isStreamActive = $derived($agentIsResponding$ && !$agentIsBlockedWaiting$);

  // Extract display data
  const displayName = $derived(agentData?.name || agentName || m.chat_shared_agentName_fallback());
  // filter out [Currently viewing: ...] prefixes and @context[...] mentions
  // (raw base64/pipe format) — shared with the HUD card line derivation.
  const lastUserMsg = $derived(stripUserMessagePrefixes(agentData?.lastUserMessage ?? ''));
  // Pending attention request (discussion/blocker) from the daemon session
  // fields; null when none is pending (retired on agent:updated clear).
  const attentionRequest = $derived(getAgentAttentionRequest($agent$));

  // Use the canonical session state derivation for every agent surface.
  const avatarState = $derived(
    getAvatarStateForSession($agent$, {
      hasPermissionRequest: $agentPermCount > 0,
      isActive: selected,
      isCompleted,
      attentionKind: attentionRequest?.kind ?? null,
    }),
  );

  // Get specialist ID from agent metadata (for avatar overlay)
  const specialist = $derived.by(() => {
    const specialistId = $agent$?.metadata?.specialist || $agent$?.agentMetadata?.specialist;
    return specialistId || null;
  });

  // Sandbox directory for sandboxed agents (daemon-provided metadata).
  const agentSandboxPath = $derived.by(() => {
    const path = $agent$?.metadata?.sandboxPath || $agent$?.agentMetadata?.sandboxPath;
    return typeof path === 'string' && path.length > 0 ? path : null;
  });

  // Preview precedence while a turn is live:
  //   1. the stream-owned chat.subscribe buffer (viewed agent only —
  //      character-level progress from the standing delta stream);
  //   2. the session's push-applied `lastAgentResponse` (refreshed ~1s by
  //      `agent:stream:activity`, intentd#792) so a non-viewed watched
  //      agent's preview advances mid-turn instead of freezing on stale
  //      transcript-derived peek text — gated on the per-turn
  //      `receivedFirstChunk` flag (reset by `agent:stream:end`, flipped by
  //      a text-bearing `agent:stream:activity`) so a leftover previous-turn
  //      `lastAgentResponse` doesn't masquerade as this turn's text in the
  //      pre-first-token window;
  //   3. the persisted transcript peek text (idle agents) — agent-peek-utils
  //      falls back to the wire `lastAgentResponse` when the loaded
  //      transcript has no assistant message.
  // Tool previews (lastToolUse) only kick in when there's no text to show.
  const liveResponseLine = $derived.by(() => {
    if (isStreamActive && $hasStreamOwnedMessage$ && streamingBuffer) {
      const line = getLastMeaningfulLine(streamingBuffer);
      if (line) return line;
    }
    if ($agentIsResponding$ && $receivedFirstChunk$ && $agent$?.lastAgentResponse) {
      const line = getLastMeaningfulLine($agent$.lastAgentResponse);
      if (line) return line;
    }
    return '';
  });
  const lastResponse = $derived(
    liveResponseLine ||
      (agentData?.lastResponse ? getLastMeaningfulLine(agentData.lastResponse) : ''),
  );

  // Freshness-wins preview: when the newest transcript message is the user's
  // (wire `lastMessageRole`, transcript-derived fallback in agent-peek-utils)
  // and no streamed text exists yet for an in-flight turn, the user's first
  // line outranks digest/completionReport/lastResponse/lastToolUse (attention
  // requests still take top precedence). Absent role (older daemon) keeps the
  // existing precedence. Once streamed text lands (or the daemon overlay flips
  // the role to "assistant"), the live-preview precedence above resumes.
  // Text source: transcript-derived first, then the wire `lastUserMessage`
  // (AgentLite list/get projection) — agent-peek-utils applies this fallback
  // itself; the direct session read remains as a belt-and-braces fallback.
  const userFirstLine = $derived(
    stripUserMessagePrefixes(agentData?.lastUserMessage || $agent$?.lastUserMessage || '')
      .split('\n')[0]
      ?.trim() ?? '',
  );

  // Tool-use block to preview when the latest thing the agent did was a tool
  // call (see agent-peek-utils). Only used when there's no text to display.
  const lastToolUse = $derived(agentData?.lastToolUse);
  const liveToolUse = $derived(
    $agent$?.isStreaming && $agent$?.lastToolUse ? lastToolUse : undefined,
  );
  const liveToolDisplay = $derived(
    liveToolUse
      ? classifyTool(liveToolUse.name, (liveToolUse.input as Record<string, any>) || {})
      : null,
  );
  const hasRenderableLiveTool = $derived(!!liveToolUse && !liveToolDisplay?.hidden);
  const showUserMessagePreview = $derived(
    agentData?.lastMessageRole === 'user' &&
      !!userFirstLine &&
      !liveResponseLine &&
      !hasRenderableLiveTool,
  );

  const updatedAt = $derived(updatedAtProp ?? $agent$?.updatedAt);

  // Border color based on state - only show colored border if showStateBorder is true
  const isRunning = $derived(avatarState === 'running' || avatarState === 'responding');
  const glowClass = $derived.by(() => {
    if (!showStateBorder) return '';
    if (isRunning) return 'agent-glow-active';
    if (avatarState === 'failed') return 'shadow shadow-red-500 shadow-sm';
    if (avatarState === 'needs-permission') return 'shadow shadow-amber-500 shadow-sm';
    if (avatarState === 'attention-discussion') return 'shadow shadow-amber-500 shadow-sm';
    if (avatarState === 'attention-blocker') return 'shadow shadow-red-500 shadow-sm';
    if (avatarState === 'waiting') return 'shadow shadow-amber-500 shadow-sm';
    return 'glow-transparent';
  });

  // Show completion report if available - priority order:
  // 0. Live session digest while responding (push-applied from
  //    `agent:stream:activity` and cleared at each turn's first ping by the
  //    events bridge, monorepo#1327 — so mid-turn it is this turn's digest,
  //    modulo the sub-second window before that first ping lands, during
  //    which the previous turn's digest may briefly linger)
  // 1. Digest from <agent_digest> tag (most concise, agent-provided summary)
  // 2. Completion report from report_to_parent tool (prop from event data)
  // 3. Completion report from agent metadata
  // 4. lastResponseSummary (fallback from event data)
  // Sources 1-4 are previous-turn summaries: while the agent is responding
  // they must never be the preview (monorepo#1327) — including the tool-only
  // no-text window where no `receivedFirstChunk` flip has happened yet — so
  // the derivation yields undefined and the render chain falls through to
  // live text / newest user message / tool preview. They remain the fallback
  // for idle agents between turns.
  const effectiveCompletionReport = $derived.by(() => {
    if ($agentIsResponding$) {
      return $agent$?.digest || undefined;
    }
    return (
      agentData?.digest || completionReport || agentData?.completionReport || lastResponseSummary
    );
  });

  // Single preview value for the persistent container below: the precedence
  // chain (attention → live text → live tool → user line → digest/report →
  // persisted fallbacks) collapses into one { kind, text/toolUse } value so
  // preview-source flips swap content in place instead of unmount/mounting
  // sibling blocks with height animation.
  const preview = $derived(
    deriveAgentCardPreview({
      attentionRequest,
      liveResponseLine,
      liveToolUse,
      hasRenderableLiveTool,
      showUserMessagePreview,
      userFirstLine,
      effectiveCompletionReport,
      lastResponse,
      lastToolUse,
      lastUserMsg,
    }),
  );
  const inlinePreviewSource = $derived.by(() => {
    if (!preview || preview.kind === 'live-tool' || preview.kind === 'last-tool') return '';
    if (preview.kind !== 'attention') return preview.text;
    const label =
      preview.attention.kind === 'blocker'
        ? m.chat_agentCard_attentionBlocker_label()
        : m.chat_agentCard_attentionDiscussion_label();
    return preview.attention.reason ? `${label} · ${preview.attention.reason}` : label;
  });
  let inlinePreviewText = $state('');

  $effect(() => {
    const value = inlinePreviewSource;
    let cancelled = false;
    if (!value) {
      inlinePreviewText = '';
      return;
    }
    void renderInlineMarkdownPlainText(value).then((cleaned) => {
      if (!cancelled) inlinePreviewText = cleaned;
    });
    return () => {
      cancelled = true;
    };
  });

  // Handle click - navigate to agent
  function handleClick(event: MouseEvent | KeyboardEvent) {
    if (readOnly) return;
    if (onclick) {
      onclick(event);
    } else {
      const sourcePanelId = findSourcePanelId(event.target);
      const openInAdjacentPanel = event.metaKey || event.ctrlKey;
      const wsId = $agent$?.workspaceId
        ? String($agent$.workspaceId)
        : workspace?.id
          ? String(workspace.id)
          : undefined;
      if (!wsId) return;
      appStore.dispatch(
        openAgentTabRequested(wsId, {
          agentId,
          sourcePanelId,
          openInAdjacentPanel,
        }),
      );
    }
  }
</script>

{#snippet agentCardContent()}
  <div
    style="padding-left: {depth * 10}px; container-type: inline-size;"
    class="relative w-full min-w-0 max-w-full overflow-hidden agent-card-container"
    data-agent-id={agentId}
    data-testid="agent-list-item"
  >
    <button
      type="button"
      class="flex w-full min-w-0 max-w-full overflow-hidden text-left gap-2 transition-colors duration-150 cursor-pointer group border {panelRow
        ? 'h-10 items-center rounded-md border-transparent px-2 py-2 type-body font-normal hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
        : inline
          ? `type-body items-center rounded-md ${inlineRowClass}`
          : 'px-1.75 pt-1.25 pb-1.5'} {panelRow
        ? selected
          ? 'bg-muted/70 text-foreground'
          : 'bg-transparent'
        : selected || showBorder
          ? `bg-background border-border ${glowClass} shadow-xs`
          : 'border-transparent'} {typographyClass}"
      onclick={handleClick}
      onkeydown={handleCardKeydown}
      oncontextmenu={handleContextMenu}
      aria-disabled={readOnly}
      tabindex={readOnly ? -1 : undefined}
      data-agent-panel-row={panelRow ? agentId : undefined}
    >
      <div
        class="agent-card-avatar-wrapper relative shrink-0 {panelRow
          ? 'agent-card-avatar-wrapper--panel'
          : inline
            ? ''
            : 'mt-[-0.8px] -mb-1'}"
        data-testid="agent-card-avatar-wrapper"
      >
        <AgentAvatarWithState
          {agentId}
          variant={panelRow ? 'emphasized' : 'standard'}
          state={avatarState}
          specialist={specialist as import('$lib/constants/specialists').BuiltinSpecialistId | null}
          {provider}
        />
      </div>

      <div
        class="agent-card-content flex min-w-0 max-w-full flex-1 overflow-hidden {headerActions
          ? 'mr-14'
          : ''} {inline || panelRow ? 'flex-row items-center gap-2' : 'flex-col'}"
      >
        <!-- Header row -->
        <div
          class="agent-card-header flex w-full min-w-0 max-w-full items-center gap-1.5 overflow-hidden {inline
            ? 'inline-agent-card-header'
            : panelRow
              ? 'agent-panel-row-header'
              : 'pr-1.5'}"
        >
          <!-- Avatar with streaming indicator -->

          <div
            class="flex-1 min-w-0 flex items-center {panelRow
              ? 'gap-1.5 overflow-hidden'
              : inline
                ? 'gap-0'
                : 'gap-1.5'} {typographyClass
              ? 'font-normal'
              : panelRow
                ? 'font-normal'
                : 'font-medium'} {inline ? 'overflow-hidden' : ''}"
          >
            {#if isEditing}
              <!-- svelte-ignore a11y_autofocus -->
              <input
                bind:this={editInputRef}
                type="text"
                bind:value={editingValue}
                onblur={saveEdit}
                onkeydown={handleEditKeydown}
                class="text-sm truncate bg-transparent border-none outline-none! ring-0! focus:ring-0! focus:outline-none! focus-visible:ring-0! focus-visible:outline-none! min-w-0 flex-1 text-foreground"
                onclick={(e) => e.stopPropagation()}
              />
            {:else}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <h3
                class="whitespace-nowrap {panelRow
                  ? 'min-w-0 flex-1 truncate type-body font-normal text-foreground'
                  : inline
                    ? typographyClass
                      ? 'shrink-0 type-body font-normal text-foreground!'
                      : 'shrink-0 type-body font-normal text-foreground'
                    : 'shrink-0 text-sm font-normal text-foreground'}"
                data-testid="agent-card-name"
                data-agent-row-name={panelRow ? '' : undefined}
                ondblclick={handleNameDoubleClick}
              >
                {displayName}
              </h3>
            {/if}
            {#if statusLabel}
              <span
                class="type-body shrink-0 truncate whitespace-nowrap font-normal text-muted-foreground"
                data-testid="agent-card-status"
              >
                {statusLabel}
              </span>
            {/if}
            <!-- {#if specialist}
            <span
              class="specialist-icon shrink-0 text-subtle dark:text-background ml-1.5 mr-0.5"
            >
              <SpecialistToolIcon {specialist} size={12} muted />
            </span>
            <span class="specialist-text text-ui text-subtle shrink-0">
              {specialistDisplayName}
            </span>
          {/if} -->
            {#if delegatedByName && (!inline || panelRow)}
              <span
                class="delegated-by-text min-w-0 shrink truncate whitespace-nowrap text-ui text-subtle {panelRow
                  ? 'max-w-[40%]'
                  : 'ml-1'}"
              >
                {m.chat_agentCard_delegatedBy_label({ name: delegatedByName })}
              </span>
            {/if}
            {#if isBackground && !panelRow}
              <div class="ml-auto px-1 py-0.5 text-ui font-bold bg-muted text-subtle rounded mr-1">
                {m.chat_agentCard_background_badge()}
              </div>
            {/if}

            <!-- Inline mode: preview inline after name -->
            {#if inline && !hidePreview && preview}
              {#if preview.kind === 'live-tool' || preview.kind === 'last-tool'}
                <div
                  class="ml-2.5 min-w-0 flex-1 overflow-hidden whitespace-nowrap text-sm {INLINE_PEEK_TYPOGRAPHY_CLASS}"
                  data-testid="agent-card-preview"
                >
                  <AgentPreviewToolLabel
                    toolUse={preview.toolUse}
                    showIcon={false}
                    class={INLINE_PEEK_TYPOGRAPHY_CLASS}
                  />
                </div>
              {:else}
                <p
                  class="ml-2.5 min-w-0 flex-1 truncate whitespace-nowrap text-sm {INLINE_PEEK_TYPOGRAPHY_CLASS}"
                  data-testid="agent-card-preview"
                  title={inlinePreviewText}
                  aria-label={inlinePreviewText}
                >
                  {inlinePreviewText}
                </p>
              {/if}
            {/if}
          </div>

          {#if !inline || panelRow}
            <div
              class="flex shrink-0 items-center gap-1.5"
              data-agent-row-trailing={panelRow ? '' : undefined}
            >
              <OpenPanelIndicator count={openPanelCount} active={activeInPanel} />
              {#if panelRow && isBackground}
                <span
                  class="shrink-0 rounded bg-muted px-1 py-0.5 text-ui font-bold text-subtle"
                  data-agent-background-badge
                >
                  {m.chat_agentCard_background_badge()}
                </span>
              {/if}
              {#if !panelRow && $lineChanges$ && ($lineChanges$.additions > 0 || $lineChanges$.deletions > 0)}
                <LineChangeStats
                  additions={$lineChanges$.additions}
                  deletions={$lineChanges$.deletions}
                  size="xs"
                />
              {/if}
              {#if updatedAt && !headerActions}
                <span class="shrink-0" data-agent-row-time={panelRow ? '' : undefined}>
                  <RelativeTime
                    date={updatedAt}
                    compact
                    class="text-ui text-subtle {panelRow ? 'tabular-nums' : ''}"
                  />
                </span>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Non-inline mode: preview below header as before -->
        {#if !inline && !hidePreview && preview}
          <div
            class="mt-0.5 w-full min-w-0 max-w-full overflow-hidden"
            data-testid="agent-card-preview-row"
            transition:safeSlide={{ axis: 'y', duration: 150 }}
          >
            {#if preview.kind === 'attention'}
              <p
                class="block w-full min-w-0 max-w-full truncate whitespace-nowrap text-sm {preview
                  .attention.kind === 'blocker'
                  ? 'text-red-500'
                  : 'text-amber-500'}"
                data-testid="agent-card-attention"
              >
                {preview.attention.kind === 'blocker'
                  ? m.chat_agentCard_attentionBlocker_label()
                  : m.chat_agentCard_attentionDiscussion_label()}{#if preview.attention.reason}<span
                    class="text-subtle"
                  >
                    · {preview.attention.reason}</span
                  >{/if}
              </p>
            {:else if preview.kind === 'live-tool' || preview.kind === 'last-tool'}
              <div
                class="block w-full min-w-0 max-w-full truncate whitespace-nowrap text-sm text-subtle"
                data-testid="agent-card-preview"
              >
                <AgentPreviewToolLabel toolUse={preview.toolUse} animate={isRunning} />
              </div>
            {:else if preview.kind === 'report'}
              <p
                class="block w-full min-w-0 max-w-full truncate whitespace-nowrap text-sm text-subtle"
                title={preview.text}
              >
                {preview.text}
              </p>
            {:else}
              <p
                class="block w-full min-w-0 max-w-full truncate whitespace-nowrap text-sm text-subtle"
                data-testid="agent-card-preview"
                title={preview.text}
              >
                {preview.text}
              </p>
            {/if}
          </div>
        {/if}
      </div>
    </button>
    {#if headerActions}
      <div
        class="absolute right-3 top-1/2 z-10 h-6 w-14 shrink-0 -translate-y-1/2"
        data-testid="agent-card-trailing-slot"
      >
        {#if updatedAt}
          <RelativeTime
            date={updatedAt}
            compact
            class="type-caption tabular-nums absolute inset-0 flex items-center justify-end text-right {INLINE_PEEK_TYPOGRAPHY_CLASS} transition-opacity group-hover/watch:opacity-0 group-focus-within/watch:opacity-0"
          />
        {/if}
        <div class="absolute inset-0 flex items-center justify-end gap-1">
          {@render headerActions()}
        </div>
      </div>
    {/if}
  </div>
{/snippet}

{@render agentCardContent()}

{#if contextMenu && !readOnly}
  <SidebarContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    items={getContextMenuItems()}
    onClickOutside={closeContextMenu}
  />
{/if}

{#if $agent$?.harnessVersion}
  <HarnessFeaturesModal
    bind:open={harnessModalOpen}
    version={$agent$.harnessVersion}
    features={$agent$?.harnessFeatures ?? null}
  />
{/if}

<style>
  .agent-card-avatar-wrapper {
    display: inline-flex;
    box-sizing: border-box;
    width: var(--agent-avatar-standard-surface-size);
    height: var(--agent-avatar-standard-surface-size);
    flex: none;
    align-items: center;
    justify-content: center;
    border-radius: var(--agent-avatar-standard-corner-radius);
    line-height: 0;
  }

  .agent-card-avatar-wrapper--panel {
    width: var(--agent-avatar-emphasized-surface-size);
    height: var(--agent-avatar-emphasized-surface-size);
    border-radius: var(--agent-avatar-emphasized-corner-radius);
  }

  /* Hide text content when container is too narrow (< 80px) */
  @container (max-width: 80px) {
    .agent-card-content {
      display: none;
    }
  }

  /* Default: show text, hide icon */
  .specialist-text {
    display: inline;
  }

  /* When narrow (< 300px): show icon, hide text */
  @container (max-width: 300px) {
    .specialist-text {
      display: none;
    }
    .specialist-icon {
      display: inline-flex;
    }
    .delegated-by-text {
      display: none;
    }
  }

  /* Glowing gradient animation for active/running agents */
  :global(.agent-glow-active) {
    position: relative;
    box-shadow: 0 0 12px 2px rgba(16, 185, 129, 0.1);
    animation: agent-glow-pulse 2s ease-in-out infinite;
  }

  :global(.agent-glow-active)::before {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    padding: 1px;
    background: linear-gradient(
      135deg,
      rgba(16, 185, 129, 0.2) 0%,
      rgba(52, 211, 153, 0.1) 25%,
      rgba(16, 185, 129, 0.2) 50%,
      rgba(52, 211, 153, 0.1) 75%,
      rgba(16, 185, 129, 0.2) 100%
    );
    background-size: 200% 200%;
    animation: agent-gradient-shift 2s linear infinite;
    -webkit-mask:
      linear-gradient(#fff 0 0) content-box,
      linear-gradient(#fff 0 0);
    mask:
      linear-gradient(#fff 0 0) content-box,
      linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    pointer-events: none;
    z-index: 1;
  }

  @keyframes agent-glow-pulse {
    0%,
    100% {
      box-shadow: 0 0 9px 2px rgba(16, 185, 129, 0.1);
    }
    50% {
      box-shadow: 0 0 12px 4px rgba(16, 185, 129, 0.13);
    }
  }

  @keyframes agent-gradient-shift {
    0% {
      background-position: 0% 50%;
    }
    100% {
      background-position: 200% 50%;
    }
  }

  /* Reduced motion support */
  @media (prefers-reduced-motion: reduce) {
    :global(.agent-glow-active) {
      animation: none;
      box-shadow: 0 0 10px 3px rgba(16, 185, 129, 0.12);
    }
    :global(.agent-glow-active)::before {
      animation: none;
      background-position: 0% 50%;
    }
  }
</style>
