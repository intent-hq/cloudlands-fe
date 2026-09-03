<script lang="ts">
  /* eslint-disable max-lines */
  import { onMount, onDestroy, mount, unmount, untrack } from 'svelte';
  import { Popover } from 'bits-ui';

  import { Editor, getTextBetween, getTextSerializersFromSchema } from '@tiptap/core';
  import { PluginKey, TextSelection } from '@tiptap/pm/state';
  import StarterKit from '@tiptap/starter-kit';
  import Placeholder from '@tiptap/extension-placeholder';
  import Mention from '@tiptap/extension-mention';
  import Image from '@tiptap/extension-image';
  import { NoteVideo } from '$lib/components/tiptap/NoteVideo';
  import {
    ContextMention,
    type ContextMentionAttributes,
  } from '$lib/components/tiptap/ContextMention';
  import { PasteChip } from '$lib/components/tiptap/PasteChip';
  import { SkillCommand } from '$lib/components/tiptap/SkillCommand';
  import { createLogger } from '$lib/utils/client-logger';
  import { m } from '$shared/paraglide/messages.js';
  import type { ContextItem } from './context-api';
  import { isFileDragEvent, isFilePasteEvent } from '$lib/utils/drop-guard';
  import MentionHoverPreview from './MentionHoverPreview.svelte';
  import { createMentionSuggestionRenderer } from './mention-suggestion-renderer';
  import { getMentionSystem, type SearchContext } from '$lib/services/mentions';
  import type { Workspace } from '$shared/types';
  import { toPromptToken } from '$lib/services/mentions/format';
  import { noteUrl } from '$shared/constants/intent-links';
  import { createIntentLink } from '$lib/utils/tiptap-link-extension';
  import { Slice, Fragment } from '@tiptap/pm/model';
  import {
    plainTextToEditorHTML,
    serializeEditorText,
    pastedTextToParagraphNodes,
  } from './editor-text-serialization';
  import {
    TrailingHintExtension,
    trailingHintPluginKey,
    type TrailingHint,
  } from './trailing-hint-extension';
  import SlashSkillSuggestionList from './SlashSkillSuggestionList.svelte';
  import {
    findSlashCommandContext,
    rankSlashSkills,
    type SlashCommandContext,
  } from './slash-skill-command';
  import type { SkillInfo } from '$store/renderer/slices/skills/skills-types';
  import { getEffectiveShortcut } from '$lib/utils/effective-shortcuts';
  import { matchesShortcut, type ShortcutId } from '$lib/utils/shortcut-bindings';

  /** Represents an inline image in the editor content */
  export interface InlineImage {
    src: string; // data URL
    alt?: string;
  }

  // Extend Mention to parse our span[data-mention] chips back into nodes
  const MentionFromSpan = Mention.extend({
    parseHTML() {
      return [
        {
          tag: 'span[data-mention]',
          getAttrs: (el: HTMLElement) => {
            // Extract all attributes from the HTML element
            const metaRaw = el.getAttribute('data-meta');
            let meta = {};
            if (metaRaw) {
              try {
                meta = JSON.parse(metaRaw);
              } catch {
                meta = {};
              }
            }
            const attrs = {
              id: el.getAttribute('data-id') || el.textContent?.replace(/^@/, '') || null,
              label: el.getAttribute('data-label') || el.textContent?.replace(/^@/, '') || null,
              type: el.getAttribute('data-type') || 'file',
              uri: el.getAttribute('data-uri') || '',
              meta,
            };
            return attrs;
          },
        },
      ];
    },
    addAttributes() {
      return {
        id: {
          default: null,
          parseHTML: (el: any) =>
            el.getAttribute?.('data-id') || el.textContent?.replace(/^@/, '') || null,
          renderHTML: (attrs: any) => (attrs.id ? { 'data-id': attrs.id } : {}),
        },
        label: {
          default: null,
          parseHTML: (el: any) =>
            el.getAttribute?.('data-label') || el.textContent?.replace(/^@/, '') || null,
          renderHTML: (attrs: any) => (attrs.label ? { 'data-label': attrs.label } : {}),
        },
        type: {
          default: 'file',
          parseHTML: (el: any) => el.getAttribute?.('data-type') || 'file',
          renderHTML: (attrs: any) => ({ 'data-type': attrs.type || 'file' }),
        },
        uri: {
          default: '',
          parseHTML: (el: any) => el.getAttribute?.('data-uri') || '',
          renderHTML: (attrs: any) => (attrs.uri ? { 'data-uri': attrs.uri } : {}),
        },
        meta: {
          default: {},
          parseHTML: (el: any) => {
            const raw = el.getAttribute?.('data-meta');
            if (!raw) return {};
            try {
              return JSON.parse(raw);
            } catch {
              return {};
            }
          },
          renderHTML: (attrs: any) => ({ 'data-meta': JSON.stringify(attrs.meta || {}) }),
        },
      } as any;
    },
  });

  const logger = createLogger('TipTapEditor');
  const mentionSystem = getMentionSystem();

  interface Props {
    value?: string;
    placeholder?: string;
    class?: string;
    disabled?: boolean;
    editableWhileDisabled?: boolean;
    /**
     * Transient lock (e.g. an in-flight draft restore): rejects focus/typing
     * without the `disabled` styling path, so the placeholder stays visible.
     */
    inputLocked?: boolean;
    workspace?: Workspace;
    repoPath?: string;
    editorClassName?: string;
    autoFocus?: boolean;
    onUpdate?: (content: string) => void;
    onSubmit?: () => void;
    onForceSubmit?: () => void; // ⌘Enter - interrupt streaming and send immediately
    onEscape?: () => void; // Escape key - for cancel in edit mode
    onHistoryPrev?: () => string | null; // Arrow up - get previous history item
    onHistoryNext?: () => string | null; // Arrow down - get next history item
    onMentionStart?: (query: string) => void;
    onMentionSelect?: (item: any) => void;
    onSelectionChange?: (selectedText: string | null) => void;
    contextItems?: ContextItem[];
    trailingHint?: TrailingHint | null;
    skills?: readonly SkillInfo[];
    skillsLoading?: boolean;
    skillsError?: string | null;
    minHeight?: number;
    maxHeight?: number;
  }

  let {
    value = '',
    placeholder = m.chat_richInput_askAnything_placeholder(),
    disabled = false,
    editableWhileDisabled = false,
    inputLocked = false,
    class: className = '',
    editorClassName = '',
    workspace,
    repoPath,
    autoFocus = false,
    onUpdate,
    onSubmit,
    onForceSubmit,
    onEscape,
    onHistoryPrev,
    onHistoryNext,
    onMentionStart,
    onMentionSelect,
    onSelectionChange,

    contextItems: _contextItems = [],
    trailingHint = null,
    skills = [],
    skillsLoading = false,
    skillsError = null,
    minHeight = 80,
    maxHeight = 300,
  }: Props = $props();

  // `inputLocked` is an editability-only lock — it never routes through the
  // `disabled` styling, so the placeholder keeps rendering while it is on.
  const isEditable = $derived((!disabled || editableWhileDisabled) && !inputLocked);
  // Placeholder is configured with `showOnlyWhenEditable: false` for the lock,
  // which would otherwise also surface it in the plain-disabled state. The
  // extension options are fixed at editor creation, so suppression is CSS-side.
  const placeholderSuppressed = $derived(!isEditable && !inputLocked);

  let element = $state<HTMLDivElement>();
  let editor: Editor | null = $state(null);
  let hoverPreview: any = null;
  let hoverPreviewContainer: HTMLDivElement | null = null;
  let isClearing = false;
  let editorFocused = $state(false);
  let slashContext = $state<SlashCommandContext | null>(null);
  let dismissedSlashContext = $state<string | null>(null);
  let slashSuggestionList: { onKeyDown: (props: { event: KeyboardEvent }) => boolean } | null =
    $state(null);
  const componentId = $props.id();
  const slashListboxId = `slash-skill-listbox-${componentId}`;
  let slashActiveOptionId = $state<string | undefined>();

  const filteredSkills = $derived(slashContext ? rankSlashSkills(skills, slashContext.query) : []);
  const slashContextKey = $derived(
    slashContext ? `${slashContext.from}:${slashContext.to}:${slashContext.query}` : null,
  );
  const slashMenuOpen = $derived(
    editorFocused &&
      slashContext !== null &&
      slashContextKey !== dismissedSlashContext &&
      isEditable,
  );

  // Slash detection reads the doc through a dedicated serialization that
  // renders the paste chip as a single-space token boundary, so pasted chip
  // content can never form a slash token. Submit serialization
  // (serializeEditorText) is unaffected and still carries the full content.
  function slashDetectionSerializers(activeEditor: Editor) {
    return {
      ...getTextSerializersFromSchema(activeEditor.schema),
      hardBreak: () => '\n',
      pasteChip: () => ' ',
    };
  }

  function slashDetectionText(activeEditor: Editor, to: number): string {
    const text = getTextBetween(
      activeEditor.state.doc,
      { from: 0, to },
      { blockSeparator: '\n\n', textSerializers: slashDetectionSerializers(activeEditor) },
    );
    return text.replace(/\u00A0/g, ' ');
  }

  function slashPrompt(activeEditor: Editor): string {
    return slashDetectionText(activeEditor, activeEditor.state.doc.content.size);
  }

  function slashTextBeforeCursor(activeEditor: Editor): string {
    return slashDetectionText(activeEditor, activeEditor.state.selection.from);
  }

  function refreshSlashContext(activeEditor: Editor, options?: { dismissNewContext?: boolean }) {
    const prompt = slashPrompt(activeEditor);
    const nextContext = findSlashCommandContext(prompt, slashTextBeforeCursor(activeEditor).length);
    if (!nextContext) dismissedSlashContext = null;
    slashContext = nextContext;
    if (nextContext && options?.dismissNewContext) dismissSlashMenu();
  }

  function dismissSlashMenu() {
    dismissedSlashContext = slashContextKey;
  }

  function preserveEditorFocus(event: Event) {
    event.preventDefault();
  }

  function selectSlashSkill(skill: SkillInfo) {
    if (!editor || !slashContext) return;
    // Same serialization as refreshSlashContext so the offsets line up.
    const prompt = slashPrompt(editor);
    const cursorOffset = slashTextBeforeCursor(editor).length;
    const range = {
      from: editor.state.selection.from - slashContext.query.length - 1,
      to: editor.state.selection.from + slashContext.to - cursorOffset,
    };
    const needsSpace =
      slashContext.to === prompt.length || !/^\s/u.test(prompt.slice(slashContext.to));
    const content = [
      { type: 'skillCommand', attrs: { name: skill.name } },
      ...(needsSpace ? [{ type: 'text', text: ' ' }] : []),
    ];
    editor
      .chain()
      .focus()
      .insertContentAt(range, content)
      .setTextSelection(range.from + 2)
      .run();
  }

  function editorHTML(text: string): string {
    return plainTextToEditorHTML(
      text,
      skills.map((skill) => skill.name),
    );
  }

  function handleSlashMenuKeyDown(event: KeyboardEvent): boolean {
    if (!slashMenuOpen || !slashSuggestionList) return false;
    const isPlainNavigationKey =
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      ['ArrowUp', 'ArrowDown', 'Enter'].includes(event.key);
    if (event.key !== 'Escape' && !isPlainNavigationKey) return false;

    const handled = slashSuggestionList.onKeyDown({ event });
    if (handled) return true;

    // An open loading/empty/error menu still owns plain Enter so `/` cannot
    // accidentally submit while the user is trying to select a command.
    if (event.key === 'Enter') {
      event.preventDefault();
      return true;
    }
    return false;
  }

  // Export method to insert @ symbol
  export function insertAtSymbol() {
    if (editor && editor.view) {
      editor.chain().focus().insertContent('@').run();
    }
  }

  // Export method to insert plain text at the current cursor position
  export function insertText(text: string): boolean {
    if (editor && editor.view) {
      editor.chain().focus().insertContent(text).run();
      return true;
    }
    return false;
  }

  // Export focus method for parent components
  export function focus(): boolean {
    if (inputLocked) return false;
    if (editor && editor.view) {
      try {
        editor.chain().focus().run();
        if (typeof editor.view.hasFocus === 'function') {
          return editor.view.hasFocus();
        }
        return true;
      } catch (e) {
        // Silently ignore if editor is not ready
        logger.debug('[TipTapEditor] Editor not ready for focus:', e);
      }
    }
    return false;
  }

  // Focus at the end of the content
  export function focusEnd(): boolean {
    if (inputLocked) return false;
    if (editor && editor.view) {
      try {
        editor.chain().focus('end').run();
        return true;
      } catch (e) {
        logger.debug('[TipTapEditor] Editor not ready for focusEnd:', e);
      }
    }
    return false;
  }

  // Focus and select all content
  export function focusAndSelectAll(): boolean {
    if (inputLocked) return false;
    if (editor && editor.view) {
      try {
        editor.chain().focus().selectAll().run();
        return true;
      } catch (e) {
        logger.debug('[TipTapEditor] Editor not ready for focusAndSelectAll:', e);
      }
    }
    return false;
  }

  // Export HTML getter and clear method for parent components
  export function getHTML() {
    try {
      return editor?.getHTML?.() ?? '';
    } catch (error) {
      logger.error('[TipTapEditor] Error getting HTML:', error);
      // Return the text content as fallback if HTML serialization fails
      return editor?.getText?.() ?? '';
    }
  }
  export function clear() {
    if (editor) {
      isClearing = true;
      editor.commands.clearContent(true);
      isClearing = false;
    }
  }

  /**
   * Set the editor content programmatically without changing DOM focus.
   * Callers that represent an explicit user focus action must call focus()
   * separately after updating the content.
   * @param text - The text content to set
   */
  export async function setContent(text: string) {
    if (!editor) return;
    const html = editorHTML(text || '');
    editor
      .chain()
      .command(({ tr }) => {
        tr.setMeta('external-update', true);
        return true;
      })
      .setContent(html)
      .run();
  }

  /**
   * Insert an image inline at the current cursor position
   * @param dataUrl - Base64 data URL of the image
   * @param alt - Optional alt text for the image
   */
  export function insertImage(dataUrl: string, alt?: string) {
    if (editor && editor.view) {
      editor
        .chain()
        .focus()
        .setImage({ src: dataUrl, alt: alt || '' })
        .createParagraphNear()
        .focus()
        .run();
    }
  }

  /**
   * Extract all inline images from the editor content
   * Returns array of images with their data URLs and optional alt text
   */
  export function getInlineImages(): InlineImage[] {
    if (!editor) {
      logger.warn('TipTapEditor: getInlineImages called but editor is not initialized');
      return [];
    }

    const images: InlineImage[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'image') {
        const src = node.attrs.src;
        // Only include data URLs (inline images), not external URLs
        if (src && src.startsWith('data:')) {
          images.push({
            src,
            alt: node.attrs.alt || undefined,
          });
        }
      }
      return true; // Continue traversing
    });

    logger.debug('TipTapEditor: Extracted inline images', {
      imageCount: images.length,
      imageSources: images.map((img) => ({
        alt: img.alt,
        srcLength: img.src?.length || 0,
      })),
    });

    return images;
  }

  /**
   * Get text content without images (for the message text)
   * Images are extracted separately via getInlineImages()
   */
  export function getTextContent(): string {
    return serializeEditorText(editor);
  }

  /**
   * Insert a context mention (Linear issue, GitHub issue, etc.) at the current cursor position
   * @param attrs - The context mention attributes
   */
  export function insertContextMention(attrs: ContextMentionAttributes): boolean {
    logger.debug('TipTapEditor: insertContextMention called', {
      hasEditor: !!editor,
      hasEditorView: !!editor?.view,
      attrs: { itemType: attrs.itemType, identifier: attrs.identifier, title: attrs.title },
    });
    if (editor && editor.view) {
      const result = editor.chain().focus().insertContextMention(attrs).run();
      logger.debug('TipTapEditor: insertContextMention result', { result });
      return result;
    }
    logger.warn('TipTapEditor: insertContextMention failed - no editor');
    return false;
  }

  /**
   * Insert a mention (file, note, folder, etc.) at the current cursor position
   * @param attrs - The mention attributes (id, label, type, uri, meta)
   */
  export function insertMention(attrs: {
    id: string;
    label: string;
    type: string;
    uri: string;
    meta?: Record<string, unknown>;
  }): boolean {
    if (!editor || !editor.view) {
      logger.warn('TipTapEditor: insertMention called but editor is not initialized');
      return false;
    }

    try {
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'mention',
          attrs: {
            id: attrs.id,
            label: attrs.label,
            type: attrs.type,
            uri: attrs.uri,
            meta: attrs.meta || {},
          },
        })
        .insertContent(' ') // Add a space after the mention
        .run();
      return true;
    } catch (e) {
      logger.error('TipTapEditor: insertMention failed', e);
      return false;
    }
  }

  /** Represents a file/folder/note mention in the editor content */
  export interface MentionData {
    id: string;
    label: string;
    type: string; // 'file', 'folder', 'note', etc.
    uri: string;
    meta?: Record<string, unknown>;
  }

  /**
   * Extract all regular mentions from the editor content
   * Returns array of mention data for files, folders, notes, etc.
   */
  export function getMentions(): MentionData[] {
    if (!editor) {
      logger.warn('TipTapEditor: getMentions called but editor is not initialized');
      return [];
    }

    const mentions: MentionData[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'mention') {
        mentions.push({
          id: node.attrs.id,
          label: node.attrs.label,
          type: node.attrs.type || 'file',
          uri: node.attrs.uri || '',
          meta: node.attrs.meta || {},
        });
      }
      return true; // Continue traversing
    });

    logger.debug('TipTapEditor: Extracted mentions', {
      mentionCount: mentions.length,
      types: mentions.map((m) => m.type),
    });

    return mentions;
  }

  /**
   * Extract all context mentions from the editor content
   * Returns array of context mention attributes for Linear issues, GitHub issues, etc.
   */
  export function getContextMentions(): ContextMentionAttributes[] {
    if (!editor) {
      logger.warn('TipTapEditor: getContextMentions called but editor is not initialized');
      return [];
    }

    const mentions: ContextMentionAttributes[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'contextMention') {
        const attrs = node.attrs as ContextMentionAttributes;
        mentions.push({
          itemType: attrs.itemType,
          provider: attrs.provider,
          title: attrs.title,
          url: attrs.url,
          identifier: attrs.identifier,
          contextId: attrs.contextId,
          description: attrs.description,
          metadata: attrs.metadata,
        });
      }
      return true; // Continue traversing
    });

    logger.debug('TipTapEditor: Extracted context mentions', {
      mentionCount: mentions.length,
    });

    return mentions;
  }

  // Create mention suggestion configuration
  const mentionSuggestion = {
    char: '@',
    pluginKey: new PluginKey('mention'),
    items: async ({ query }: { query: string }) => {
      logger.debug('Mention query:', query);
      onMentionStart?.(query);

      // If no workspace but we have a repoPath, use async search with the repo context
      if (!workspace && repoPath) {
        logger.debug('No workspace but repoPath available, using async search:', repoPath);
        const context: SearchContext = {
          workspaceId: undefined,
          repoPath: repoPath,
          currentFile: undefined,
          currentNote: undefined,
          recentFiles: [],
        };
        try {
          const results = await mentionSystem.search(query, context);
          logger.debug('Mention search results from repoPath:', results.length);
          return results;
        } catch (error) {
          logger.error('Failed to search mentions with repoPath:', error);
          // Fall back to sync search with defaults
          const syncResults = mentionSystem.searchSync(query, context);
          logger.debug('Fallback sync search results:', syncResults.length);
          return syncResults;
        }
      }

      // If no workspace and no repoPath, return empty (no random defaults)
      if (!workspace) {
        logger.debug('No workspace and no repoPath - returning empty results');
        return [];
      }

      // Use the enhanced mention system for search with workspace context
      const context: SearchContext = {
        workspaceId: workspace.id,
        currentFile: undefined, // Could be set if we're editing a file
        currentNote: undefined, // Could be set if we're in a note
        recentFiles: [], // Could track recent files
      };

      try {
        const results = await mentionSystem.search(query, context);
        logger.debug('Mention search results:', results.length);
        return results;
      } catch (error) {
        logger.error('Failed to search mentions:', error);
        return [];
      }
    },

    render: () => {
      // Use the new renderer that handles updates more efficiently
      return createMentionSuggestionRenderer();
    },

    command: ({ editor, range, props }: any) => {
      // Insert the enhanced mention with all metadata
      const mentionAttrs = {
        id: props.id,
        label: props.label,
        type: props.type,
        uri: props.uri,
        meta: props.meta || {},
      };

      // Check if editor view is available before focusing
      if (editor.view) {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent({
            type: 'mention',
            attrs: mentionAttrs,
          })
          .run();
      }

      onMentionSelect?.(props);
    },
  };

  onMount(() => {
    let cancelled = false;
    (async () => {
      // Rehydrate any @-tokens (or bare filenames) into mention spans before creating the editor
      const initialHTML = editorHTML(value || '');
      if (cancelled) return;
      const editorElement = element;
      if (!editorElement) return;

      editor = new Editor({
        element: editorElement,
        extensions: [
          StarterKit.configure({
            heading: false,
            codeBlock: false,
            horizontalRule: false,
            // Disable link autodetection - StarterKit v3 includes Link with autolink
            // enabled by default, which incorrectly detects bare filenames like
            // "healthcheck.rs" or "claim.rs" as URLs (since .rs is a valid TLD)
            link: false,
            // Disable list formatting to make it more plaintext-like
            bulletList: false,
            orderedList: false,
            listItem: false,
            // Disable markdown formatting so special characters appear literally
            // The input should be raw text, not rendered markdown
            code: false, // backticks ` remain literal
            bold: false, // asterisks ** remain literal
            italic: false, // asterisks * and underscores _ remain literal
            strike: false, // tildes ~~ remain literal
            blockquote: false, // > remains literal
            // Disable the drop cursor - dropped files become attachments (via
            // SimpleRichInput's container-level drop handler), not inline
            // content, so the horizontal insertion line is misleading
            dropcursor: false,
          }),
          // Re-add Link extension with custom autolink filtering.
          // StarterKit v3's default Link autolinks aggressively — bare words like
          // "healthcheck.rs" get detected as URLs (.rs is Serbia's TLD) and the
          // link mark can propagate across spaces to swallow entire paragraphs.
          // shouldAutoLink ensures only URLs with an explicit protocol are autolinked.
          createIntentLink({
            openOnClick: false,
            linkOnPaste: true,
            shouldAutoLink: (url: string) => {
              // Only autolink URLs that have an explicit protocol
              // This prevents bare TLD matches like "healthcheck.rs" or "claim.rs"
              return /^https?:\/\//.test(url) || url.startsWith('intent://');
            },
            HTMLAttributes: {
              class: 'text-primary underline',
            },
          }),
          Placeholder.configure({
            placeholder,
            emptyEditorClass: 'is-editor-empty text-subtle',
            // `inputLocked` turns editability off; the placeholder must survive
            // it, otherwise a gated draft restore blanks the composer.
            showOnlyWhenEditable: false,
          }),
          Image.configure({
            inline: false,
            allowBase64: true,
            HTMLAttributes: {
              class: 'chat-inline-image',
            },
          }),
          NoteVideo.configure({ workspaceId: workspace?.id }),
          MentionFromSpan.configure({
            HTMLAttributes: {
              class: 'mention-chip',
            },
            suggestion: mentionSuggestion,
            renderHTML({ node }: any) {
              // Ensure we always have a non-empty label for the mention
              const label = node.attrs.label || node.attrs.id || 'mention';
              return [
                'span',
                {
                  'data-mention': 'true',
                  'data-type': node.attrs.type || 'file',
                  'data-uri': node.attrs.uri || '',
                  'data-meta': JSON.stringify(node.attrs.meta || {}),
                  'data-id': node.attrs.id,
                  'data-label': node.attrs.label,
                  class: 'mention-chip',
                  tabindex: '0',
                },
                label, // Display without @ prefix for cleaner appearance
              ];
            },
            // Ensure mentions serialize to canonical @-tokens when extracting text
            renderText: ({ node }) => {
              const data = node.attrs || {};
              try {
                return toPromptToken({
                  type: data.type,
                  id: data.id,
                  label: data.label,
                  meta: data.meta,
                });
              } catch {
                // Fallback to @label if formatter not available
                return `@${data?.meta?.fullPath || data?.meta?.path || data?.label || data?.id || 'item'}`;
              }
            },
          }),
          // Context mentions for Linear issues, GitHub issues, Sentry issues, etc.
          // Extended with renderText to serialize mentions into the text content
          ContextMention.extend({
            renderText: ({ node }) => {
              const attrs = node.attrs || {};
              // Serialize all attributes as JSON, then base64 encode to avoid regex issues
              // with special characters like }] in descriptions
              const json = JSON.stringify({
                provider: attrs.provider || 'browser',
                identifier: attrs.identifier || '',
                title: attrs.title || '',
                url: attrs.url || '',
                description: attrs.description || '',
                metadata: attrs.metadata || '',
                itemType: attrs.itemType || '',
              });
              const encoded = btoa(unescape(encodeURIComponent(json)));
              // Format: @context[base64data]
              // This allows us to parse it back out and restore the full pill appearance
              return `@context[${encoded}]`;
            },
          }),
          // Paste chip for multi-line pasted text (5+ lines)
          PasteChip,
          SkillCommand,
          TrailingHintExtension,
        ],
        content: initialHTML,
        editable: isEditable,
        // Disable the buggy 'delete' core extension that emits delete events.
        // It has a bug where it calls nodeAt(newStart - 1) without checking if newStart is 0,
        // causing "Position -1 outside of fragment" errors.
        enableCoreExtensions: {
          delete: false,
        },
        onCreate: ({ editor }) => {
          refreshSlashContext(editor);
          if (autoFocus) {
            // Defer the focus out of the mount flush: a synchronous focus()
            // here forces style/layout mid-flush. rAF still runs pre-paint,
            // so focus lands in the same frame without a forced reflow.
            requestAnimationFrame(() => {
              if (editor.isDestroyed) return;
              // Focus the DOM element directly with preventScroll to avoid scroll jank
              const editorElement = editor.view.dom as HTMLElement;
              editorElement?.focus({ preventScroll: true });
            });
          }
        },
        onUpdate: ({ editor, transaction }) => {
          // Don't call onUpdate if this is an external update (from $effect) or if we're clearing
          if (transaction.getMeta('external-update') || isClearing) {
            return;
          }
          const text = serializeEditorText(editor);
          // A paste must not pop the slash menu even when it leaves the cursor
          // in a "/"-leading token; typing afterwards changes the context key
          // and re-enables it.
          refreshSlashContext(editor, {
            dismissNewContext: transaction.getMeta('uiEvent') === 'paste',
          });
          onUpdate?.(text);
        },
        onSelectionUpdate: ({ editor, transaction }) => {
          refreshSlashContext(editor, {
            dismissNewContext: transaction.getMeta('uiEvent') === 'paste',
          });
          // Get the selected text from the editor
          const { from, to, empty } = editor.state.selection;
          if (empty) {
            onSelectionChange?.(null);
          } else {
            const selectedText = editor.state.doc.textBetween(from, to, ' ');
            onSelectionChange?.(selectedText.trim() || null);
          }
        },
        // TipTap emits focus/blur synchronously from native DOM events, which
        // can fire mid-flush inside a Svelte reaction (e.g. an ancestor
        // flipping `inert` in a template expression blurs the focused editor).
        // untrack() the $state writes so the state_unsafe_mutation guard does
        // not reject that reentry.
        onFocus: ({ editor }) => {
          untrack(() => {
            editorFocused = true;
            refreshSlashContext(editor);
          });
        },
        onBlur: () => {
          untrack(() => {
            editorFocused = false;
          });
        },
        editorProps: {
          attributes: {
            class: `tiptap-editor ${editorClassName}`,
            autocomplete: 'off',
            spellcheck: 'false',
            autocorrect: 'off',
            autocapitalize: 'off',
          },
          handlePaste: (view, event) => {
            // Block ProseMirror's default handling for file-bearing pastes
            // (mirrors handleDrop below): a clipboard pairing the file with
            // text/html (browser "Copy image") would otherwise insert an
            // inline image node synchronously. Returning true (without
            // stopPropagation) lets the event bubble to the container-level
            // paste handler, which attaches the files as context items.
            if (isFilePasteEvent(event)) {
              return true;
            }
            const text = event.clipboardData?.getData('text/plain');
            if (text) {
              const lines = text.split('\n');
              if (lines.length >= 5) {
                // Insert a paste chip node instead of raw text
                const { state, dispatch } = view;
                const node = state.schema.nodes.pasteChip.create({
                  content: text,
                  lineCount: lines.length,
                });
                // Mirror ProseMirror's own paste meta so slash detection can
                // tell this transaction came from a paste.
                const tr = state.tr.replaceSelectionWith(node).setMeta('uiEvent', 'paste');
                dispatch(tr);
                return true;
              }
              if (/\r|\n/.test(text)) {
                // Multi-line paste below the chip threshold: insert following the
                // WYSIWYG convention (every \n → one hardBreak, no paragraph
                // splitting) instead of ProseMirror's default one-<p>-per-line,
                // which would serialize each single break as \n\n (#1151)
                const { state, dispatch } = view;
                const paragraphs = pastedTextToParagraphNodes(state.schema, text);
                if (paragraphs.length > 0) {
                  const slice = new Slice(Fragment.from(paragraphs), 1, 1);
                  dispatch(
                    state.tr.replaceSelection(slice).scrollIntoView().setMeta('uiEvent', 'paste'),
                  );
                  return true;
                }
              }
            }
            return false;
          },
          handleDrop: (_view, event) => {
            // Block ProseMirror's default handling for file drops so dropped
            // images are never inserted inline. Returning true (without
            // stopPropagation) lets the event bubble to SimpleRichInput's
            // container-level drop handler, which attaches the files as
            // context items. Text/content drags still use the default path.
            return isFileDragEvent(event);
          },
          handleKeyDown: (view, event) => {
            if (handleSlashMenuKeyDown(event)) {
              return true;
            }

            // Handle Escape for cancel (in edit mode)
            if (event.key === 'Escape' && onEscape) {
              event.preventDefault();
              onEscape();
              return true;
            }

            const isMac =
              typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
            const matches = (id: ShortcutId) =>
              matchesShortcut(event, getEffectiveShortcut(id), isMac);
            if (
              matches('chat.mention-context') &&
              getEffectiveShortcut('chat.mention-context') !== '@'
            ) {
              event.preventDefault();
              editor?.chain().focus().insertContent('@').run();
              return true;
            }

            // Emacs-style shortcuts (Ctrl+key on macOS)
            // Only intercept if Ctrl is pressed without Meta (Cmd), and only on macOS.
            // On Windows/Linux, Ctrl+A/E/K/... should fall through to native behavior
            // (e.g. Ctrl+A selects all).
            if (isMac && event.ctrlKey && !event.metaKey) {
              // Ctrl+A: Move to beginning of current line
              if (event.key === 'a') {
                event.preventDefault();
                const { state, dispatch } = view;
                const head = state.selection.$head;
                // Find the start of the current line (after any block start)
                const lineStart = head.start();
                dispatch(state.tr.setSelection(TextSelection.create(state.doc, lineStart)));
                return true;
              }

              // Ctrl+E: Move to end of current line
              if (event.key === 'e') {
                event.preventDefault();
                const { state, dispatch } = view;
                const head = state.selection.$head;
                // Find the end of the current line (before any block end)
                const lineEnd = head.end();
                dispatch(state.tr.setSelection(TextSelection.create(state.doc, lineEnd)));
                return true;
              }

              // Ctrl+K: Kill (delete) from cursor to end of line
              if (event.key === 'k') {
                event.preventDefault();
                const { state, dispatch } = view;
                const head = state.selection.$head;
                const from = head.pos;
                const to = head.end();
                if (from < to) {
                  dispatch(state.tr.delete(from, to));
                }
                return true;
              }

              // Ctrl+P: Move cursor up (like ArrowUp)
              if (event.key === 'p') {
                event.preventDefault();
                // Use browser's native selection to move cursor up
                const selection = window.getSelection();
                if (selection && selection.rangeCount > 0) {
                  // Move selection up by modifying the range
                  (selection as any).modify('move', 'backward', 'line');
                }
                return true;
              }

              // Ctrl+N: Move cursor down (like ArrowDown)
              if (event.key === 'n') {
                event.preventDefault();
                // Use browser's native selection to move cursor down
                const selection = window.getSelection();
                if (selection && selection.rangeCount > 0) {
                  // Move selection down by modifying the range
                  (selection as any).modify('move', 'forward', 'line');
                }
                return true;
              }

              // Ctrl+F: Move cursor forward one character (like ArrowRight)
              if (event.key === 'f') {
                event.preventDefault();
                const selection = window.getSelection();
                if (selection && selection.rangeCount > 0) {
                  (selection as any).modify('move', 'forward', 'character');
                }
                return true;
              }

              // Ctrl+B: Move cursor backward one character (like ArrowLeft)
              if (event.key === 'b') {
                event.preventDefault();
                const selection = window.getSelection();
                if (selection && selection.rangeCount > 0) {
                  (selection as any).modify('move', 'backward', 'character');
                }
                return true;
              }
            }

            // Handle Cmd+Arrow for cursor navigation (macOS standard shortcuts)
            // Cmd+Left/Right: move to beginning/end of line
            // Cmd+Up/Down: move to beginning/end of document
            if (event.metaKey && !event.ctrlKey && !event.altKey) {
              if (event.key === 'ArrowLeft') {
                event.preventDefault();
                const selection = window.getSelection();
                if (selection && selection.rangeCount > 0) {
                  // Move to beginning of line, with or without extending selection
                  (selection as any).modify(
                    event.shiftKey ? 'extend' : 'move',
                    'backward',
                    'lineboundary',
                  );
                }
                return true;
              }
              if (event.key === 'ArrowRight') {
                event.preventDefault();
                const selection = window.getSelection();
                if (selection && selection.rangeCount > 0) {
                  // Move to end of line, with or without extending selection
                  (selection as any).modify(
                    event.shiftKey ? 'extend' : 'move',
                    'forward',
                    'lineboundary',
                  );
                }
                return true;
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                // Move to beginning of document using ProseMirror's selection API
                const { state, dispatch } = view;
                const docStart = 1; // Position 1 is the start of content (after doc node)
                if (event.shiftKey) {
                  // Extend selection to start
                  const { from } = state.selection;
                  dispatch(state.tr.setSelection(TextSelection.create(state.doc, docStart, from)));
                } else {
                  // Move cursor to start
                  dispatch(state.tr.setSelection(TextSelection.create(state.doc, docStart)));
                }
                return true;
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                // Move to end of document using ProseMirror's selection API
                const { state, dispatch } = view;
                const docEnd = state.doc.content.size - 1; // Position before closing doc node
                if (event.shiftKey) {
                  // Extend selection to end
                  const { to } = state.selection;
                  dispatch(state.tr.setSelection(TextSelection.create(state.doc, to, docEnd)));
                } else {
                  // Move cursor to end
                  dispatch(state.tr.setSelection(TextSelection.create(state.doc, docEnd)));
                }
                return true;
              }
            }

            // Handle ⌘Enter / Ctrl+Enter for force submit (interrupt + send)
            if (matches('chat.force-send')) {
              event.preventDefault();
              onForceSubmit?.();
              return true;
            }

            // Handle Shift+Enter for new line (plaintext mode - no list continuation)
            if (matches('chat.new-line')) {
              // Insert a hard break and scroll to keep cursor visible
              event.preventDefault();
              editor?.chain().setHardBreak().scrollIntoView().run();
              return true;
            }

            // Handle Up Arrow for history navigation (like terminal)
            // Only trigger when cursor is at the very beginning of the content
            if (
              event.key === 'ArrowUp' &&
              onHistoryPrev &&
              !event.shiftKey &&
              !event.metaKey &&
              !event.ctrlKey
            ) {
              // If the mention dropdown is active, let it handle arrow keys
              const mentionStateUp = mentionSuggestion.pluginKey.getState(view.state);
              if (mentionStateUp?.active) {
                return false;
              }

              const { state } = view;
              const { from } = state.selection;
              // Check if cursor is at the start (position 1 is start of first paragraph content)
              const isAtStart = from <= 1;
              // Also allow if the entire document is empty
              const isEmpty = state.doc.textContent.length === 0;

              if (isAtStart || isEmpty) {
                const prevValue = onHistoryPrev();
                if (prevValue !== null) {
                  event.preventDefault();
                  // Set the content and move cursor to end
                  editor?.chain().setContent(editorHTML(prevValue)).focus('end').run();
                  // Notify parent of the change
                  onUpdate?.(prevValue);
                  return true;
                }
              }
            }

            // Handle Down Arrow for history navigation (like terminal)
            // Only trigger when cursor is at the very end of the content
            if (
              event.key === 'ArrowDown' &&
              onHistoryNext &&
              !event.shiftKey &&
              !event.metaKey &&
              !event.ctrlKey
            ) {
              // If the mention dropdown is active, let it handle arrow keys
              const mentionStateDown = mentionSuggestion.pluginKey.getState(view.state);
              if (mentionStateDown?.active) {
                return false;
              }

              const { state } = view;
              const { to } = state.selection;
              const docEnd = state.doc.content.size - 1;
              // Check if cursor is at the end
              const isAtEnd = to >= docEnd;
              // Also allow if the entire document is empty
              const isEmpty = state.doc.textContent.length === 0;

              if (isAtEnd || isEmpty) {
                const nextValue = onHistoryNext();
                if (nextValue !== null) {
                  event.preventDefault();
                  // Set the content and move cursor to end
                  editor?.chain().setContent(editorHTML(nextValue)).focus('end').run();
                  // Notify parent of the change
                  onUpdate?.(nextValue);
                  return true;
                }
              }
            }

            // Handle Enter key for submit (queues if streaming)
            if (matches('chat.send')) {
              // Check if the mention suggestion is active
              // The mention plugin uses a PluginKey to track its state
              const mentionState = mentionSuggestion.pluginKey.getState(view.state);

              // If mention dropdown is active, let it handle the Enter key
              if (mentionState?.active) {
                return false; // Let the mention plugin handle it
              }

              // If onSubmit is provided, submit; otherwise let Enter create a newline
              if (onSubmit) {
                event.preventDefault();
                onSubmit();
                return true;
              }
              return false;
            }
            return false;
          },
        },
      });

      // Add hover and click listeners for mentions
      editorElement.addEventListener('mouseover', handleMentionHover);
      editorElement.addEventListener('mouseout', handleMentionMouseOut);
      editorElement.addEventListener('click', handleMentionClick);

      // Add keydown handler directly to the ProseMirror editor element (not the container)
      // This is the actual contenteditable element that receives keyboard events
      const editorDom = editor.view.dom as HTMLElement;
      editorDom.addEventListener('keydown', handleCmdArrowNavigation);
    })();
    return () => {
      cancelled = true;
    };
  });

  function handleMentionHover(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (target.hasAttribute('data-mention')) {
      const position = target.getBoundingClientRect();
      const meta = JSON.parse(target.getAttribute('data-meta') || '{}');

      // Show hover preview
      if (!hoverPreviewContainer) {
        hoverPreviewContainer = document.createElement('div');
        document.body.appendChild(hoverPreviewContainer);

        const type = (target.getAttribute('data-type') as any) || 'file';
        const label = target.getAttribute('data-label') || target.textContent || '';

        // Choose appropriate icon based on type
        const iconMap: Record<string, string> = {
          file: '📄',
          folder: '📁',
          note: '📝',
          rule: '⚙️',
          personality: '🎭',
          command: '⌘',
          terminal: '💻',
        };

        hoverPreview = mount(MentionHoverPreview, {
          target: hoverPreviewContainer,
          props: {
            mention: {
              id: target.getAttribute('data-id') || '',
              type,
              label,
              uri: target.getAttribute('data-uri') || '',
              meta,
              icon: iconMap[type] || '📄',
            },
            position: {
              x: position.left,
              y: position.bottom + 5,
            },
            onClose: () => {
              if (hoverPreview && hoverPreviewContainer) {
                unmount(hoverPreview);
                hoverPreviewContainer.remove();
                hoverPreview = null;
                hoverPreviewContainer = null;
              }
            },
          },
        });

        // Add mouseout listener to preview container for immediate dismiss
        hoverPreviewContainer.addEventListener('mouseout', handlePreviewMouseOut);
      }
    }
  }

  function handleMentionMouseOut(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const relatedTarget = event.relatedTarget as HTMLElement;

    // Don't hide if moving to the preview itself
    if (relatedTarget?.closest('.mention-hover-preview')) {
      return;
    }

    if (target.hasAttribute('data-mention')) {
      // Hide hover preview immediately
      if (hoverPreview && hoverPreviewContainer) {
        unmount(hoverPreview);
        hoverPreviewContainer.remove();
        hoverPreview = null;
        hoverPreviewContainer = null;
      }
    }
  }

  function handlePreviewMouseOut(event: MouseEvent) {
    const relatedTarget = event.relatedTarget as HTMLElement;

    // Don't hide if moving back to the mention pill
    if (relatedTarget?.closest('[data-mention]')) {
      return;
    }

    // Hide preview immediately when mouse leaves
    if (hoverPreview && hoverPreviewContainer) {
      unmount(hoverPreview);
      hoverPreviewContainer.remove();
      hoverPreview = null;
      hoverPreviewContainer = null;
    }
  }

  /**
   * Handle click on mention chips to navigate to the referenced resource
   * Supports intent:// URLs and note references
   */
  async function handleMentionClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.hasAttribute('data-mention')) return;

    const type = target.getAttribute('data-type');
    const id = target.getAttribute('data-id');
    const uri = target.getAttribute('data-uri');
    const meta = JSON.parse(target.getAttribute('data-meta') || '{}');

    // Handle intent:// URLs (stored in uri or meta.fullUrl)
    // Check both uri and meta.fullUrl for the intent URL
    const intentUrl = uri?.startsWith('intent://')
      ? uri
      : meta.fullUrl?.startsWith('intent://')
        ? meta.fullUrl
        : null;
    if (intentUrl) {
      event.preventDefault();
      event.stopPropagation();
      const { handleIntentLink } = await import('$lib/utils/workspaces-link-handler');
      await handleIntentLink(intentUrl);
      return;
    }

    // Handle external note references (notes in other workspaces) via meta.workspaceId
    // This covers the case where a note mention has a workspaceId in meta, indicating
    // it's a cross-workspace reference that should use intent navigation
    if (type === 'note' && id && meta.workspaceId && meta.isExternalLink) {
      event.preventDefault();
      event.stopPropagation();
      // Build intent URL from meta using shared constants
      const builtIntentUrl = noteUrl(id, meta.workspaceId);
      const { handleIntentLink } = await import('$lib/utils/workspaces-link-handler');
      await handleIntentLink(builtIntentUrl);
      return;
    }

    // Handle note references within the current workspace
    if (type === 'note' && id) {
      event.preventDefault();
      event.stopPropagation();
      const { navigateToNote } = await import('$lib/utils/workspace-navigation');
      await navigateToNote(id);
      return;
    }

    // Handle file references - open file in main content area
    if (type === 'file' && (meta.fullPath || meta.path)) {
      event.preventDefault();
      event.stopPropagation();
      const { navigateToFile } = await import('$lib/utils/workspace-navigation');
      // Use fullPath (absolute) if available, otherwise use path (relative)
      const filePath = meta.fullPath || meta.path;
      await navigateToFile(filePath);
      return;
    }
  }

  /**
   * Handle Cmd+Arrow navigation in capture phase
   * This ensures standard macOS cursor navigation works even when global handlers
   * are registered on window. We stop propagation to prevent those handlers
   * from interfering.
   */
  function handleCmdArrowNavigation(event: KeyboardEvent) {
    // Only handle Cmd+Arrow (no Ctrl, no Alt)
    if (!event.metaKey || event.ctrlKey || event.altKey) return;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    if (!editor) return;

    const { state, dispatch } = editor.view;

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      event.stopPropagation();
      // Move to beginning of line
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        (selection as any).modify(event.shiftKey ? 'extend' : 'move', 'backward', 'lineboundary');
      }
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation();
      // Move to end of line
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        (selection as any).modify(event.shiftKey ? 'extend' : 'move', 'forward', 'lineboundary');
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      // Move to beginning of document and scroll into view
      const docStart = 1;
      if (event.shiftKey) {
        const { from } = state.selection;
        dispatch(
          state.tr.setSelection(TextSelection.create(state.doc, docStart, from)).scrollIntoView(),
        );
      } else {
        dispatch(state.tr.setSelection(TextSelection.create(state.doc, docStart)).scrollIntoView());
      }
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      // Move to end of document and scroll into view
      const docEnd = state.doc.content.size - 1;
      if (event.shiftKey) {
        const { to } = state.selection;
        dispatch(
          state.tr.setSelection(TextSelection.create(state.doc, to, docEnd)).scrollIntoView(),
        );
      } else {
        dispatch(state.tr.setSelection(TextSelection.create(state.doc, docEnd)).scrollIntoView());
      }
    }
  }

  onDestroy(() => {
    // Clean up keydown handler from editor DOM before destroying
    if (editor) {
      const editorDom = editor.view.dom as HTMLElement;
      editorDom.removeEventListener('keydown', handleCmdArrowNavigation);
      editor.destroy();
    }

    // Clean up event listeners
    if (element) {
      element.removeEventListener('mouseover', handleMentionHover);
      element.removeEventListener('mouseout', handleMentionMouseOut);
      element.removeEventListener('click', handleMentionClick);
    }

    // Clean up hover preview and its listeners
    if (hoverPreviewContainer) {
      hoverPreviewContainer.removeEventListener('mouseout', handlePreviewMouseOut);
    }
    if (hoverPreview && hoverPreviewContainer) {
      unmount(hoverPreview);
      hoverPreviewContainer.remove();
    }
  });

  // PERF: Track pending async update to prevent race conditions
  let valueUpdateRequestId = 0;

  // Update editor when value changes externally (preserve caret when focused)
  $effect(() => {
    if (!editor) return;

    const currentText = serializeEditorText(editor);
    if (value === currentText) {
      return;
    }

    // Local editor transactions are authoritative while the user is typing.
    // Under main-thread pressure, an older controlled-value echo can arrive
    // after a newer transaction and must not replace it. Intentional focused
    // updates use the exported setContent/clear/history commands instead.
    if (editor.view.hasFocus()) {
      valueUpdateRequestId += 1;
      return;
    }

    const hadFocus = editor.view.hasFocus();
    const { from } = editor.state.selection;

    // PERF: Track this request to handle race conditions
    const requestId = ++valueUpdateRequestId;

    (async () => {
      const html = editorHTML(value || '');

      // PERF: Check if this is still the latest request and editor still exists
      // This prevents race conditions when value changes rapidly
      if (!editor || requestId !== valueUpdateRequestId) {
        return;
      }

      editor
        .chain()
        .command(({ tr }) => {
          tr.setMeta('external-update', true);
          return true;
        })
        .setContent(html)
        .command(({ tr, state }) => {
          if (hadFocus) {
            try {
              const maxPos = state.doc.content.size;
              const newPos = Math.min(from, maxPos);
              tr.setSelection(TextSelection.create(state.doc, newPos, newPos));
            } catch {
              // ignore restore errors
            }
          }
          return true;
        })
        .run();
    })();
  });

  // Update editable state
  $effect(() => {
    if (editor) {
      editor.setEditable(isEditable);
    }
  });

  $effect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dispatch(editor.state.tr.setMeta(trailingHintPluginKey, trailingHint));
  });

  $effect(() => {
    const editorElement = editor?.view.dom;
    if (!editorElement) return;

    editorElement.setAttribute('aria-haspopup', 'listbox');
    editorElement.setAttribute('aria-expanded', String(slashMenuOpen));
    if (slashMenuOpen && slashActiveOptionId) {
      editorElement.setAttribute('aria-controls', slashListboxId);
      editorElement.setAttribute('aria-activedescendant', slashActiveOptionId);
    } else {
      editorElement.removeAttribute('aria-controls');
      editorElement.removeAttribute('aria-activedescendant');
    }
  });
