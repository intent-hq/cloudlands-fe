<script lang="ts">
  import {
    faFile,
    faCodeCompare,
    faNoteSticky,
    faClipboard,
    faSquare,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import StreamingMessageContent from './StreamingMessageContent.svelte';
  import MessageActions from './MessageActions.svelte';
  import SimpleRichInput from './input/SimpleRichInput.svelte';
  import type { AgentMessage } from '$features/agent/agent-ipc-bridge';
  import type { Workspace } from '$shared/types';
  import RulesInspector from './RulesInspector.svelte';
  import { parseStoredMessage } from '$lib/utils/parseStoredMessage';
  import { slide } from 'svelte/transition';
  import type { ContextItem } from './input/context-api';
  import { navigateToFile, navigateToNote, navigateToSpec } from '$lib/utils/workspace-navigation';
  import ProviderIcon from '$lib/components/icons/ProviderIcon.svelte';
  import type { ContextProvider } from '$features/context/types';
  import { handleLink } from '$features/navigation/link-handler';
  import { selectActiveWorkspaceId } from '$lib/store/slices/workspace/workspace-selectors';
  import { selectAllNotes } from '$lib/store/slices/workspace-notes/workspace-notes-selectors';
  import { selectAgentMessageById } from '$lib/store/slices/agent-session/agent-session-selectors';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import { WorkspaceId } from '$shared/types/branded-ids';

  const activeWorkspaceId = selectActiveWorkspaceId();

  // Type for parsed context items (pills shown before text)
  interface ContextPill {
    type:
      | 'file'
      | 'diff'
      | 'note'
      | 'spec'
      | 'selection'
      | 'linear'
      | 'github'
      | 'sentry'
      | 'external';
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
    showTimestamp?: boolean;
    animationDelay?: number;
    hideToolCalls?: boolean;
    sessionMetadata?: any; // Session metadata containing applied rules
    /** Workspace for SimpleRichInput in edit mode */
    workspace?: Workspace | null;
    /** Called when user wants to edit and resend the message */
    onEditSubmit?: (newText: string, model?: string) => void;
    /** Model to pre-select in the model picker when editing */
    editModel?: string;
    /** Called when user wants to regenerate the assistant response */
    onRegenerate?: () => void;
    /** Called when user wants to fork the conversation from this message */
    onFork?: () => void;
    /** Called when user votes on assistant response */
    onVote?: (vote: 'up' | 'down') => void;
    onCopy?: () => void;
    onRegisterRef?: (element: HTMLDivElement) => void;
    /** Whether sticky behavior should be enabled for this user message */
    enableSticky?: boolean;
    /** Called when user wants to scroll to previous user message */
    onScrollToPrevious?: () => void;
    /** Backend session ID (auggie ID) for debugging */
    backendSessionId?: string | null;
  }

  let {
    message: messageProp,
    agentId,
    messageId,
    isStreaming = false,
     
    showTimestamp: _showTimestamp = true,
     
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    enableSticky = false,
    onScrollToPrevious,
    backendSessionId,
  }: Props = $props();

  // Per-message Redux subscription. Must be called at component-init time
  // (top of <script>) per src/lib/store/AGENTS.md §5. The selector short-circuits
  // to `undefined` when either id is empty, so subscribing unconditionally with
  // empty-string fallbacks is safe and avoids a conditional-store gotcha with
  // Svelte's `$store` auto-subscription.
  const storeMessage$ = selectAgentMessageById(agentId ?? '', messageId ?? '');

  // Looked-up message drives ALL downstream $derived values, the `data-message-id`
  // attribute, and the `{#if !message}` guard. When both ids are provided we use
  // the selector result (live reference from Redux); otherwise we fall back to
  // the `message` prop to preserve today's behavior for pending/optimistic
  // messages where ids may not be Redux-backed.
  let message = $derived(agentId && messageId ? $storeMessage$ : messageProp);

  // Edit mode state
  let isEditing = $state(false);
  let editValue = $state('');
  let editContextItems = $state<ContextItem[]>([]);
  let editSelectedModel = $state<string | undefined>(undefined);

  let role = $derived(
    message
      ? typeof message.role === 'string'
        ? (message.role as 'user' | 'assistant' | 'system')
        : (String(message.role).toLowerCase() as 'user' | 'assistant' | 'system')
      : 'assistant',
  );

  // Local state
  let messageElement: HTMLDivElement;
  let showRulesInspector = $state(false);

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

    // Regex to match @mentions:
    // - @context[provider|identifier|title] - context mentions (Linear, GitHub, etc.)
    // - @note/{noteId} - note mentions
    // - @{path} - file/folder mentions (paths with / or file extensions)
    const mentionRegex =
      /@(context\[[^\]]+\]|note\/[^\s]+|[^\s@]+\.[a-zA-Z]+(?::[L\d-]+)?|[^\s@]*\/[^\s]+)/g;

    let lastIndex = 0;
    let match;

    while ((match = mentionRegex.exec(text)) !== null) {
      // Add text before the match
      if (match.index > lastIndex) {
        const textBefore = text.slice(lastIndex, match.index);
        if (textBefore) {
          segments.push({ type: 'text', content: textBefore });
        }
      }

      const fullMatch = match[0]; // e.g., "@context[linear|AU-123|Title]" or "@note/spec"
      const captured = match[1]; // e.g., "context[linear|AU-123|Title]" or "note/spec"

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
            title = json.title || identifier || 'Context';
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
        const wsId = $activeWorkspaceId ?? '';
        const allNotes = selectAllNotes.select(getReduxStore().getState(), wsId);
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
          label: ref.identifier || ref.title || 'Linear Issue',
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
          label: ref.identifier || ref.title || 'GitHub Issue',
          icon: faFile,
          url: fixedUrl,
          content: ref.title || ref.description,
        });
      }
      // Handle Sentry issues
      else if (refType === 'sentry' || refType === 'sentry-issue' || provider === 'sentry') {
        pills.push({
          type: 'sentry',
          label: ref.identifier || ref.title || 'Sentry Issue',
          icon: faFile,
          url: ref.url,
          content: ref.title || ref.description,
        });
      }
      // Handle internal note references
      else if (refType === 'note') {
        pills.push({
          type: 'note',
          label: ref.title || ref.identifier || 'Note',
          icon: faNoteSticky,
          noteId: ref.noteId || ref.identifier,
          content: ref.content || ref.description,
        });
      }
      // Handle spec references
      else if (refType === 'spec') {
        pills.push({
          type: 'spec',
          label: 'Spec',
          icon: faClipboard,
          content: ref.content || ref.description,
        });
      }
      // Handle file references
      else if (refType === 'file') {
        pills.push({
          type: 'file',
          label: ref.path?.split('/').pop() || ref.title || 'File',
          icon: faFile,
          path: ref.path,
          content: ref.content,
        });
      }
      // Handle diff references
      else if (refType === 'diff') {
        pills.push({
          type: 'diff',
          label: ref.path?.split('/').pop() || 'Diff',
          icon: faCodeCompare,
          path: ref.path,
          content: ref.content,
        });
      }
      // Generic external reference with URL
      else if (ref.url) {
        pills.push({
          type: 'external',
          label: ref.title || ref.identifier || 'External Link',
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
    // Handle external links (Linear, GitHub, Sentry, etc.) via unified link handler
    if (pill.url) {
      const wsId = $activeWorkspaceId;
      if (wsId) {
        await handleLink(pill.url, {
          workspaceId: WorkspaceId(wsId),
          event,
        });
      }
      return;
    }
    if (pill.type === 'spec') {
      await navigateToSpec();
    } else if (pill.type === 'file' && pill.path) {
      await navigateToFile(pill.path);
    } else if (pill.type === 'diff' && pill.path) {
      // For diffs, open the file - the diff view would need to be triggered separately
      await navigateToFile(pill.path);
    } else if (pill.type === 'note' && pill.noteId) {
      // noteId is actually the note title from the context string
      // Look up the actual note ID from the title
      const noteTitle = pill.noteId;
      const wsId = $activeWorkspaceId ?? '';
      const allNotes = selectAllNotes.select(getReduxStore().getState(), wsId);
      const matchingNote = allNotes.find((n) => n.title === noteTitle) ?? null;
      if (matchingNote) {
        await navigateToNote(matchingNote.id);
      }
    } else if (pill.type === 'selection' && pill.path) {
      await navigateToFile(pill.path);
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

  // Extract image blocks from contentBlocks
  const imageBlocks = $derived.by(() => {
    if (!message?.contentBlocks || !Array.isArray(message.contentBlocks)) {
      return [];
    }
    return message.contentBlocks.filter(
      (block: any) => block.type === 'image' && block.data && block.mimeType,
    );
  });

  // Extract file blocks from contentBlocks
  const fileBlocks = $derived.by(() => {
    if (!message?.contentBlocks || !Array.isArray(message.contentBlocks)) {
      return [];
    }
    return message.contentBlocks.filter(
      (block: any) => block.type === 'file' && block.data && block.fileName,
    );
  });

  // Parse context and get clean text for user messages
  const parsedMessage = $derived.by(() => {
    const rawText = extractTextFromMessage();
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
    if (message?.contentBlocks && Array.isArray(message.contentBlocks)) {
      for (const block of message.contentBlocks) {
        if (block.type === 'text') {
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
    // Parse the stored message to extract context and user message
    const rawText = getMessageText();
    const parsed = parseStoredMessage(rawText);
    editValue = parsed.userMessage;

    // Start with parsed context items (from text patterns)
    const contextItemsForEdit: ContextItem[] = [...parsed.contextItems];

    // Extract image blocks from contentBlocks and add as context items
    if (message?.contentBlocks && Array.isArray(message.contentBlocks)) {
      message.contentBlocks.forEach((block: any, index: number) => {
        if (block.type === 'image' && block.data && block.mimeType) {
          contextItemsForEdit.push({
            id: `image-${message.id}-${index}`,
            type: 'file',
            label: `Image ${index + 1}`,
            description: block.mimeType,
            imageData: block.data,
            imageMimeType: block.mimeType,
          });
        } else if (block.type === 'file' && block.data && block.fileName) {
          contextItemsForEdit.push({
            id: `file-${message.id}-${index}`,
            type: 'file',
            label: block.fileName,
            description: block.mimeType || 'File',
            fileData: block.data,
            fileMimeType: block.mimeType,
          });
        }
      });
    }

    editContextItems = contextItemsForEdit;
    editSelectedModel = editModel;
    isEditing = true;
  }

  function handleCancelEdit() {
    isEditing = false;
    editValue = '';
    editContextItems = [];
    editSelectedModel = undefined;
  }

  function handleSaveEdit(newText: string) {
    isEditing = false;
    // Send just the edited user message text.
    // Context is managed separately by the chat service when re-sending.
    // Pass the selected model so regeneration uses the same (or user-changed) model.
    onEditSubmit?.(newText, editSelectedModel);
    editValue = '';
    editContextItems = [];
    editSelectedModel = undefined;
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
  <div class="text-subtle text-sm p-2">Loading...</div>
{:else}
  <div
    bind:this={messageElement}
    class="group transition-transform duration-200 ease-out {role === 'user'
      ? 'user-message'
      : 'relative assistant-message px-2'}"
    data-message-id={message?.id}
    data-message-role={role}
  >
    {#if role === 'user'}
      <!-- User Message: Two-layer approach -->
      <!-- Layer 1: Sticky compact version - sticks to top when scrolled past -->
      <!-- Layer 2: Full expanded version - in normal flow, scrolls away, covers sticky when in view -->
      {#if isEditing}
        <!-- Edit mode - use SimpleRichInput for rich editing experience -->
        <div class="rounded-xs" transition:slide={{ axis: 'y', duration: 200 }}>
          <SimpleRichInput
            bind:value={editValue}
            bind:contextItems={editContextItems}
            {workspace}
            autoFocus
            editMode={true}
            selectedModel={editSelectedModel}
            onmodelChange={(model) => (editSelectedModel = model)}
            placeholder="Edit your message..."
            onsubmit={() => handleSaveEdit(editValue)}
            oncancel={handleCancelEdit}
          />
        </div>
      {:else}
        <!-- Full expanded version - uses negative margin to overlap the sticky header in ChatPanel -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="relative bg-sidebar rounded-xs px-2 pt-2 pb-2 cursor-pointer overflow-hidden z-20"
          ondblclick={() => onEditSubmit && handleStartEdit()}
        >
          <!-- Actions -->
          <div
            class="absolute top-1 right-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <div
              class="flex items-center gap-0.5 bg-sidebar/95 backdrop-blur-sm rounded-md border border-border"
            >
              <MessageActions
                role="user"
                onCopy={handleCopy}
                showOnHover={false}
                requestId={backendSessionId ?? undefined}
                {onScrollToPrevious}
              />
            </div>
          </div>

          <!-- Message content - line-clamp-6 -->
          <div
            class="leading-normal text-subtle whitespace-pre-wrap select-text line-clamp-6 {onEditSubmit
              ? 'cursor-pointer'
              : 'cursor-text'}"
            onclick={(e) => {
              if (onEditSubmit) {
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
                class="inline-flex items-center gap-1 px-1.5 py-1 bg-muted/60 text-foreground/80 rounded-md text-xs whitespace-nowrap font-medium hover:bg-muted hover:text-foreground transition-colors mx-0.5 align-middle"
                title={pill.content || pill.path || pill.noteId || pill.label}
                onclick={(e) => {
                  e.stopPropagation();
                  handlePillClick(pill, e);
                }}
                disabled={!isClickable}
              >
                <Fa icon={pill.icon} size="12" class="opacity-50" />
                <span class="font-medium truncate max-w-[180px]" title={pill.label}
                  >{pill.label}</span
                >
              </button>
            {/each}
            <!-- Render text with inline @mentions as chips -->
            {#each parsedMessage.segments as segment, i (i)}
              {#if segment.type === 'text'}
                <span>{segment.content}</span>
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
                  class="inline-flex items-center gap-1 px-1.5 py-1 bg-muted/60 text-foreground/80 rounded-md text-xs whitespace-nowrap font-medium hover:bg-muted hover:text-foreground transition-colors mx-0.5 align-middle"
                  title={segment.path ||
                    segment.noteId ||
                    (segment.identifier
                      ? `${segment.identifier}: ${segment.label}`
                      : segment.label)}
                  onclick={(e) => {
                    e.stopPropagation();
                    if (segment.url) {
                      const wsId = $activeWorkspaceId;
                      if (wsId) {
                        handleLink(segment.url, {
                          workspaceId: WorkspaceId(wsId),
                          event: e,
                        });
                      }
                    } else if (segment.path) {
                      navigateToFile(segment.path);
                    } else if (segment.noteId) {
                      if (segment.mentionType === 'spec') {
                        navigateToNote('spec');
                      } else {
                        navigateToNote(segment.noteId);
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
                  <span class="max-w-[180px] truncate" title={segment.label}>{segment.label}</span>
                </button>
              {/if}
            {/each}
          </div>

          <!-- Attached images -->
          {#if imageBlocks.length > 0}
            <div class="flex flex-wrap gap-1.5 mt-2">
              {#each imageBlocks as imageBlock, i (i)}
                <button
                  type="button"
                  class="relative group/image p-0 border-0 bg-transparent cursor-pointer overflow-hidden w-10 h-10 shrink-0"
                  onclick={() => {
                    const dataUrl = `data:${imageBlock.mimeType};base64,${imageBlock.data}`;
                    window.open(dataUrl, '_blank');
                  }}
                >
                  <img
                    src="data:{imageBlock.mimeType};base64,{imageBlock.data}"
                    alt="Attached"
                    class="w-full h-full rounded border border-border object-cover hover:opacity-90 transition-opacity"
                  />
                </button>
              {/each}
            </div>
          {/if}

          <!-- Attached files -->
          {#if fileBlocks.length > 0}
            <div class="flex flex-wrap gap-1.5 mt-2">
              {#each fileBlocks as fileBlock, i (i)}
                <button
                  type="button"
                  class="flex items-center gap-1.5 px-2 py-1 rounded border border-border bg-muted/50 hover:bg-muted transition-colors text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                  onclick={() => {
                    const dataUrl = `data:${fileBlock.mimeType || 'application/octet-stream'};base64,${fileBlock.data}`;
                    const link = document.createElement('a');
                    link.href = dataUrl;
                    link.download = fileBlock.fileName || `file-${i}`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                  }}
                  title={`Download ${fileBlock.fileName}`}
                >
                  <Fa icon={faFile} class="w-3 h-3" />
                  <span class="truncate max-w-[150px]">{fileBlock.fileName}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    {:else if role === 'assistant'}
      <!-- Assistant Message -->
      <div class="text-sm leading-relaxed text-foreground">
        <StreamingMessageContent content={combinedContent} {isStreaming} {hideToolCalls} workspaceId={workspace?.id ? String(workspace.id) : undefined} />

        <!-- Stopped indicator for interrupted messages -->
        {#if message?.metadata?.interrupted && !isStreaming}
          <div class="flex items-center gap-2 text-subtle font-medium text-sm mt-5">
            <Fa icon={faSquare} class="size-2.5 opacity-50 mt-px" />
            <span>Stopped</span>
          </div>
        {/if}

        <!-- Actions for assistant messages (shown on hover) -->
        {#if !isStreaming}
          <div class="flex items-center justify-end mt-2">
            <MessageActions
              role="assistant"
              {onRegenerate}
              {onFork}
              {onVote}
              onCopy={handleCopy}
              requestId={backendSessionId ?? undefined}
            />
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}

{#if showRulesInspector}
  <RulesInspector
    rules={sessionMetadata?.appliedRules}
    onClose={() => (showRulesInspector = false)}
  />
{/if}
