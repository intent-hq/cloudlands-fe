<script lang="ts">
  /* eslint-disable max-lines */
  import {
    faFile,
    faCodeCompare,
    faNoteSticky,
    faClipboard,
    faSquare,
    faCircleExclamation,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { onDestroy } from 'svelte';
  import StreamingMessageContent from './StreamingMessageContent.svelte';
  import MessageActions from './MessageActions.svelte';
  import SimpleRichInput from './input/SimpleRichInput.svelte';
  import type { AgentMessage, Workspace } from '$shared/types';
  import { extractAllContent } from '$shared/types';
  import RulesInspector from './RulesInspector.svelte';
  import InterruptionNotice from './InterruptionNotice.svelte';
  import ModelChangeNotice from './ModelChangeNotice.svelte';
  import DiscussionRequestNotice from './DiscussionRequestNotice.svelte';
  import BlockerReportNotice from './BlockerReportNotice.svelte';
  import TurnFailureNotice from './TurnFailureNotice.svelte';
  import { getModelChangeNotice } from './model-change-notice';
  import { getAttentionNotice } from './attention-notice';
  import { parseStoredMessage } from '$lib/utils/parseStoredMessage';
  import { safeSlide } from '$lib/utils/animations';
  import type { ContextItem } from './input/context-api';
  import type { FileBlock, ImageBlock } from '$lib/client/app-client';
  import { openWorkspaceAttachment } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { formatFileSize } from '$lib/utils/file-utils';
  import ProviderIcon from '$features/context/components/ContextProviderIcon.svelte';
  import type { ContextProvider } from '$features/context/types';
  import { handleLink } from '$features/navigation/link-handler';
  import { selectAllNotes } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
  import { selectAgentMessageById } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { selectHydratedBlocks } from '$store/renderer/slices/chat-state/chat-state-selectors';
  import { messageBlockHydrationRequested } from '$store/renderer/slices/chat-state/chat-state-slice';
  import { isHydrationPending, mergeHydratedContent } from './block-hydration';
  import { createLogger } from '$lib/utils/client-logger';
  import { shouldShowStoppedIndicator as resolveShouldShowStoppedIndicator } from './message-display-utils';
  import { splitTextByUrls } from './message-link-utils';
  import { findInlineMentions } from './mention-match-utils';
  import { USER_MESSAGE_SURFACE_CLASS, USER_MESSAGE_TEXT_CLASS } from './user-message-surface';
  import {
    isQuestionOnlyContent,
    resolveStoppedIndicatorLabel,
    resolveFinishReasonNotice,
  } from './message-display-utils';
  import ImageLightbox from '$lib/components/ui/ImageLightbox.svelte';
  import EditRegenerateConfirmDialog from './EditRegenerateConfirmDialog.svelte';
  import { resolveAttachmentImageUrl } from './attachment-image-url';
  import { isImageBlock } from '$shared/types/content-block.guards';
  import type { ContentBlock } from '$shared/types/content-block';
  import AgentMessageAttributionHeader from './AgentMessageAttributionHeader.svelte';
  import { getAgentMessageAttribution } from '$lib/utils/agent-message-attribution';
  import QueuedMessageNoticeHeader from './QueuedMessageNoticeHeader.svelte';
  import { getQueueInfo } from '$lib/utils/queue-info';
  import { getPresentedUserMessageText } from '$lib/utils/user-message-presentation';
  import AutomatedWakeCardHeader from './AutomatedWakeCardHeader.svelte';
  import { getAutomatedWakePresentation } from './automated-wake-presentation';
  import {
    safeSubscriptionSlide,
    SUBSCRIPTION_CARD_CONTAINMENT_CLASS,
    SUBSCRIPTION_CARD_SURFACE_CLASS,
    SUBSCRIPTION_IN_THREAD_CARD_SPACING_CLASS,
  } from './subscription-disclosure';
  import QuestionsDismissedNotice from './QuestionsDismissedNotice.svelte';
  import { getQuestionsDismissedNotice } from './questions-dismissed-notice';
  import AutoUnarchivedNotice from './AutoUnarchivedNotice.svelte';
  import { getAutoUnarchivedNotice } from './auto-unarchived-notice';

  import { WorkspaceId } from '$shared/types/branded-ids';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import {
    openWorkspaceFile,
    openWorkspaceNote,
  } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { getWorkspaceRouteContext } from '$lib/utils/workspace-route-context';

  const routeWorkspaceId = getWorkspaceRouteContext()?.workspaceId ?? undefined;

  const logger = createLogger('ChatMessage');

  function getOwningWorkspaceId(): string | undefined {
    return workspace?.id ? String(workspace.id) : routeWorkspaceId;
  }

  function getPanelOptions(event?: MouseEvent) {
    const target = event?.target;
    const sourcePanelId =
      target instanceof HTMLElement
        ? target.closest<HTMLElement>('[data-panel-id]')?.dataset.panelId
        : undefined;
    return {
      openInAdjacentPanel: Boolean(event?.metaKey || event?.ctrlKey),
      sourcePanelId,
    };
  }

  function openChatFile(path: string, event?: MouseEvent) {
    if (readOnly) return;
    const workspaceId = getOwningWorkspaceId();
    if (!workspaceId) return;
    appStore.dispatch(openWorkspaceFile(workspaceId, path, getPanelOptions(event)));
  }

  function openChatNote(noteId: string, event?: MouseEvent) {
    if (readOnly) return;
    const workspaceId = getOwningWorkspaceId();
    if (!workspaceId) return;
    appStore.dispatch(openWorkspaceNote(workspaceId, noteId, getPanelOptions(event)));
  }
  // Type for parsed context items (pills shown before text)
  interface ContextPill {
    type:
      'file' | 'diff' | 'note' | 'spec' | 'selection' | 'linear' | 'github' | 'sentry' | 'external';
    label: string;
    icon: typeof faFile;
    /** File path for file/diff pills */
    path?: string;
    /** Note ID for note pills */
    noteId?: string;
    /** External URL for external references */
    url?: string;
    /** Full content for tooltip */
    content?: string;
  }

  /**
   * Fix GitHub URL for PRs and issues
   * The stored URL may be incorrect (e.g., author's profile instead of PR/issue URL)
   * Identifier format: "owner/repo#number" -> URL: "https://github.com/owner/repo/pull/number" or "/issues/number"
   */
  function fixGitHubUrl(
    provider: string,
    identifier: string | undefined,
    rawUrl: string | undefined,
    metadata?: Record<string, any>,
  ): string | undefined {
    if (provider === 'github' && identifier) {
      const match = identifier.match(/^([^/]+)\/([^#]+)#(\d+)$/);
      if (match) {
        const [, owner, repo, number] = match;
        // Use 'pull' for PRs, 'issues' for issues
        // Check if metadata has sourceBranch (indicates it's a PR)
        const isPR = Boolean(metadata?.sourceBranch);
        const pathType = isPR ? 'pull' : 'issues';
        return `https://github.com/${owner}/${repo}/${pathType}/${number}`;
      }
    }
    return rawUrl;
  }
  // Type for inline message segments (text interspersed with mentions)
  type MessageSegment =
    | { type: 'text'; content: string }
    | {
        type: 'mention';
        mentionType: string;
        label: string;
        id: string;
        identifier?: string;
        icon: typeof faFile;
        path?: string;
        noteId?: string;
        url?: string;
      };

  interface Props {
    /**
     * Fallback message object. Used when `agentId` + `messageId` are not both
     * provided (e.g. pending/optimistic messages). When both ids
     * are supplied, the component subscribes to Redux via `selectAgentMessageById`
     * and the selector result drives rendering instead of this prop.
     */
    message?: AgentMessage;
    /** Agent session id; when paired with `messageId`, enables per-message Redux subscription. */
    agentId?: string;
    /** Message id; when paired with `agentId`, enables per-message Redux subscription. */
    messageId?: string;
    isStreaming?: boolean;
    animationDelay?: number;
    hideToolCalls?: boolean;
    sessionMetadata?: any; // Session metadata containing applied rules
    /** Workspace for SimpleRichInput in edit mode */
    workspace?: Workspace | null;
    /**
     * Called when user wants to edit and resend the message. `blocks`
     * carries the attachment content blocks restored/edited in the edit
     * strip (PROTOCOL §5.5) so edit/regenerate never drops attachments.
     */
    onEditSubmit?: (
      newText: string,
      model?: string,
      blocks?: { imageBlocks?: ImageBlock[]; fileBlocks?: FileBlock[] },
    ) => void;
    /** Model to pre-select in the model picker when editing */
    editModel?: string | null;
    /** Called when user wants to regenerate the assistant response */
    onRegenerate?: () => void;
    /** Called when user wants to fork the conversation from this message */
    onFork?: () => void;
    /** Called when user votes on assistant response */
    onVote?: (vote: 'up' | 'down') => void;
    onCopy?: () => void;
    onRegisterRef?: (element: HTMLDivElement) => void;
    /** Called when user wants to scroll to previous user message */
    onScrollToPrevious?: () => void;
    /** Keeps an edited virtualized turn materialized until edit mode closes. */
    onEditStateChange?: (isEditing: boolean) => void;
    isSticky?: boolean;
    onStickyClick?: () => void;
    /** Backend session ID (auggie ID) for debugging */
    backendSessionId?: string | null;
    /** Hide noisy stopped badges for interrupted automated coordination turns. */
    suppressCoordinationStoppedIndicator?: boolean;
    /** Disable all outbound actions in isolated catalog and visual-test previews. */
    readOnly?: boolean;
    /** False when an outer transcript row owns the canonical message identity attributes. */
    ownsMessageIdentity?: boolean;
    /**
     * Drop the automated wake card's external top margin when the preceding
     * batched-delivery gap already owns the seam.
     */
    suppressAutomatedWakeTopSpacing?: boolean;
    /** True when this message is the conversation's final assistant message. */
    isLastConversationMessage?: boolean;
  }

  let {
    message: messageProp,
    agentId,
    messageId,
    isStreaming = false,
    animationDelay: _animationDelay = 0,
    hideToolCalls = false,
    sessionMetadata,
    workspace = null,
    onEditSubmit,
    editModel,
    onRegenerate,
    onFork,
    onVote,
    onCopy,
    onRegisterRef,
    onScrollToPrevious,
    onEditStateChange,
    isSticky = false,
    onStickyClick,
    backendSessionId,
    suppressCoordinationStoppedIndicator = false,
    readOnly = false,
    ownsMessageIdentity = true,
    suppressAutomatedWakeTopSpacing = false,
    isLastConversationMessage = false,
  }: Props = $props();

  // Per-message Redux subscription. Must be called at component-init time
  // (top of <script>) per src/store/renderer/AGENTS.md §5. The selector short-circuits
  // to `undefined` when either id is empty, so subscribing unconditionally with
  // empty-string fallbacks is safe and avoids a conditional-store gotcha with
  // Svelte's `$store` auto-subscription.
  // svelte-ignore state_referenced_locally -- intentional initial snapshot; keyed component identity is fixed.
  const storeMessage$ = selectAgentMessageById(agentId ?? '', messageId ?? '');

  // Lazy full-block hydration (§5.5 slim projection → v7.2
  // agent.getMessageBlock) for user-message attached images: the slim
  // projection may serve them as write-time thumbnails (dataTruncated /
  // dataIsThumbnail), so the lightbox fetches the original on demand.
  // Init-time subscription per src/store/renderer/AGENTS.md §5.
  // svelte-ignore state_referenced_locally -- intentional initial snapshot; keyed component identity is fixed.
  const hydratedBlocks$ = selectHydratedBlocks(agentId ?? '');

  // Looked-up message drives ALL downstream $derived values, the optional identity
  // attributes, and the `{#if !message}` guard. When both ids are provided we use
  // the selector result (live reference from Redux); otherwise we fall back to
  // the `message` prop to preserve today's behavior for pending/optimistic
  // messages where ids may not be Redux-backed.
  let message = $derived(agentId && messageId ? $storeMessage$ : messageProp);
  let messageCreatedAt = $derived.by(() => {
    if (!message || !('createdAt' in message)) return undefined;
    const value = message.createdAt;
    return typeof value === 'string' || typeof value === 'number' || value instanceof Date
      ? value
      : undefined;
  });
  // Edit mode state
  let isEditing = $state(false);
  let editValue = $state('');
  let editContextItems = $state<ContextItem[]>([]);
  let editSelectedModel = $state<string | null | undefined>(undefined);
  // Go/no-go confirmation gate before the destructive edit-and-regenerate.
  let showEditConfirm = $state(false);

  let role = $derived(
    message
      ? typeof message.role === 'string'
        ? (message.role as 'user' | 'assistant' | 'system')
        : (String(message.role).toLowerCase() as 'user' | 'assistant' | 'system')
      : 'assistant',
  );
  // Daemon-persisted model-change transcript row (metadata type "model_changed")
  let modelChangeNotice = $derived(getModelChangeNotice(message));

  let questionsDismissedNotice = $derived(getQuestionsDismissedNotice(message));

  // Daemon-persisted auto-unarchive transcript row (metadata type "auto_unarchived")
  let autoUnarchivedNotice = $derived(getAutoUnarchivedNotice(message));

  // Daemon-persisted attention-request row (meta.kind "discussion-request"/"blocker-report")
  let attentionNotice = $derived(getAttentionNotice(message));

  let shouldShowStoppedIndicator = $derived.by(() => {
    return resolveShouldShowStoppedIndicator({
      message,
      isStreaming,
      suppressCoordinationStoppedIndicator,
    });
  });

  // Reason-specific Stopped label (PROTOCOL §7 interrupted-row metadata);
  // legacy rows without `interruptReason` keep the generic "Stopped".
  let stoppedIndicatorLabel = $derived.by(() => {
    const label = resolveStoppedIndicatorLabel(message);
    switch (label.kind) {
      case 'preempted-by-message':
        return m.chat_chatMessage_stoppedPreemptedByMessage_label();
      case 'preempted-by-agent':
        return m.chat_chatMessage_stoppedPreemptedByAgent_label({ name: label.name });
      case 'daemon-shutdown':
        return m.chat_chatMessage_stoppedDaemonRestarted_label();
      case 'agent-stopped':
        return m.chat_chatMessage_stoppedAgentTerminated_label();
      case 'system-suspend':
        return m.chat_chatMessage_stoppedSystemSuspend_label();
      case 'stopped':
        return m.chat_chatMessage_stopped_label();
      default: {
        // Compile-time exhaustiveness: a new descriptor kind is a type error
        // here; at runtime it still falls back to the generic "Stopped".
        const _exhaustive: never = label;
        void _exhaustive;
        return m.chat_chatMessage_stopped_label();
      }
    }
  });

  // Abnormal-finish notice (PROTOCOL §7.3 `metadata.finishReason`): rendered
  // once the turn is over — live via the `agent:stream:end` finishReason
  // stamp, and after reload from the persisted row metadata. Suppressed while
  // streaming so it never flashes mid-turn.
  let finishReasonNoticeLabel = $derived.by(() => {
    if (isStreaming) return undefined;
    const notice = resolveFinishReasonNotice(message);
    if (!notice) return undefined;
    switch (notice.kind) {
      case 'refusal':
        return m.chat_chatMessage_finishReasonRefusal_label();
      case 'max-tokens':
        return m.chat_chatMessage_finishReasonMaxTokens_label();
      default: {
        // Compile-time exhaustiveness: a new descriptor kind is a type error
        // here; at runtime an unknown kind renders no notice.
        const _exhaustive: never = notice;
        void _exhaustive;
        return undefined;
      }
    }
  });

  // Sender attribution for agent-to-agent messages (metadata-first, null when
  // metadata is absent or malformed so plain user messages render unchanged).
  let agentAttribution = $derived(
    role === 'user' ? getAgentMessageAttribution(message?.metadata) : null,
  );
  let isAgentMessageExpanded = $state(false);
  let agentMessagePreview = $derived(
    message
      ? (role === 'user' ? getPresentedUserMessageText(message) : extractAllContent(message)).trim()
      : '',
  );
  let agentMessageBodyId = $derived(`agent-message-body-${message?.id ?? 'pending'}`);

  // Queued-delivery info for messages drained from the pending queue
  // (metadata-first, null when absent/malformed; exact legacy note removal is
  // owned separately by the immutable user-message presentation boundary).
  let queueInfo = $derived(role === 'user' ? getQueueInfo(message?.metadata) : null);

  // Delivered background-hook and PR-monitor wakes share one metadata-first
  // classifier, including the protocol's legacy text prefixes.
  let automatedWakePresentation = $derived(
    role === 'user' ? getAutomatedWakePresentation(message) : null,
  );
  let hookWakeAttribution = $derived(
    automatedWakePresentation?.kind === 'hook' ? automatedWakePresentation.attribution : null,
  );
  let prMonitorWakeAttribution = $derived(
    automatedWakePresentation?.kind === 'pr' ? automatedWakePresentation.attribution : null,
  );
  let isAutomatedWakeExpanded = $state(false);
  let automatedWakeBodyId = $derived(`automated-wake-body-${message?.id ?? 'pending'}`);

  // Local state
  let messageElement = $state<HTMLDivElement>();
  let showRulesInspector = $state(false);

  // Lightbox state for sent image attachments
  let lightboxOpen = $state(false);
  let lightboxImageUrl = $state('');
  let lightboxImageName = $state('');
  let lightboxOpenerElement: HTMLButtonElement | null = $state(null);

  // Parse context pills from message text
  // Context format: [Currently viewing file: path] or [Currently viewing note: title] etc.
  function parseContextFromMessage(text: string): { pills: ContextPill[]; cleanText: string } {
    const pills: ContextPill[] = [];
    let cleanText = text;

    // Match context patterns at the start of the message
    // Each pattern can optionally be followed by a code block containing the content
    const contextPatterns = [
      {
        // File context with optional code block content
        regex: /^\[Currently viewing file: ([^\]]+)\](?:\n```[^\n]*\n[\s\S]*?\n```)?\n*/,
        type: 'file' as const,
        icon: faFile,
      },
      {
        // Diff context with optional code block content
        regex: /^\[Currently viewing diff for: ([^\]]+)\](?:\n```[^\n]*\n[\s\S]*?\n```)?\n*/,
        type: 'diff' as const,
        icon: faCodeCompare,
      },
      {
        // Note context with optional code block content
        regex: /^\[Currently viewing note: ([^\]]+)\](?:\n```[^\n]*\n[\s\S]*?\n```)?\n*/,
        type: 'note' as const,
        icon: faNoteSticky,
      },
      {
        // Spec context with optional code block content
        regex: /^\[Currently viewing: Spec\](?:\n```[^\n]*\n[\s\S]*?\n```)?\n*/,
        type: 'spec' as const,
        icon: faClipboard,
        label: 'Spec',
      },
      {
        // Selected text with source file and code block
        regex: /^\[Selected text from ([^\]:]+):\n```\n([\s\S]*?)\n```\]\n*/,
        type: 'selection' as const,
        icon: faFile,
        hasSource: true,
      },
      {
        // Selected text with code block (no source)
        regex: /^\[Selected text:\n```\n([\s\S]*?)\n```\]\n*/,
        type: 'selection' as const,
        icon: faFile,
      },
      {
        // Selected text from chat input with code block
        regex: /^\[Selected text from chat input:\n```\n([\s\S]*?)\n```\]\n*/,
        type: 'selection' as const,
        icon: faFile,
      },
    ];

    // Keep parsing until no more context patterns match
    let foundMatch = true;
    while (foundMatch) {
      foundMatch = false;
      for (const pattern of contextPatterns) {
        const match = cleanText.match(pattern.regex);
        if (match) {
          foundMatch = true;
          let label: string;
          let path: string | undefined;
          let noteId: string | undefined;

          if ('label' in pattern && pattern.label) {
            label = pattern.label;
          } else if (pattern.type === 'selection') {
            // For selections with source, match[1] is source, match[2] is text
            // For selections without source, match[1] is text
            const hasSource = 'hasSource' in pattern && pattern.hasSource;
            const text = hasSource ? match[2] : match[1];
            const source = hasSource ? match[1] : null;
            const truncatedText = `"${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`;
            label = source ? `${truncatedText} from ${source}` : truncatedText;
            if (source) {
              path = source; // Source file for selection
            }
          } else {
            label = match[1];
          }

          // Capture path/noteId based on type
          if (pattern.type === 'file' || pattern.type === 'diff') {
            path = match[1]; // File path
          } else if (pattern.type === 'note') {
            // For notes, the label is the title - we'd need the ID to navigate
            // Store the title as noteId for now (the navigation will need to look it up)
            noteId = match[1];
          } else if (pattern.type === 'spec') {
            noteId = 'spec';
          }

          pills.push({
            type: pattern.type,
            label,
            icon: pattern.icon,
            path,
            noteId,
          });
          cleanText = cleanText.replace(pattern.regex, '');
          break;
        }
      }
    }

    return { pills, cleanText: cleanText.trim() };
  }

  // Parse text into segments with inline mentions rendered as chips
  // Matches @note/..., @file paths, @context[...], etc.
  // refsByIdentifier: Map of identifier -> context reference (for URL lookup)
  function parseInlineMentions(
    text: string,
    refsByIdentifier?: Map<string, any>,
  ): MessageSegment[] {
    const segments: MessageSegment[] = [];

    let lastIndex = 0;

    // Matching (shared with StickyMessageHeader) lives in mention-match-utils
    for (const match of findInlineMentions(text)) {
      // Add text before the match
      if (match.index > lastIndex) {
        const textBefore = text.slice(lastIndex, match.index);
        if (textBefore) {
          segments.push({ type: 'text', content: textBefore });
        }
      }

      const fullMatch = match.fullMatch; // e.g., "@context[linear|AU-123|Title]" or "@note/spec"
      const captured = match.captured; // e.g., "context[linear|AU-123|Title]" or "note/spec"

      if (captured.startsWith('context[')) {
        // Context mention: @context[provider|identifier|title] or @context[base64JSON]
        const inner = captured.slice(8, -1); // Remove "context[" and "]"

        let provider = 'browser';
        let identifier = '';
        let title = '';
        let url: string | undefined;

        // Check if this is base64-encoded JSON (starts with eyJ which is {"  in base64)
        if (inner.startsWith('eyJ')) {
          try {
            const decoded = atob(inner);
            const json = JSON.parse(decoded);
            provider = json.provider || 'browser';
            identifier = json.identifier || '';
            title = json.title || identifier || m.chat_shared_context_fallback();
            url = json.url;
          } catch {
            // Fall back to treating as pipe-separated format
            const parts = inner.split('|');
            provider = parts[0] || 'browser';
            identifier = parts[1] || '';
            title = parts[2] || identifier;
          }
        } else {
          // Standard pipe-separated format: provider|identifier|title
          const parts = inner.split('|');
          provider = parts[0] || 'browser';
          identifier = parts[1] || '';
          title = parts[2] || identifier;
        }

        // Look up URL and metadata from refs if not already set
        const ref = identifier ? refsByIdentifier?.get(identifier) : undefined;
        if (!url) {
          url = ref?.url;
        }

        // Fix GitHub URLs - the stored URL may be the author's profile instead of the PR/issue URL
        if (provider === 'github') {
          url = fixGitHubUrl(provider, identifier, url, ref?.metadata);
        }

        // Determine icon based on provider (fallback, ProviderIcon is used in template)
        let icon = faFile;
        if (provider === 'linear') icon = faClipboard;
        else if (provider === 'github') icon = faFile;
        else if (provider === 'sentry') icon = faFile;

        segments.push({
          type: 'mention',
          mentionType: provider,
          label: title, // Just the title, identifier shown separately
          identifier: identifier || undefined,
          id: identifier || title,
          icon,
          url,
        });
      } else if (captured.startsWith('note/')) {
        // Note mention: @note/{noteId}
        const noteId = captured.slice(5); // Remove "note/" prefix
        const wsId = getOwningWorkspaceId() ?? '';
        const allNotes = selectAllNotes.select(appStore.state, wsId);
        const matchingNote = allNotes.find((n) => n.id === noteId) ?? null;
        const label = matchingNote?.title || noteId;

        segments.push({
          type: 'mention',
          mentionType: noteId === 'spec' ? 'spec' : 'note',
          label,
          id: noteId,
          icon: noteId === 'spec' ? faClipboard : faNoteSticky,
          noteId,
        });
      } else {
        // File/folder mention: @path/to/file.ext
        const path = captured;
        const fileName = path.split('/').pop() || path;

        segments.push({
          type: 'mention',
          mentionType: 'file',
          label: fileName,
          id: path,
          icon: faFile,
          path,
        });
      }

      lastIndex = match.index + fullMatch.length;
    }

    // Add remaining text after last match
    if (lastIndex < text.length) {
      const remaining = text.slice(lastIndex);
      if (remaining) {
        segments.push({ type: 'text', content: remaining });
      }
    }

    // If no matches found, return the whole text as a single segment
    if (segments.length === 0 && text) {
      segments.push({ type: 'text', content: text });
    }

    return segments;
  }

  // Convert context references from message metadata to pills

  function contextReferencesToPills(contextRefs: any[]): ContextPill[] {
    const pills: ContextPill[] = [];
    for (const ref of contextRefs) {
      const refType = ref.type || ref.itemType || '';
      const provider = ref.provider || ref.source || '';

      // Handle Linear issues
      if (refType === 'linear' || refType === 'linear-issue' || provider === 'linear') {
        pills.push({
          type: 'linear',
          label: ref.identifier || ref.title || m.chat_chatMessage_linearIssue_fallback(),
          icon: faFile,
          url: ref.url,
          content: ref.title || ref.description,
        });
      }
      // Handle GitHub issues
      else if (refType === 'github' || refType === 'github-issue' || provider === 'github') {
        // Fix the URL - it may be the author's profile URL instead of the PR/issue URL
        const fixedUrl = fixGitHubUrl(provider, ref.identifier, ref.url, ref.metadata);
        pills.push({
          type: 'github',
          label: ref.identifier || ref.title || m.chat_chatMessage_githubIssue_fallback(),
          icon: faFile,
          url: fixedUrl,
          content: ref.title || ref.description,
        });
      }
      // Handle Sentry issues
      else if (refType === 'sentry' || refType === 'sentry-issue' || provider === 'sentry') {
        pills.push({
          type: 'sentry',
          label: ref.identifier || ref.title || m.chat_chatMessage_sentryIssue_fallback(),
          icon: faFile,
          url: ref.url,
          content: ref.title || ref.description,
        });
      }
      // Handle internal note references
      else if (refType === 'note') {
        pills.push({
          type: 'note',
          label: ref.title || ref.identifier || m.chat_shared_note_fallback(),
          icon: faNoteSticky,
          noteId: ref.noteId || ref.identifier,
          content: ref.content || ref.description,
        });
      }
      // Handle spec references
      else if (refType === 'spec') {
        pills.push({
          type: 'spec',
          label: m.chat_shared_spec_label(),
          icon: faClipboard,
          content: ref.content || ref.description,
        });
      }
      // Handle file references
      else if (refType === 'file') {
        pills.push({
          type: 'file',
          label: ref.path?.split('/').pop() || ref.title || m.chat_shared_file_fallback(),
          icon: faFile,
          path: ref.path,
          content: ref.content,
        });
      }
      // Handle diff references
      else if (refType === 'diff') {
        pills.push({
          type: 'diff',
          label: ref.path?.split('/').pop() || m.chat_shared_diff_fallback(),
          icon: faCodeCompare,
          path: ref.path,
          content: ref.content,
        });
      }
      // Generic external reference with URL
      else if (ref.url) {
        pills.push({
          type: 'external',
          label: ref.title || ref.identifier || m.chat_chatMessage_externalLink_fallback(),
          icon: faFile,
          url: ref.url,
          content: ref.content || ref.description,
        });
      }
    }
    return pills;
  }

  // Handle clicking on a context pill to navigate to the referenced content
  async function handlePillClick(pill: ContextPill, event?: MouseEvent) {
    if (readOnly) return;
    // Handle external links (Linear, GitHub, Sentry, etc.) via unified link handler
    if (pill.url) {
      const wsId = getOwningWorkspaceId();
      if (wsId) {
        await handleLink(pill.url, {
          workspaceId: WorkspaceId(wsId),
          event,
        });
      }
      return;
    }
    if (pill.type === 'spec') {
      openChatNote('spec', event);
    } else if (pill.type === 'file' && pill.path) {
      openChatFile(pill.path, event);
    } else if (pill.type === 'diff' && pill.path) {
      // For diffs, open the file - the diff view would need to be triggered separately
      openChatFile(pill.path, event);
    } else if (pill.type === 'note' && pill.noteId) {
      // noteId is actually the note title from the context string
      // Look up the actual note ID from the title
      const noteTitle = pill.noteId;
      const wsId = getOwningWorkspaceId() ?? '';
      const allNotes = selectAllNotes.select(appStore.state, wsId);
      const matchingNote = allNotes.find((n) => n.title === noteTitle) ?? null;
      if (matchingNote) {
        openChatNote(matchingNote.id, event);
      }
    } else if (pill.type === 'selection' && pill.path) {
      openChatFile(pill.path, event);
    }
  }

  // Extract text content for display from contentBlocks
  function extractTextFromMessage(): string {
    if (message?.contentBlocks && Array.isArray(message.contentBlocks)) {
      return message.contentBlocks
        .filter((block: any) => block.type === 'text' && block.text)
        .map((block: any) => block.text)
        .join('');
    }
    return '';
  }

  // Extract image blocks from contentBlocks, substituting cached full blocks
  // for slim-truncated ones (§5.5) so a hydrated attachment renders/opens at
  // full resolution. Includes attachment-reference blocks (attachmentId, no
  // bytes — monorepo#3338); those resolve to workspace-file:// URLs below.
  const imageBlocks = $derived.by(() => {
    if (!message?.contentBlocks || !Array.isArray(message.contentBlocks)) {
      return [];
    }
    return mergeHydratedContent(
      message.contentBlocks,
      message?.id ?? messageId,
      $hydratedBlocks$,
    ).filter(
      (block: any) =>
        block.type === 'image' && ((block.data && block.mimeType) || block.attachmentId),
    );
  });

  // Resolved workspace-file:// URLs for attachment-reference image blocks,
  // keyed by attachmentId. Registry rows are immutable so each id resolves
  // once (module-level cache dedupes across messages); a failed resolve
  // leaves the key unset and the thumbnail renders a placeholder.
  let referenceImageUrls = $state<Record<string, string>>({});
  $effect(() => {
    const wsId = getOwningWorkspaceId();
    if (!wsId) return;
    for (const block of imageBlocks) {
      const attachmentId = (block as ContentBlock).attachmentId;
      if (!attachmentId || referenceImageUrls[attachmentId] !== undefined) continue;
      void resolveAttachmentImageUrl(wsId, attachmentId).then((url) => {
        if (url) referenceImageUrls = { ...referenceImageUrls, [attachmentId]: url };
      });
    }
  });

  /** Renderable src for an image block: inline data URL or resolved reference URL. */
  function imageBlockSrc(block: ContentBlock): string | null {
    if (block.attachmentId) return referenceImageUrls[block.attachmentId] ?? null;
    if (block.data && block.mimeType) return `data:${block.mimeType};base64,${block.data}`;
    return null;
  }

  // Truncated attachment awaiting hydration before its lightbox opens.
  // Keeps the pre-click thumbnail block so the settle effect can still open
  // something if the block list shifts underneath the fetch.
  let pendingLightboxHydration = $state<{
    blockId: string;
    openerElement: HTMLButtonElement;
    index: number;
    thumbnailBlock: ContentBlock & { data: string; mimeType: string };
  } | null>(null);

  function isAttachmentHydrationLoading(blockId: string | undefined): boolean {
    return blockId
      ? isHydrationPending($hydratedBlocks$, message?.id ?? messageId, [blockId])
      : false;
  }

  // Open image in lightbox. A slim-truncated attachment (thumbnail-only data,
  // §5.5) first fetches the original via agent.getMessageBlock; the effect
  // below opens the lightbox once hydration settles. Attachment-reference
  // blocks open their resolved workspace-file:// URL directly (full bytes
  // served by the protocol handler — no hydration round-trip needed).
  function openImageLightbox(
    imageBlock: ContentBlock,
    openerElement: HTMLButtonElement,
    index: number = 0,
  ) {
    if (readOnly) return;
    if (imageBlock.attachmentId) {
      const url = referenceImageUrls[imageBlock.attachmentId];
      if (!url) return;
      lightboxImageUrl = url;
      lightboxImageName =
        imageBlock.fileName ||
        m.chat_chatMessage_attachedImage_fallback({ number: formatInteger(index + 1) });
      lightboxOpenerElement = openerElement;
      lightboxOpen = true;
      return;
    }
    if (!isImageBlock(imageBlock)) return;
    const hydrationMessageId = message?.id ?? messageId;
    if (imageBlock.dataTruncated === true && agentId && hydrationMessageId && imageBlock.id) {
      pendingLightboxHydration = {
        blockId: imageBlock.id,
        openerElement,
        index,
        thumbnailBlock: imageBlock,
      };
      appStore.dispatch(messageBlockHydrationRequested(agentId, hydrationMessageId, imageBlock.id));
      return;
    }
    lightboxImageUrl = `data:${imageBlock.mimeType};base64,${imageBlock.data}`;
    lightboxImageName =
      imageBlock.fileName ||
      m.chat_chatMessage_attachedImage_fallback({ number: formatInteger(index + 1) });
    lightboxOpenerElement = openerElement;
    lightboxOpen = true;
  }

  // Once the pending block's fetch settles, open the lightbox with the merged
  // block: hydrated full data on success, the original thumbnail on failure
  // (graceful fallback — the merge leaves errored blocks untouched). The
  // block is looked up by id only — an index fallback could open a different
  // image if the block list shifted between click and settle. If the id is
  // gone (or the merged block is no longer a valid image), fall back to the
  // pre-click thumbnail so the click never silently no-ops.
  $effect(() => {
    const pending = pendingLightboxHydration;
    if (!pending) return;
    // Reactive trigger only: the throttled selector readable re-runs this
    // effect on each store cadence tick.
    const hydratedFromReadable = $hydratedBlocks$;
    // Decide on a FRESH store read, not the readable: its emit lags the
    // request dispatch by up to one cadence tick (throttledSelectorFrequency),
    // so on the click's own flush it still shows the pre-request map — no
    // `loading` entry — and this effect would open the thumbnail immediately.
    const hydrated = agentId
      ? selectHydratedBlocks.select(appStore.state, agentId)
      : hydratedFromReadable;
    const hydrationMessageId = message?.id ?? messageId;
    if (isHydrationPending(hydrated, hydrationMessageId, [pending.blockId])) return;
    const mergedContent = Array.isArray(message?.contentBlocks)
      ? mergeHydratedContent(message.contentBlocks, hydrationMessageId, hydrated)
      : [];
    const merged = mergedContent.find((b: any) => b.id === pending.blockId);
    const block = merged && isImageBlock(merged) ? merged : pending.thumbnailBlock;
    if (block === pending.thumbnailBlock || block.dataTruncated === true) {
      logger.warn(
        // i18n-ignore (diagnostic log line, not user-facing)
        'Attachment lightbox falling back to thumbnail: hydration did not yield a full image block',
        { agentId, messageId: hydrationMessageId, blockId: pending.blockId },
      );
    }
    pendingLightboxHydration = null;
    lightboxImageUrl = `data:${block.mimeType};base64,${block.data}`;
    lightboxImageName =
      block.fileName ||
      m.chat_chatMessage_attachedImage_fallback({ number: formatInteger(pending.index + 1) });
    lightboxOpenerElement = pending.openerElement;
    lightboxOpen = true;
  });

  // Extract file blocks from contentBlocks — both the legacy inline-data
  // variant (data + mimeType) and attachment-reference blocks (attachmentId,
  // no bytes; PROTOCOL §5.5 v6.12).
  const fileBlocks = $derived.by(() => {
    if (!message?.contentBlocks || !Array.isArray(message.contentBlocks)) {
      return [];
    }
    return message.contentBlocks.filter(
      (block: any) => block.type === 'file' && (block.data || block.attachmentId) && block.fileName,
    );
  });

  // Secondary text for a file chip: size and/or mime from the block's inline
  // metadata; empty string when neither is present.
  function fileChipSecondaryText(block: ContentBlock): string {
    const parts: string[] = [];
    if (typeof block.size === 'number') parts.push(formatFileSize(block.size));
    if (block.mimeType) parts.push(block.mimeType);
    return parts.join(' • '); // i18n-ignore (mime type + formatted size separator)
  }

  // Click on an attachment-reference chip: the workspace-navigation tab saga
  // resolves the registry row by attachmentId (file.getAttachmentInfo,
  // PROTOCOL §5.9) and opens the stored workspace-relative path in a file
  // tab. A missing file (deleted from disk out-of-band) or a failed lookup
  // surfaces a toast — never a crash.
  function openAttachmentReference(block: ContentBlock & { attachmentId?: string }) {
    if (readOnly) return;
    const wsId = getOwningWorkspaceId();
    if (!block.attachmentId || !wsId) return;
    appStore.dispatch(openWorkspaceAttachment(wsId, block.attachmentId, block.fileName ?? ''));
  }

  // Download a legacy inline-data file block via a data URL.
  function downloadInlineFileBlock(block: ContentBlock, index: number) {
    if (readOnly) return;
    const dataUrl = `data:${block.mimeType || 'application/octet-stream'};base64,${block.data}`;
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = block.fileName || `file-${index}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Parse context and get clean text for user messages
  const parsedMessage = $derived.by(() => {
    const rawText =
      automatedWakePresentation?.bodyText ??
      (role === 'user' && message
        ? getPresentedUserMessageText(message)
        : extractTextFromMessage());
    if (role === 'user') {
      const parsed = parseContextFromMessage(rawText);
      // Get metadata refs for URL lookup
      const metadataRefs = message?.metadata?.contextReferences;

      // Build a map of identifier -> ref for quick URL lookup
      const refsByIdentifier = new Map<string, any>();
      if (Array.isArray(metadataRefs)) {
        for (const ref of metadataRefs) {
          if (ref.identifier) {
            refsByIdentifier.set(ref.identifier, ref);
          }
        }
      }

      // Parse inline mentions first to collect which identifiers are in the text
      // (we'll skip adding metadata pills for these since they're already shown inline)
      const segments = parseInlineMentions(parsed.cleanText, refsByIdentifier);

      // Collect identifiers that appear as inline mentions in the text
      const inlineIdentifiers = new Set<string>();
      for (const seg of segments) {
        if (seg.type === 'mention' && seg.id) {
          inlineIdentifiers.add(seg.id);
        }
      }

      // Add context references from metadata ONLY if they're not already shown as inline mentions
      if (Array.isArray(metadataRefs) && metadataRefs.length > 0) {
        // Filter out refs that are already shown as inline mentions
        const nonDuplicateRefs = metadataRefs.filter(
          (ref) => !ref.identifier || !inlineIdentifiers.has(ref.identifier),
        );
        if (nonDuplicateRefs.length > 0) {
          const metadataPills = contextReferencesToPills(nonDuplicateRefs);
          parsed.pills = [...metadataPills, ...parsed.pills];
        }
      }

      return { ...parsed, segments };
    }
    return {
      pills: [],
      cleanText: rawText,
      segments: [{ type: 'text' as const, content: rawText }],
    };
  });

  // Get combined content for StreamingMessageContent - use $derived for reactivity
  const combinedContent = $derived(message?.contentBlocks || []);

  // Agent Q&A wizard-only rendering: question-only turns render no bubble.
  const questionOnlyTurn = $derived(role === 'assistant' && isQuestionOnlyContent(combinedContent));

  // Get plain text from message for copying/editing
  function getMessageText(): string {
    if (message?.contentBlocks && Array.isArray(message.contentBlocks)) {
      return message.contentBlocks
        .filter((block) => block.type === 'text' && block.text)
        .map((block) => block.text)
        .join('');
    }
    return '';
  }

  // Safely stringify a value, handling circular references and errors
  function safeStringify(value: any, indent: number = 2): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, indent);
    } catch {
      return String(value);
    }
  }

  // Get full message text including tool calls for clipboard copy
  function getFullMessageText(): string {
    const parts: string[] = [];
    // Track tool IDs we've already processed from contentBlocks to avoid duplication
    const processedToolIds = new Set<string>();

    // Extract text and tool blocks from contentBlocks
    if (role === 'user' && message) {
      const presentedText = getPresentedUserMessageText(message);
      if (presentedText.trim()) parts.push(presentedText);
    }
    if (message?.contentBlocks && Array.isArray(message.contentBlocks)) {
      for (const block of message.contentBlocks) {
        if (block.type === 'text') {
          if (role === 'user') continue;
          const text = (block as any).text || (block as any).content || '';
          if (text.trim()) {
            parts.push(text);
          }
        } else if (block.type === 'tool_use') {
          const name = (block as any).name || (block as any).toolName || 'unknown';
          const input = (block as any).input || {};
          parts.push(`🔧 Tool: ${name}\nInput:\n${safeStringify(input)}`);
          // Track the tool ID to avoid duplication from toolCalls array
          const toolId = (block as any).id || (block as any).toolCallId;
          if (toolId) processedToolIds.add(toolId);
        } else if (block.type === 'tool_result') {
          const isError = (block as any).is_error || (block as any).isError || false;
          const content =
            (block as any).content || (block as any).output || (block as any).text || '';
          // i18n-ignore (plain-text clipboard transcript serialization)
          const prefix = isError ? '❌ Tool Error' : '✅ Tool Result';
          parts.push(`${prefix}:\n${safeStringify(content)}`);
          // Track the tool_use_id to avoid duplication from toolResults array
          const toolUseId = (block as any).tool_use_id || (block as any).toolCallId;
          if (toolUseId) processedToolIds.add(toolUseId);
        } else if (block.type === 'thinking' && (block as any).text) {
          parts.push(`💭 Thinking:\n${(block as any).text}`);
        }
      }
    }

    // Include tool calls from the toolCalls array (skip if already in contentBlocks)
    if (message?.toolCalls && Array.isArray(message.toolCalls)) {
      for (const toolCall of message.toolCalls) {
        // Skip if we already processed this tool from contentBlocks
        if (toolCall.id && processedToolIds.has(toolCall.id)) continue;
        const name = toolCall.name || (toolCall as any).toolName || 'unknown';
        const args =
          toolCall.arguments || (toolCall as any).input || (toolCall as any).parameters || {};
        let output = `🔧 Tool: ${name}\nInput:\n${safeStringify(args)}`;
        if (toolCall.error) {
          output += `\n❌ Error: ${typeof toolCall.error === 'string' ? toolCall.error : safeStringify(toolCall.error)}`;
        } else if (toolCall.result !== undefined) {
          output += `\n✅ Result:\n${safeStringify(toolCall.result)}`;
        }
        parts.push(output);
      }
    }

    // Include tool results from the toolResults array (skip if already in contentBlocks)
    if (message?.toolResults && Array.isArray(message.toolResults)) {
      for (const result of message.toolResults) {
        // Skip if we already processed this result from contentBlocks
        if (result.toolCallId && processedToolIds.has(result.toolCallId)) continue;
        const isError = result.isError || false;
        const content = result.content || '';
        // i18n-ignore (plain-text clipboard transcript serialization)
        const prefix = isError ? '❌ Tool Error' : '✅ Tool Result';
        parts.push(`${prefix}:\n${safeStringify(content)}`);
      }
    }

    return parts.join('\n\n');
  }

  // Handle copy action
  async function handleCopy() {
    const text = getFullMessageText();
    await navigator.clipboard.writeText(text);
    onCopy?.();
  }

  // Handle edit mode
  function handleStartEdit() {
    // Presentation-only delivery notes stay out of edit/retry text while the
    // canonical stored content remains unchanged.
    const rawText = message ? getPresentedUserMessageText(message) : getMessageText();
    const parsed = parseStoredMessage(rawText);
    editValue = parsed.userMessage;

    // Start with parsed context items (from text patterns)
    const contextItemsForEdit: ContextItem[] = [...parsed.contextItems];

    // Extract image blocks from contentBlocks and add as context items
    if (message?.contentBlocks && Array.isArray(message.contentBlocks)) {
      message.contentBlocks.forEach((block: any, index: number) => {
        if (block.type === 'image' && block.attachmentId) {
          // Attachment-reference image block (monorepo#3338): restore as a
          // placed image item (UUID + mime marker, no bytes) so the edit
          // re-sends the same reference without re-uploading.
          contextItemsForEdit.push({
            id: `image-attachment-${block.attachmentId}`,
            type: 'file',
            label: `Image ${index + 1}`,
            description: block.mimeType || 'image',
            attachmentId: block.attachmentId,
            // `imageMimeType` doubles as the image marker downstream; a
            // reference persisted without a mime keeps the neutral 'image'
            // marker rather than fabricating one — the wire mimeType is
            // optional on the reference arm and is omitted at re-send.
            imageMimeType: block.mimeType || 'image',
          });
        } else if (block.type === 'image' && block.data && block.mimeType) {
          contextItemsForEdit.push({
            id: `image-${message.id}-${index}`,
            type: 'file',
            label: `Image ${index + 1}`,
            description: block.mimeType,
            imageData: block.data,
            imageMimeType: block.mimeType,
          });
        } else if (block.type === 'file' && block.attachmentId && block.fileName) {
          // Attachment-reference block: restore as a placed-attachment item
          // (UUID + metadata only) so the re-send builds the same reference.
          contextItemsForEdit.push({
            id: `attachment-${block.attachmentId}`,
            type: 'file',
            label: block.fileName,
            description: block.mimeType || m.chat_shared_file_fallback(),
            attachmentId: block.attachmentId,
            attachmentMimeType: block.mimeType,
            attachmentSize: block.size,
          });
        } else if (block.type === 'file' && block.data && block.fileName) {
          contextItemsForEdit.push({
            id: `file-${message.id}-${index}`,
            type: 'file',
            label: block.fileName,
            description: block.mimeType || m.chat_shared_file_fallback(),
            fileData: block.data,
            fileMimeType: block.mimeType,
          });
        }
      });
    }

    editContextItems = contextItemsForEdit;
    editSelectedModel = editModel;
    isEditing = true;
    onEditStateChange?.(true);
  }

  function handleCancelEdit() {
    isEditing = false;
    onEditStateChange?.(false);
    editValue = '';
    editContextItems = [];
    editSelectedModel = undefined;
  }

  onDestroy(() => {
    if (isEditing) onEditStateChange?.(false);
  });

  // Editing regenerates from this message onward — a destructive daemon-side
  // truncation (agent.editAndRegenerate, PROTOCOL §5.5) — so gate the dispatch
  // behind an explicit confirmation; cancel keeps edit mode + draft intact.
  // Confirm sends the edited text + selected model plus the attachment blocks
  // rebuilt from the edit strip's context items (image blocks and
  // attachment-reference file blocks — §5.5 accepts both on
  // agent.editAndRegenerate), so attachments survive edit/regenerate; then
  // handleCancelEdit exits edit mode.
  function handleConfirmEditSubmit() {
    showEditConfirm = false;
    // An attachmentId item marked as an image (imageMimeType) re-sends as an
    // image-reference block (monorepo#3338); inline imageData items re-send
    // inline (the edit saga places them and swaps to references).
    const imageBlocks: ImageBlock[] = editContextItems
      .filter((item) => (item.imageData || item.attachmentId) && item.imageMimeType)
      .map((item) =>
        item.attachmentId
          ? {
              type: 'image' as const,
              attachmentId: item.attachmentId,
              // The neutral 'image' marker (reference restored without a
              // mime) stays off the wire — mimeType is optional on the
              // reference arm.
              ...(item.imageMimeType!.includes('/') ? { mimeType: item.imageMimeType! } : {}),
            }
          : {
              type: 'image' as const,
              data: item.imageData!,
              mimeType: item.imageMimeType!,
            },
      );
    const fileBlocks: FileBlock[] = editContextItems
      .filter((item) => item.attachmentId && !item.imageMimeType)
      .map((item) => ({
        type: 'file' as const,
        attachmentId: item.attachmentId!,
        fileName: item.label,
        ...(item.attachmentMimeType ? { mimeType: item.attachmentMimeType } : {}),
        ...(item.attachmentSize !== undefined ? { size: item.attachmentSize } : {}),
      }));
    const blocks =
      imageBlocks.length > 0 || fileBlocks.length > 0
        ? {
            ...(imageBlocks.length > 0 ? { imageBlocks } : {}),
            ...(fileBlocks.length > 0 ? { fileBlocks } : {}),
          }
        : undefined;
    onEditSubmit?.(editValue, editSelectedModel ?? undefined, blocks);
    handleCancelEdit();
  }

  // Register element reference
  $effect(() => {
    if (messageElement && onRegisterRef) {
      onRegisterRef(messageElement);
    }
  });

  // Format duration in seconds with one decimal place
  function formatDuration(ms?: number): string {
    if (!ms) return '';
    return (ms / 1000).toFixed(1) + 's';
  }

  // Format token count with k suffix for thousands
  function formatTokenCount(count?: number): string {
    if (!count) return '';
    if (count >= 1000) {
      return (count / 1000).toFixed(1) + 'k';
    }
    return count.toString();
  }

  // Get metadata display info for assistant messages
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const metadataInfo = $derived.by(() => {
    if (role !== 'assistant' || !message?.metadata) {
      return null;
    }

    const metadata = message.metadata;
    const parts: string[] = [];

    // Add duration
    if (metadata.duration_ms) {
      parts.push(formatDuration(metadata.duration_ms));
    }

    // Add model name
    if (metadata.model) {
      parts.push(metadata.model);
    }

    // Add token count (total tokens if available, otherwise completion tokens)
    const tokenCount = metadata.usage?.totalTokens || metadata.usage?.completionTokens;
    if (tokenCount) {
      parts.push(formatTokenCount(tokenCount) + ' tokens');
    }

    return parts.length > 0 ? parts : null;
  });
</script>

{#if !message}
  <!-- Guard against null message prop -->
  <div class="type-caption p-2 text-subtle">{m.chat_chatMessage_loading_label()}</div>
{:else if modelChangeNotice}
  <!-- Daemon-persisted model-change notice row - centered inline divider -->
  <ModelChangeNotice
    notice={modelChangeNotice}
    fallbackText={extractAllContent(message) || undefined}
  />
{:else if questionsDismissedNotice}
  <QuestionsDismissedNotice title={extractAllContent(message) || undefined} />
{:else if autoUnarchivedNotice}
  <!-- Daemon-persisted auto-unarchive notice row - centered inline divider -->
  <AutoUnarchivedNotice title={extractAllContent(message) || undefined} />
{:else if questionOnlyTurn && !shouldShowStoppedIndicator && !finishReasonNoticeLabel}
  <!-- Agent Q&A is wizard-only: question-only turns render no bubble -->{:else}
  <div
    bind:this={messageElement}
    class="group group/message transition-transform duration-200 ease-out {role === 'user'
      ? 'user-message'
      : 'relative assistant-message'}"
    data-message-id={ownsMessageIdentity ? message?.id : undefined}
    data-message-role={ownsMessageIdentity ? role : undefined}
    inert={readOnly}
  >
    {#if role === 'user'}
      {#if isEditing}
        <!-- Edit mode - use SimpleRichInput for rich editing experience -->
        <div class="rounded-xs" transition:safeSlide={{ axis: 'y', duration: 200 }}>
          <SimpleRichInput
            bind:value={editValue}
            bind:contextItems={editContextItems}
            {workspace}
            autoFocus
            editMode={true}
            selectedModel={editSelectedModel}
            onmodelChange={(model) => (editSelectedModel = model)}
            placeholder={m.chat_chatMessage_edit_placeholder()}
            onsubmit={() => (showEditConfirm = true)}
            oncancel={handleCancelEdit}
          />
        </div>
      {:else}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          data-testid="user-message-surface"
          data-conversation-role="user"
          data-automated-wake-card={automatedWakePresentation ? '' : undefined}
          data-external-spacing-owner={automatedWakePresentation && !suppressAutomatedWakeTopSpacing
            ? 'automated-wake-card'
            : undefined}
          class="{agentAttribution
            ? `${SUBSCRIPTION_CARD_CONTAINMENT_CLASS} ${SUBSCRIPTION_CARD_SURFACE_CLASS}`
            : automatedWakePresentation
              ? `relative ${suppressAutomatedWakeTopSpacing ? 'mt-0' : SUBSCRIPTION_IN_THREAD_CARD_SPACING_CLASS} ${SUBSCRIPTION_CARD_CONTAINMENT_CLASS} ${SUBSCRIPTION_CARD_SURFACE_CLASS}`
              : USER_MESSAGE_SURFACE_CLASS} {onEditSubmit &&
          !agentAttribution &&
          !hookWakeAttribution &&
          !prMonitorWakeAttribution
            ? 'cursor-pointer'
            : 'cursor-default'}"
          ondblclick={() =>
            onEditSubmit &&
            !agentAttribution &&
            !hookWakeAttribution &&
            !prMonitorWakeAttribution &&
            handleStartEdit()}
        >
          <!-- Actions -->
          {#if (!agentAttribution && !automatedWakePresentation) || isAgentMessageExpanded}
            <MessageActions
              role="user"
              onCopy={handleCopy}
              requestId={backendSessionId ?? undefined}
              {onScrollToPrevious}
              timestamp={message.timestamp}
              createdAt={messageCreatedAt}
              class="absolute right-1 z-10 {agentAttribution ? 'bottom-1' : 'top-1'}"
            />
          {/if}

          <!-- Sender attribution header for agent-to-agent messages -->
          {#if agentAttribution}
            <AgentMessageAttributionHeader
              attribution={agentAttribution}
              preview={agentMessagePreview}
              expanded={isAgentMessageExpanded}
              controlsId={agentMessageBodyId}
              ontoggle={() => (isAgentMessageExpanded = !isAgentMessageExpanded)}
            />
          {:else if automatedWakePresentation}
            <AutomatedWakeCardHeader
              presentation={automatedWakePresentation}
              expanded={isAutomatedWakeExpanded}
              controlsId={automatedWakeBodyId}
              {workspace}
              ontoggle={() => (isAutomatedWakeExpanded = !isAutomatedWakeExpanded)}
            />
          {/if}

          {#if (!agentAttribution || isAgentMessageExpanded) && (!automatedWakePresentation || isAutomatedWakeExpanded)}
            <div
              id={agentAttribution
                ? agentMessageBodyId
                : automatedWakePresentation
                  ? automatedWakeBodyId
                  : undefined}
              class={agentAttribution || automatedWakePresentation
                ? 'w-full min-w-0 max-w-full overflow-hidden border-t border-border px-3 py-2'
                : 'contents'}
              data-testid={agentAttribution
                ? 'agent-message-expanded-body'
                : automatedWakePresentation
                  ? 'automated-wake-details'
                  : undefined}
              transition:safeSubscriptionSlide
            >
              <!-- Queued-delivery notice for messages drained from the pending queue -->
              {#if queueInfo}
                <QueuedMessageNoticeHeader {queueInfo} {isSticky} class="mb-1.5" />
              {/if}

              <div
                class="type-body select-text text-pretty {agentAttribution ||
                automatedWakePresentation
                  ? 'font-medium! text-foreground'
                  : USER_MESSAGE_TEXT_CLASS} {agentAttribution
                  ? ''
                  : isSticky
                    ? 'line-clamp-2'
                    : automatedWakePresentation
                      ? 'max-w-full [overflow-wrap:anywhere]'
                      : 'line-clamp-6'} {isSticky ||
                (onEditSubmit &&
                  !agentAttribution &&
                  !hookWakeAttribution &&
                  !prMonitorWakeAttribution)
                  ? 'cursor-pointer'
                  : 'cursor-text'}"
                data-expanded={agentAttribution
                  ? isAgentMessageExpanded
                  : automatedWakePresentation
                    ? isAutomatedWakeExpanded
                    : undefined}
                onclick={(e) => {
                  if (isSticky && onStickyClick) {
                    e.preventDefault();
                    e.stopPropagation();
                    onStickyClick();
                    return;
                  }
                  if (
                    onEditSubmit &&
                    !agentAttribution &&
                    !hookWakeAttribution &&
                    !prMonitorWakeAttribution
                  ) {
                    e.preventDefault();
                    e.stopPropagation();
                    handleStartEdit();
                  }
                }}
              >
                <!-- Context pills from metadata (e.g., PR references, Linear issues) -->
                {#each parsedMessage.pills as pill, i (`${pill.type}-${pill.label}-${i}`)}
                  {@const isClickable = !!(
                    pill.path ||
                    pill.noteId ||
                    pill.url ||
                    pill.type === 'spec'
                  )}
                  <button
                    type="button"
                    class="type-caption mx-0.5 inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-muted/60 px-1.5 py-1 align-middle font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
                    title={pill.content || pill.path || pill.noteId || pill.label}
                    onclick={(e) => {
                      e.stopPropagation();
                      handlePillClick(pill, e);
                    }}
                    disabled={!isClickable}
                  >
                    <Fa icon={pill.icon} size="12" class="opacity-50" />
                    <span class="truncate font-medium" style="max-width: 180px;" title={pill.label}
                      >{pill.label}</span
                    >
                  </button>
                {/each}
                <!-- Render text with inline @mentions as chips -->
                {#each parsedMessage.segments as segment, i (i)}
                  {#if segment.type === 'text'}
                    <span class="whitespace-pre-wrap"
                      >{#each splitTextByUrls(segment.content) as part, j (j)}{#if part.type === 'link'}<a
                            href={part.url}
                            class="cursor-pointer break-all underline underline-offset-2 hover:opacity-80"
                            title={part.url}
                            onclick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const wsId = getOwningWorkspaceId();
                              handleLink(part.url, {
                                workspaceId: wsId ? WorkspaceId(wsId) : undefined,
                                event: e,
                              });
                            }}>{part.url}</a
                          >{:else}{part.content}{/if}{/each}</span
                    >
                  {:else if segment.type === 'mention'}
                    {@const isContextProvider = ['linear', 'github', 'sentry', 'browser'].includes(
                      segment.mentionType,
                    )}
                    {@const isClickable = !!(
                      segment.path ||
                      segment.noteId ||
                      segment.mentionType === 'spec' ||
                      segment.url
                    )}
                    <button
                      type="button"
                      class="type-caption mx-0.5 inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-muted/60 px-1.5 py-1 align-middle font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
                      title={segment.path ||
                        segment.noteId ||
                        (segment.identifier
                          ? `${segment.identifier}: ${segment.label}`
                          : segment.label)}
                      onclick={(e) => {
                        e.stopPropagation();
                        if (segment.url) {
                          const wsId = getOwningWorkspaceId();
                          if (wsId) {
                            handleLink(segment.url, {
                              workspaceId: WorkspaceId(wsId),
                              event: e,
                            });
                          }
                        } else if (segment.path) {
                          openChatFile(segment.path, e);
                        } else if (segment.noteId) {
                          if (segment.mentionType === 'spec') {
                            openChatNote('spec', e);
                          } else {
                            openChatNote(segment.noteId, e);
                          }
                        }
                      }}
                      disabled={!isClickable}
                    >
                      {#if isContextProvider}
                        <ProviderIcon
                          provider={segment.mentionType as ContextProvider}
                          size={12}
                          class="shrink-0 opacity-30"
                        />
                      {:else}
                        <Fa icon={segment.icon} size="12" class="opacity-30" />
                      {/if}
                      {#if segment.identifier}
                        <span class="text-subtle shrink-0">{segment.identifier}</span>
                      {/if}
                      <span class="truncate" style="max-width: 180px;" title={segment.label}
                        >{segment.label}</span
                      >
                    </button>
                  {/if}
                {/each}
              </div>
              <!-- Attached images -->
              {#if imageBlocks.length > 0 && !isSticky}
                <div class="flex flex-wrap gap-1.5 mt-2">
                  {#each imageBlocks as imageBlock, i (i)}
                    {@const src = imageBlockSrc(imageBlock)}
                    <button
                      type="button"
                      class="relative group/image p-0 border-0 bg-transparent cursor-pointer overflow-hidden w-10 h-10 shrink-0 focus:outline-none focus:ring-2 focus:ring-primary rounded"
                      class:animate-pulse={isAttachmentHydrationLoading(imageBlock.id)}
                      aria-busy={isAttachmentHydrationLoading(imageBlock.id)}
                      onclick={(e) => {
                        openImageLightbox(imageBlock, e.currentTarget, i);
                      }}
                      onkeydown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.currentTarget.click();
                        }
                      }}
                      aria-label={m.chat_chatMessage_viewAttachedImage_ariaLabel({
                        number: formatInteger(i + 1),
                        total: formatInteger(imageBlocks.length),
                      })}
                    >
                      {#if src}
                        <img
                          {src}
                          alt={m.chat_chatMessage_attachedImage_alt({
                            number: formatInteger(i + 1),
                          })}
                          class="w-full h-full rounded border border-border object-cover hover:opacity-90 transition-opacity"
                        />
                      {:else}
                        <!-- Reference still resolving (or its file is gone):
                         neutral placeholder tile instead of a broken img. -->
                        <div class="w-full h-full rounded border border-border bg-muted/50"></div>
                      {/if}
                    </button>
                  {/each}
                </div>
              {/if}

              <!-- Attached files: attachment-reference chips open the file in a
               tab (resolved by attachmentId); legacy inline-data chips keep
               the data-URL download behavior. -->
              {#if fileBlocks.length > 0 && !isSticky}
                <div class="flex flex-wrap gap-1.5 mt-2">
                  {#each fileBlocks as fileBlock, i (i)}
                    {@const secondary = fileChipSecondaryText(fileBlock)}
                    <button
                      type="button"
                      data-testid="chat-message-file-chip"
                      class="type-caption flex cursor-pointer items-center gap-1.5 rounded border border-border bg-muted/50 px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      onclick={() => {
                        if (fileBlock.attachmentId) {
                          openAttachmentReference(fileBlock);
                        } else {
                          downloadInlineFileBlock(fileBlock, i);
                        }
                      }}
                      title={fileBlock.attachmentId
                        ? m.chat_chatMessage_openAttachment_title({ name: `${fileBlock.fileName}` })
                        : m.chat_chatMessage_download_title({ name: `${fileBlock.fileName}` })}
                    >
                      <Fa icon={faFile} class="w-3 h-3" />
                      <span class="truncate" style="max-width: 150px;">{fileBlock.fileName}</span>
                      {#if secondary}
                        <span class="opacity-60 shrink-0">{secondary}</span>
                      {/if}
                    </button>
                  {/each}
                </div>
              {/if}

              <!-- Send failure indicator for optimistic user messages -->
              {#if message?.error}
                <div
                  class="type-caption mt-2 flex items-center gap-2 font-medium text-danger"
                  title={message.error}
                >
                  <Fa icon={faCircleExclamation} class="size-2.5 mt-px" />
                  <span>{m.chat_chatMessage_failedToSend_label()}</span>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    {:else if role === 'assistant'}
      <!-- Assistant Message -->
      <div class="type-body text-pretty text-foreground">
        <StreamingMessageContent
          content={combinedContent}
          {isStreaming}
          {hideToolCalls}
          workspaceId={workspace?.id ? String(workspace.id) : undefined}
          {agentId}
          messageId={message?.id ?? messageId}
          {isLastConversationMessage}
        />

        <!-- Stopped indicator for interrupted messages -->
        {#if shouldShowStoppedIndicator}
          <div class="type-caption mt-5 flex items-center gap-2 font-medium text-subtle">
            <Fa icon={faSquare} class="size-2.5 opacity-50 mt-px" />
            <span>{stoppedIndicatorLabel}</span>
          </div>
        {/if}

        <!-- Abnormal-finish notice (refusal / token limit, PROTOCOL §7.3) -->
        {#if finishReasonNoticeLabel}
          <div class="type-caption mt-5 flex items-center gap-2 font-medium text-subtle">
            <Fa icon={faCircleExclamation} class="size-2.5 opacity-50 mt-px" />
            <span>{finishReasonNoticeLabel}</span>
          </div>
        {/if}

        <!-- Actions for assistant messages: overlay without shifting content on hover/focus -->
        {#if !isStreaming && !questionOnlyTurn}
          <MessageActions
            role="assistant"
            {onRegenerate}
            {onFork}
            {onVote}
            onCopy={handleCopy}
            requestId={backendSessionId ?? undefined}
            timestamp={message.timestamp}
            createdAt={messageCreatedAt}
            class="absolute bottom-0 right-0 z-10"
          />
        {/if}
      </div>
    {:else if role === 'system'}
      <!-- System Message - attention-request notice or interruption banner -->
      {#if attentionNotice?.kind === 'discussion-request'}
        <DiscussionRequestNotice reason={attentionNotice.reason} />
      {:else if attentionNotice?.kind === 'blocker-report'}
        <BlockerReportNotice reason={attentionNotice.reason} />
      {:else if attentionNotice?.kind === 'turn-failure'}
        <TurnFailureNotice reason={attentionNotice.reason} />
      {:else}
        <InterruptionNotice message={extractAllContent(message)} />
      {/if}
    {/if}
  </div>
{/if}

{#if showRulesInspector}
  <RulesInspector
    rules={sessionMetadata?.appliedRules}
    onClose={() => (showRulesInspector = false)}
  />
{/if}

<!-- Image Lightbox for sent message attachments -->
<ImageLightbox
  bind:open={lightboxOpen}
  imageUrl={lightboxImageUrl}
  imageName={lightboxImageName}
  openerElement={lightboxOpenerElement}
/>

<!-- Destructive-truncation confirmation before edit-and-regenerate -->
<EditRegenerateConfirmDialog
  open={showEditConfirm}
  onConfirm={handleConfirmEditSubmit}
  onCancel={() => (showEditConfirm = false)}
/>