</script>

<div class="tiptap-root">
  <Popover.Root bind:open={() => slashMenuOpen, (open) => !open && dismissSlashMenu()}>
    <Popover.Portal>
      <Popover.Content
        customAnchor={element ?? null}
        side="top"
        align="start"
        sideOffset={4}
        trapFocus={false}
        onOpenAutoFocus={preserveEditorFocus}
        onCloseAutoFocus={preserveEditorFocus}
        class="z-(--layer-popover) w-72 max-w-full outline-none"
        data-testid="slash-skill-menu"
      >
        <SlashSkillSuggestionList
          bind:this={slashSuggestionList}
          listboxId={slashListboxId}
          items={filteredSkills}
          loading={skillsLoading}
          error={skillsError}
          onSelect={selectSlashSkill}
          onDismiss={dismissSlashMenu}
          onActiveOptionChange={(optionId) => (slashActiveOptionId = optionId)}
        />
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
  <div
    bind:this={element}
    class="tiptap-container {className}"
    class:placeholder-suppressed={placeholderSuppressed}
    style={`--tt-min-height:${minHeight}px;--tt-max-height:${maxHeight}px`}
  ></div>
</div>

<style>
  .tiptap-root {
    position: relative;
    width: 100%;
  }

  .tiptap-container {
    width: 100%;
    min-height: var(--tt-min-height, 80px);
    max-height: var(--tt-max-height, 300px);
    overflow-y: auto;
    overflow-x: hidden;
  }

  /* Scope styles to chat input editor only - don't use :global(.tiptap-editor)
     as that affects all tiptap editors including notes which have their own font-size */
  .tiptap-container :global(.tiptap-editor) {
    min-height: var(--tt-min-height, 80px);
    height: 100%;
    padding: 0.5rem 1rem 1rem;
    outline: none;
    font-family: var(--font-ui);
    font-size: var(--text-body-size);
    line-height: var(--text-body-line-height);
    font-weight: var(--text-body-weight);
    letter-spacing: var(--text-body-tracking);
    overflow-wrap: break-word;
    word-wrap: break-word;
    word-break: break-word;
  }

  .tiptap-container :global(.tiptap-editor p) {
    margin: 0;
    overflow-wrap: break-word;
    word-wrap: break-word;
  }

  .tiptap-container :global(.tiptap-editor p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    color: var(--color-muted-foreground);
    opacity: 0.7;
    pointer-events: none;
    opacity: 0.85;
    float: left;
    height: 0;
  }

  .tiptap-container :global(.prompt-trailing-hint) {
    display: inline-flex;
    position: relative;
    z-index: 2;
    align-items: baseline;
    gap: 0.25rem;
    margin-inline-start: 0.5rem;
    border: 0;
    background: transparent;
    padding: 0;
    color: var(--color-muted-foreground);
    font: inherit;
    opacity: 0.4;
    user-select: none;
    -webkit-user-select: none;
    white-space: nowrap;
    vertical-align: baseline;
    transition: opacity var(--motion-fast);
  }

  .tiptap-container :global(.prompt-trailing-hint[data-state='ready']) {
    cursor: pointer;
  }

  .tiptap-container :global(.prompt-trailing-hint:hover) {
    opacity: 0.7;
  }

  .tiptap-container :global(.prompt-trailing-hint kbd) {
    font: inherit;
    opacity: 0.75;
  }

  .tiptap-container :global(.prompt-trailing-hint-action) {
    display: inline-flex;
    width: 1em;
    height: 1em;
    cursor: pointer;
    align-items: center;
    justify-content: center;
    border: 0;
    background: transparent;
    padding: 0;
    color: inherit;
  }

  .tiptap-container :global(.prompt-trailing-hint-action svg) {
    width: 0.75em;
    height: 0.75em;
    fill: currentColor;
  }

  :global(.prompt-trailing-hint-tooltip) {
    position: fixed;
    z-index: var(--layer-tooltip);
    max-width: 20rem;
    pointer-events: none;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-medium);
    padding: var(--space-1) var(--space-2);
    background: var(--color-popover);
    color: var(--color-popover-foreground);
    box-shadow: var(--elevation-overlay);
    font-family: var(--font-ui);
    font-size: var(--text-caption-size);
    line-height: var(--text-caption-line-height);
    white-space: nowrap;
    animation: prompt-trailing-tooltip-in var(--motion-fast) var(--ease-emphasized-out);
  }

  :global(.prompt-trailing-hint-tooltip[data-side='top']) {
    transform: translate(-50%, -100%);
  }

  :global(.prompt-trailing-hint-tooltip[data-side='bottom']) {
    transform: translateX(-50%);
  }

  .tiptap-container :global(.prompt-trailing-hint[data-state='enhanced']) {
    animation: prompt-enhanced 260ms ease-out both;
  }

  @keyframes prompt-enhanced {
    0% {
      opacity: 0.15;
      transform: translateY(2px) scale(0.98);
    }
    55% {
      opacity: 0.75;
      transform: translateY(0) scale(1.03);
    }
    100% {
      opacity: 0.4;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes -global-prompt-trailing-tooltip-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .tiptap-container :global(.prompt-trailing-hint[data-state='enhanced']) {
      animation: none;
    }

    :global(.prompt-trailing-hint-tooltip) {
      animation: none;
    }
  }

  /* `showOnlyWhenEditable: false` keeps the placeholder alive for `inputLocked`;
     the plain-disabled state must stay placeholder-free as before. */
  .tiptap-container.placeholder-suppressed
    :global(.tiptap-editor p.is-editor-empty:first-child::before),
  .tiptap-container.placeholder-suppressed :global(.tiptap-editor p.is-empty:first-child::before) {
    content: none;
  }

  /* Mention chip styles are defined in tiptap-editor.css */

  /* Inline image styles for chat input */
  :global(.chat-inline-image) {
    max-width: 100%;
    max-height: 200px;
    border-radius: 6px;
    margin: 4px 0;
    object-fit: contain;
    border: 1px solid hsl(var(--border) / 0.5);
  }

  :global(.mention-popup) {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
</style>
