import type { EditorOptions } from '@tiptap/core';
import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Mention from '@tiptap/extension-mention';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { CommentAnchor } from '$lib/components/tiptap/CommentAnchor';
import { createCommentDecorationsPlugin } from '$lib/components/tiptap/CommentDecorations';
import { createWorkspacesLink } from './tiptap-link-extension';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import TaskList from '@tiptap/extension-task-list';
import { CustomTaskItem } from '$lib/components/tiptap/CustomTaskItem';
import { TaskListShortcuts } from './task-list-shortcuts';
import { CustomCode } from './tiptap-code-extension';
import { ChoiceBlock } from '$lib/components/tiptap/ChoiceBlock';
import { ChoiceQuestion } from '$lib/components/tiptap/ChoiceQuestion';
import { ChoiceOption } from '$lib/components/tiptap/ChoiceOption';
import { ChoiceBlockShortcuts } from './choice-block-shortcuts';
import { TasksBlock } from '$lib/components/tiptap/TasksBlock';
import {
  openWorkspaceFile,
  openWorkspaceNote,
} from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
import { dispatchWindowEvent } from './window-events';
import { MermaidBlock } from '$lib/components/tiptap/MermaidBlock';
import { DiffBlock } from '$lib/components/tiptap/DiffBlock';
import { safeLowlight } from './safe-lowlight';
import {
  selectComments,
  selectCommentById,
} from '$store/renderer/slices/comments/comments-selectors';
import { createMentionSuggestionRenderer } from '$lib/components/chat/input/mention-suggestion-renderer';
import { getMentionSystem, type SearchContext } from '$lib/services/mentions';
import { toPromptToken } from '$lib/services/mentions/format';
import { m } from '$shared/paraglide/messages.js';

// Import note primitives extensions
import { ReferenceBlockNode } from './tiptap-primitives/reference-block-node';
import { CliBlockNode } from './tiptap-primitives/cli-block-node';
import { AgentActionBlockNode } from './tiptap-primitives/agent-action-block-node';
import { PatchBlockNode } from './tiptap-primitives/patch-block-node';
import { DiagramBlockNode } from './tiptap-primitives/diagram-block-node';

// Import details block extension
import { DetailsBlock, DetailsSummary, DetailsContent } from '$lib/components/tiptap/DetailsBlock';

// Import context mention extension for inline context pills
import { ContextMention } from '$lib/components/tiptap/ContextMention';

import { logger } from './client-logger';
import SmoothScroll from './smoothScroll';
import { detectFilePathFromClick } from './file-path-detector';
import { handleLink } from '$features/navigation/link-handler';
import { FilePathDecorations } from '$lib/components/tiptap/FilePathDecorations';
import { CodeBlockCopyButton } from '$lib/components/tiptap/CodeBlockCopyButton';
import { handleNoteEditorCopyAsMarkdown } from './selected-note-markdown-copy';
import { store as appStore } from '$store/renderer/store';
const lowlight = safeLowlight;

// Extend Mention to parse our span[data-mention] chips back into nodes
export const MentionFromSpan = Mention.extend({
  parseHTML() {
    return [{ tag: 'span[data-mention]' }];
  },
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el: any) => {
          // Try data-id first, then fall back to data-label or text content
          const dataId = el.getAttribute?.('data-id');
          if (dataId) return dataId;
          const dataLabel = el.getAttribute?.('data-label');
          if (dataLabel) return dataLabel;
          const textContent = el.textContent?.trim() || '';
          return textContent.startsWith('@') ? textContent.slice(1) : textContent || null;
        },
      },
      label: {
        default: null,
        parseHTML: (el: any) => {
          // Try data-label first, then fall back to text content (without @ prefix)
          const dataLabel = el.getAttribute?.('data-label');
          if (dataLabel) return dataLabel;
          const textContent = el.textContent?.trim() || '';
          // Remove @ prefix if present
          return textContent.startsWith('@') ? textContent.slice(1) : textContent || null;
        },
      },
      type: {
        default: 'file',
        parseHTML: (el: any) => el.getAttribute?.('data-type') || 'file',
      },
      uri: {
        default: '',
        parseHTML: (el: any) => el.getAttribute?.('data-uri') || '',
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

/**
 * Text serialization for mention chips: render the canonical @-token so text
 * extraction (TipTap `getTextBetween`, markdown round-trips) reproduces the
 * note's source text instead of dropping the atom node.
 */
export const mentionRenderText = ({ node }: { node: ProseMirrorNode }): string => {
  const data = node.attrs || {};
  try {
    return toPromptToken({
      type: data.type,
      id: data.id,
      label: data.label,
      meta: data.meta,
    });
  } catch {
    return `@${data?.meta?.fullPath || data?.meta?.path || data?.label || data?.id || 'item'}`;
  }
};

// Getter so the placeholder re-resolves when the locale changes.
function getPlaceholderText(): string {
  return m.editor_specEditor_placeholder();
}

/**
 * Extension that visually preserves text selection when editor loses focus.
 * Uses decorations to highlight the previously selected range.
 *
 * Note: We use TipTap's storage API to share state between methods, and avoid
 * dispatching transactions from onBlur/onFocus to prevent infinite recursion.
 */
const SelectionPreservation = Extension.create({
  name: 'selectionPreservation',

  addStorage() {
    return {
      preservedSelection: null as { from: number; to: number } | null,
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const storage = this.storage;

    return [
      new Plugin({
        key: new PluginKey('selectionPreservation'),
        props: {
          decorations(state) {
            // Check editor focus state directly instead of tracking via transactions
            if (editor.isFocused) {
              return DecorationSet.empty;
            }

            const preserved = storage.preservedSelection;
            if (!preserved) {
              return DecorationSet.empty;
            }

            const { from, to } = preserved;
            if (from === to || from < 0 || to > state.doc.content.size) {
              return DecorationSet.empty;
            }

            // Create a decoration for the preserved selection
            const decoration = Decoration.inline(from, to, {
              class: 'preserved-selection',
            });

            return DecorationSet.create(state.doc, [decoration]);
          },
        },
      }),
    ];
  },

  onFocus() {
    // Clear preserved selection when editor gains focus
    this.storage.preservedSelection = null;
    // Use setTimeout to dispatch after focus handling is complete (avoids infinite loop)
    const view = this.editor.view;
    setTimeout(() => {
      if (view && !view.isDestroyed) {
        // Dispatch empty transaction to trigger decoration recalculation
        view.dispatch(view.state.tr.setMeta('selectionPreservation', 'focus'));
      }
    }, 0);
  },

  onBlur() {
    // Preserve the current selection when editor loses focus
    const { from, to } = this.editor.state.selection;
    if (from !== to) {
      this.storage.preservedSelection = { from, to };
    } else {
      this.storage.preservedSelection = null;
    }
    // Use setTimeout to dispatch after blur handling is complete (avoids infinite loop)
    const view = this.editor.view;
    setTimeout(() => {
      if (view && !view.isDestroyed) {
        // Dispatch empty transaction to trigger decoration recalculation
        view.dispatch(view.state.tr.setMeta('selectionPreservation', 'blur'));
      }
    }, 0);
  },
});

interface EditorConfigOptions {
  element: HTMLElement;
  content: string;
  editable: boolean;
  onUpdate: (content: string) => void;
  onSelectionUpdate?: (selectedText: string) => void;
  onSuggestionClick?: (target: HTMLElement) => void;
  onCommentClick?: (commentId: string) => void;
  onFilePathClick?: (filePath: string, event: MouseEvent) => void; // Handle clicks on file paths in code elements
  useMarkdown?: boolean;
  enableComments?: boolean;
  useNewCommentSystem?: boolean; // Use new comment system
  workspace?: any; // Workspace for mention system
  enableMentions?: boolean; // Enable mention support
  enableNotePrimitives?: boolean; // Enable note primitives (reference, cli, agent, patch blocks)
  copySelectionAsMarkdown?: boolean; // Copy selected note-editor content as markdown
}

/**
 * Creates a complete Tiptap editor configuration
 * Encapsulates all editor setup logic in one place for easy reuse
 */
export function createEditorConfig(options: EditorConfigOptions): EditorOptions {
  const {
    element,
    content,
    editable,
    onUpdate,
    onSelectionUpdate,
    onSuggestionClick,
    onCommentClick,
    onFilePathClick,
    useMarkdown = false,
    enableComments = false,
    workspace,
    enableMentions = true, // Enable by default if workspace is provided
    enableNotePrimitives = false, // Disabled by default
    copySelectionAsMarkdown = false,
  } = options;

  logger.info('[EditorConfig] Creating config with:', {
    hasWorkspace: !!workspace,
    workspaceId: workspace?.id,
    enableMentions,
    useMarkdown,
  });

  // Create mention system instance
  const mentionSystem = workspace && enableMentions ? getMentionSystem() : null;
  logger.info('[EditorConfig] Mention system created:', !!mentionSystem);

  // Create mention suggestion configuration
  const mentionSuggestion =
    workspace && enableMentions
      ? {
          char: '@',
          pluginKey: new PluginKey('mention'),
          allowSpaces: false, // Don't allow spaces in mentions
          startOfLine: false, // Allow mentions anywhere in the text
          allowedPrefixes: null, // Allow after any character

          // Add custom command to handle selection
          command: ({ editor, range, props }: any) => {
            const mentionAttrs = {
              id: props.id,
              label: props.label,
              type: props.type,
              uri: props.uri,
              meta: props.meta || {},
            };

            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertContent({
                type: 'mention',
                attrs: mentionAttrs,
              })
              .run();
          },

          items: async ({ query }: { query: string }) => {
            logger.info(`[Mention] items() called with query: ${query}, length: ${query?.length}`);

            if (!workspace || !mentionSystem) {
              logger.warn('[Mention] No workspace or mention system available');
              return [];
            }

            const context: SearchContext = {
              workspaceId: workspace.id,
              currentFile: undefined,
              currentNote: undefined,
              recentFiles: [],
            };

            try {
              // Always search, even with empty query to show initial results
              const results = await mentionSystem.search(query || '', context);
              logger.info(`[Mention] Search results for query '${query}': ${results.length} items`);

              // Return all results, the search function handles filtering
              return results;
            } catch (error) {
              logger.error('[Mention] Failed to search mentions:', error);
              return [];
            }
          },

          // Use the shared mention suggestion renderer (same as TipTapEditor)
          render: () => createMentionSuggestionRenderer(),
        }
      : null;

  // Configure extensions - use enhanced formatting for markdown content
  const baseExtensions = useMarkdown
    ? [
        StarterKit.configure({
          heading: {}, // Enable with default options
          codeBlock: false, // We'll use CodeBlockLowlight instead
          code: false, // We'll use CustomCode instead to fix cursor positioning
          horizontalRule: {},
          link: false, // Disable default link, we'll add custom one
          bulletList: {
            keepMarks: true,
            keepAttributes: false,
          },
          orderedList: {
            keepMarks: true,
            keepAttributes: false,
          },
          blockquote: {
            HTMLAttributes: {
              class: 'border-l-4 border-muted-foreground/30 pl-4',
            },
          },
        }),
        CustomCode,
        // Mermaid diagram block extension - must be BEFORE CodeBlockLowlight
        // so it can intercept mermaid code blocks during parsing
        MermaidBlock,
        // Diff block extension - must be BEFORE CodeBlockLowlight
        // so it can intercept diff code blocks during parsing
        DiffBlock,
        CodeBlockLowlight.configure({
          lowlight,
          HTMLAttributes: {
            class: 'hljs',
            spellcheck: 'false',
          },
        }),
        CodeBlockCopyButton,
        createWorkspacesLink({
          openOnClick: false,
          HTMLAttributes: {
            class: 'text-primary underline cursor-pointer',
          },
        }),
        TaskList.configure({
          HTMLAttributes: {
            class: 'task-list not-prose pl-0',
          },
        }),
        CustomTaskItem.configure({
          nested: true,
          HTMLAttributes: {
            class: 'custom-task-item',
          },
          taskListTypeName: 'taskList',
        }),
        TaskListShortcuts,
        // Choice Block extensions (V2 with contentDOM)
        ChoiceBlock,
        ChoiceQuestion,
        ChoiceOption,
        ChoiceBlockShortcuts,
        // Tasks Block extension for proposed tasks from agents
        TasksBlock,
        Placeholder.configure({
          placeholder: getPlaceholderText(),
          emptyEditorClass: 'is-editor-empty',
          emptyNodeClass: 'is-empty',
          showOnlyWhenEditable: false,
          showOnlyCurrent: true,
        }),
        SmoothScroll,
        FilePathDecorations.configure({
          onFilePathClick,
        }),
        Image.configure({
          inline: false,
          allowBase64: true,
          HTMLAttributes: {
            class: 'note-image max-w-full rounded-md',
          },
        }),

        // Table support
        Table.configure({
          resizable: false,
          renderWrapper: true,
          HTMLAttributes: {
            class: 'note-table',
          },
        }),
        TableRow,
        TableHeader.configure({
          HTMLAttributes: {
            class: 'note-table-header',
          },
        }),
        TableCell.configure({
          HTMLAttributes: {
            class: 'note-table-cell',
          },
        }),

        // Details/Summary collapsible blocks
        DetailsBlock,
        DetailsSummary,
        DetailsContent,

        // Context mentions (inline pills for Linear, GitHub, Sentry links)
        ContextMention,

        // Add note primitives if enabled
        ...(enableNotePrimitives && workspace
          ? [
              ReferenceBlockNode.configure({
                workspaceId: workspace.id,
              }),
              CliBlockNode.configure({
                workspaceId: workspace.id,
              }),
              AgentActionBlockNode.configure({
                workspaceId: workspace.id,
              }),
              PatchBlockNode.configure({
                workspaceId: workspace.id,
              }),
              DiagramBlockNode.configure({
                workspaceId: workspace.id,
              }),
            ]
          : []),

        // Add mention support if enabled
        ...(workspace && enableMentions
          ? [
              MentionFromSpan.configure({
                HTMLAttributes: {
                  class: 'mention-chip',
                },
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
                renderText: mentionRenderText,
                suggestion: {
                  char: '@',
                  allowSpaces: false,

                  items: ({ query }) => {
                    logger.info('[Mention] items() called with query:', query);

                    if (!mentionSystem) {
                      // Fallback test data
                      const testItems = [
                        { id: 'spec', label: 'spec', type: 'note' },
                        { id: 'plan', label: 'plan', type: 'note' },
                        { id: 'readme', label: 'README.md', type: 'file' },
                      ];
                      return testItems.filter((item) =>
                        item.label.toLowerCase().includes(query.toLowerCase()),
                      );
                    }

                    const context: SearchContext = {
                      workspaceId: workspace.id,
                      currentFile: undefined,
                      currentNote: undefined,
                      recentFiles: [],
                    };

                    // Use synchronous search
                    const results = mentionSystem.searchSync(query || '', context);
                    logger.info('[Mention] Search results:', results.length);
                    return results;
                  },

                  render: () => {
                    let popup: any;
                    let selectedIndex = 0;
                    let currentItems: any[] = [];
                    let currentCommand: any = null;

                    // Helper to get icon SVG based on type
                    const getIconSvg = (type: string) => {
                      const icons: Record<string, string> = {
                        file: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>',
                        folder:
                          '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>',
                        note: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z"></path><path d="M15 3v4a2 2 0 0 0 2 2h4"></path></svg>',
                        task: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="6" height="6" rx="1"></rect><path d="m3 17 2 2 4-4"></path><path d="M13 6h8"></path><path d="M13 12h8"></path><path d="M13 18h8"></path></svg>',
                        rule: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>',
                        command:
                          '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>',
                        external:
                          '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>',
                      };
                      return icons[type] || icons.file;
                    };

                    return {
                      onStart: (props) => {
                        logger.info(
                          `[Mention] onStart with query: ${props.query}, items:`,
                          props.items,
                        );
                        currentItems = props.items || [];
                        currentCommand = props.command;
                        selectedIndex = 0;

                        popup = document.createElement('div');
                        popup.className = 'mention-popup';
                        popup.style.cssText = `
                      position: fixed;
                      background: hsl(var(--popover));
                      border: 1px solid hsl(var(--border));
                      border-radius: 6px;
                      padding: 2px;
                      z-index: 60;
                      max-height: 240px;
                      overflow-y: auto;
                      min-width: 200px;
                      max-width: 320px;
                      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
                      font-size: 13px;
                    `;

                        const updateItems = () => {
                          popup.innerHTML = '';
                          props.items.forEach((item: any, index: number) => {
                            const button = document.createElement('button');
                            button.className = 'mention-item';
                            button.style.cssText = `
                          display: flex;
                          align-items: center;
                          gap: 6px;
                          width: 100%;
                          text-align: left;
                          padding: 4px 8px;
                          border: none;
                          background: ${index === selectedIndex ? 'hsl(var(--primary))' : 'transparent'};
                          color: ${index === selectedIndex ? 'hsl(var(--primary-foreground))' : 'hsl(var(--foreground))'};
                          cursor: pointer;
                          border-radius: 3px;
                          transition: background 0.1s;
                          font-size: 13px;
                          line-height: 1.4;
                        `;

                            button.innerHTML = `
                          <span style="display: flex; align-items: center; opacity: ${index === selectedIndex ? '1' : '0.6'}; flex-shrink: 0;">
                            ${getIconSvg(item.type)}
                          </span>
                          <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${item.label}
                          </span>
                          ${item.description ? `<span style="opacity: 0.5; font-size: 11px; margin-left: 4px;">${item.description}</span>` : ''}
                        `;

                            button.onclick = () => props.command(item);
                            button.onmouseenter = () => {
                              selectedIndex = index;
                              updateItems();
                            };
                            popup.appendChild(button);
                          });
                        };

                        updateItems();
                        document.body.appendChild(popup);

                        const rect = props.clientRect?.();
                        if (rect) {
                          popup.style.left = `${rect.left}px`;
                          popup.style.top = `${rect.bottom + 5}px`;
                        }
                      },

                      onUpdate: (props) => {
                        logger.info(
                          `[Mention] onUpdate with query: ${props.query}, items:`,
                          props.items,
                        );
                        currentItems = props.items || [];
                        currentCommand = props.command;

                        if (popup) {
                          selectedIndex = 0;
                          popup.innerHTML = '';

                          props.items.forEach((item: any, index: number) => {
                            const button = document.createElement('button');
                            button.className = 'mention-item';
                            button.style.cssText = `
                          display: flex;
                          align-items: center;
                          gap: 6px;
                          width: 100%;
                          text-align: left;
                          padding: 4px 8px;
                          border: none;
                          background: ${index === selectedIndex ? 'hsl(var(--primary))' : 'transparent'};
                          color: ${index === selectedIndex ? 'hsl(var(--primary-foreground))' : 'hsl(var(--foreground))'};
                          cursor: pointer;
                          border-radius: 3px;
                          transition: background 0.1s;
                          font-size: 13px;
                          line-height: 1.4;
                        `;

                            button.innerHTML = `
                          <span style="display: flex; align-items: center; opacity: ${index === selectedIndex ? '1' : '0.6'}; flex-shrink: 0;">
                            ${getIconSvg(item.type)}
                          </span>
                          <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${item.label}
                          </span>
                          ${item.description ? `<span style="opacity: 0.5; font-size: 11px; margin-left: 4px;">${item.description}</span>` : ''}
                        `;

                            button.onclick = () => props.command(item);
                            button.onmouseenter = () => {
                              selectedIndex = index;
                              if (popup) {
                                const buttons = popup.querySelectorAll('button');
                                buttons.forEach((b: any, i: number) => {
                                  if (b && b.style) {
                                    b.style.background =
                                      i === selectedIndex ? 'hsl(var(--primary))' : 'transparent';
                                    b.style.color =
                                      i === selectedIndex
                                        ? 'hsl(var(--primary-foreground))'
                                        : 'hsl(var(--foreground))';
                                    const iconSpan = b.querySelector(
                                      'span:first-child',
                                    ) as HTMLElement;
                                    if (iconSpan && iconSpan.style) {
                                      iconSpan.style.opacity = i === selectedIndex ? '1' : '0.6';
                                    }
                                  }
                                });
                              }
                            };
                            popup.appendChild(button);
                          });

                          const rect = props.clientRect?.();
                          if (rect && popup && popup.style) {
                            popup.style.left = `${rect.left}px`;
                            popup.style.top = `${rect.bottom + 5}px`;
                          }
                        }
                      },

                      onKeyDown: (props) => {
                        if (props.event.key === 'Escape') {
                          props.event.stopPropagation();
                          return true;
                        }

                        // Use stored items instead of props.items
                        if (!currentItems || currentItems.length === 0 || !popup) {
                          return false;
                        }

                        if (props.event.key === 'ArrowDown') {
                          selectedIndex = (selectedIndex + 1) % currentItems.length;
                          const buttons = popup.querySelectorAll('button');
                          buttons.forEach((b: any, i: number) => {
                            if (b && b.style) {
                              b.style.background =
                                i === selectedIndex ? 'hsl(var(--primary))' : 'transparent';
                              b.style.color =
                                i === selectedIndex
                                  ? 'hsl(var(--primary-foreground))'
                                  : 'hsl(var(--foreground))';
                              const iconSpan = b.querySelector('span:first-child') as HTMLElement;
                              if (iconSpan && iconSpan.style) {
                                iconSpan.style.opacity = i === selectedIndex ? '1' : '0.6';
                              }
                            }
                          });
                          return true;
                        }

                        if (props.event.key === 'ArrowUp') {
                          selectedIndex =
                            (selectedIndex - 1 + currentItems.length) % currentItems.length;
                          const buttons = popup.querySelectorAll('button');
                          buttons.forEach((b: any, i: number) => {
                            if (b && b.style) {
                              b.style.background =
                                i === selectedIndex ? 'hsl(var(--primary))' : 'transparent';
                              b.style.color =
                                i === selectedIndex
                                  ? 'hsl(var(--primary-foreground))'
                                  : 'hsl(var(--foreground))';
                              const iconSpan = b.querySelector('span:first-child') as HTMLElement;
                              if (iconSpan && iconSpan.style) {
                                iconSpan.style.opacity = i === selectedIndex ? '1' : '0.6';
                              }
                            }
                          });
                          return true;
                        }

                        if (props.event.key === 'Enter') {
                          if (currentItems[selectedIndex] && currentCommand) {
                            currentCommand(currentItems[selectedIndex]);
                          }
                          return true;
                        }

                        return false;
                      },

                      onExit: () => {
                        if (popup && popup.parentNode) {
                          popup.parentNode.removeChild(popup);
                        }
                      },
                    };
                  },
                },
              }),
            ]
          : []),
      ]
    : [
        StarterKit.configure({
          heading: {}, // Enable with default options
          codeBlock: false,
          code: false, // We'll use CustomCode instead to fix cursor positioning
          horizontalRule: false,
          link: false, // Disable default link, we'll add custom one
        }),
        CustomCode,
        createWorkspacesLink({
          openOnClick: false,
          HTMLAttributes: {
            class: 'text-primary underline cursor-pointer',
          },
        }),
        TaskList.configure({
          HTMLAttributes: {
            class: 'task-list not-prose pl-0',
          },
        }),
        CustomTaskItem.configure({
          nested: true,
          HTMLAttributes: {
            class: 'custom-task-item',
          },
          taskListTypeName: 'taskList',
        }),
        TaskListShortcuts,
        // Choice Block extensions (V2 with contentDOM)
        ChoiceBlock,
        ChoiceQuestion,
        ChoiceOption,
        ChoiceBlockShortcuts,
        // Tasks Block extension for proposed tasks from agents
        TasksBlock,
        Placeholder.configure({
          placeholder: getPlaceholderText(),
          emptyEditorClass: 'is-editor-empty',
          emptyNodeClass: 'is-empty',
          showOnlyWhenEditable: false,
          showOnlyCurrent: true,
        }),
        FilePathDecorations.configure({
          onFilePathClick,
        }),
        Image.configure({
          inline: false,
          allowBase64: true,
          HTMLAttributes: {
            class: 'note-image max-w-full rounded-md',
          },
        }),

        // Table support
        Table.configure({
          resizable: false,
          renderWrapper: true,
          HTMLAttributes: {
            class: 'note-table',
          },
        }),
        TableRow,
        TableHeader.configure({
          HTMLAttributes: {
            class: 'note-table-header',
          },
        }),
        TableCell.configure({
          HTMLAttributes: {
            class: 'note-table-cell',
          },
        }),

        // Details/Summary collapsible blocks
        DetailsBlock,
        DetailsSummary,
        DetailsContent,

        // Context mentions (inline pills for Linear, GitHub, Sentry links)
        ContextMention,

        // Add note primitives if enabled
        ...(enableNotePrimitives && workspace
          ? [
              ReferenceBlockNode.configure({
                workspaceId: workspace.id,
              }),
              CliBlockNode.configure({
                workspaceId: workspace.id,
              }),
              AgentActionBlockNode.configure({
                workspaceId: workspace.id,
              }),
              PatchBlockNode.configure({
                workspaceId: workspace.id,
              }),
              DiagramBlockNode.configure({
                workspaceId: workspace.id,
              }),
            ]
          : []),

        // Add mention support if enabled
        ...(mentionSuggestion
          ? (logger.info(
              '[EditorConfig] Adding Mention extension (non-markdown) with suggestion:',
              !!mentionSuggestion,
            ),
            [
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
                renderText: mentionRenderText,
              }),
            ])
          : []),
      ];

  // Add selection preservation and comment extensions
  let extensions = [...baseExtensions, SelectionPreservation];

  if (enableComments) {
    // Anchor-based system with decorations plugin
    const CommentDecorationsExtension = Extension.create({
      name: 'commentDecorations',

      addProseMirrorPlugins() {
        logger.info('[CommentDecorationsExtension] Adding ProseMirror plugin');
        return [
          createCommentDecorationsPlugin({
            getComments: () => {
              const comments = selectComments.select(appStore.state);
              return comments;
            },
            onCommentClick,
            getCommentStatus: (commentId) => {
              const comment = selectCommentById.select(appStore.state, commentId);
              return comment?.status || 'open';
            },
          }),
        ];
      },
    });

    extensions = [
      ...baseExtensions,
      SelectionPreservation,
      CommentAnchor,
      CommentDecorationsExtension,
    ];
  }

  // Line attribution is now handled by LineAttributionGutter.svelte component
  // extensions = [...extensions, LineAttributionExtensionV2];

  return {
    element,
    extensions,
    content,
    editable,
    // Disable the buggy 'delete' core extension that emits delete events.
    // It has a bug where it calls nodeAt(newStart - 1) without checking if newStart is 0,
    // causing "Position -1 outside of fragment" errors. We don't use the delete events anyway.
    // See: https://github.com/ueberdosis/tiptap/issues/... (TipTap core bug)
    enableCoreExtensions: {
      delete: false,
    },
    onSelectionUpdate: ({ editor }: any) => {
      const { from, to } = editor.state.selection;
      if (from !== to && editor.isFocused) {
        // Only report selections when editor is focused (user-initiated).
        // This prevents phantom selections during initialization or external updates.
        const selectedText = editor.state.doc.textBetween(from, to, ' ');
        if (onSelectionUpdate) {
          // Let the component handle the callback and event dispatch
          // (e.g., NoteWithComments dispatches with file/language metadata)
          onSelectionUpdate(selectedText);
        } else if (typeof window !== 'undefined') {
          // Only dispatch generic event if no callback is provided
          dispatchWindowEvent('editor:selection-change', { text: selectedText, source: 'tiptap' });
        }
      } else if (editor.isFocused) {
        // Only clear selection if editor still has focus
        // This preserves the selection when user clicks to another panel
        if (onSelectionUpdate) {
          onSelectionUpdate('');
        } else if (typeof window !== 'undefined') {
          dispatchWindowEvent('editor:selection-change', { text: '', source: 'tiptap' });
        }
      }
    },
    onUpdate: ({ editor, transaction }: any) => {
      // CRITICAL: Skip onUpdate if this is an external update (from file watcher, etc.)
      // This prevents infinite loops where external updates trigger saves which trigger more updates
      if (transaction?.getMeta('external-update')) {
        logger.debug('[EditorConfig] Skipping onUpdate for external update');
        return;
      }

      // Check if editor is fully initialized and view is available
      // The view might exist but not be fully initialized, so we need to check both
      if (!editor.view || !editor.isEditable) {
        // Editor not fully ready, just update content
        onUpdate(editor.getHTML());
        return;
      }

      // Try to safely access view properties
      let hasFocus = false;
      let selectionFrom = 0;
      let selectionTo = 0;

      try {
        // Store current selection and focus state
        const { from, to } = editor.state.selection;
        selectionFrom = from;
        selectionTo = to;

        // Safely check if editor has focus
        // Use a try-catch because hasFocus might throw if view is not fully initialized
        hasFocus = editor.view.hasFocus?.() ?? false;
      } catch (e) {
        // If we can't access view properties, assume no focus
        logger.debug('Could not access editor view properties:', e);
      }

      // Always use HTML output (styled with prose classes)
      // Note: We're not using the markdown extension for output
      onUpdate(editor.getHTML());

      // Restore focus and selection after update if editor had focus
      if (hasFocus) {
        requestAnimationFrame(() => {
          if (!editor.isDestroyed && editor.view) {
            try {
              editor.commands.focus();
              // Try to restore selection position
              editor.commands.setTextSelection({ from: selectionFrom, to: selectionTo });
            } catch {
              // Selection might be out of bounds after content change or view not ready
              editor.commands.focus('end');
            }
          }
        });
      }
    },
    editorProps: {
      attributes: {
        class:
          'tiptap-editor h-full !outline-none focus:!outline-none border-none prose prose-sm dark:prose-invert max-w-none',
      },
      handleDOMEvents: copySelectionAsMarkdown
        ? {
            copy: (view: any, event: Event) =>
              handleNoteEditorCopyAsMarkdown(view, event as ClipboardEvent),
          }
        : undefined,
      handleClick: (_view: any, _pos: any, event: any) => {
        const target = event.target as HTMLElement;

        // Check for links — route through unified link handler
        const anchor = target.closest('a');
        if (anchor?.href) {
          event.preventDefault();
          if (workspace?.id) {
            handleLink(anchor.href, { workspaceId: workspace.id, event });
          }
          return true; // Handled
        }

        // Check for mention clicks
        const mentionEl = target.closest('[data-mention]') as HTMLElement;
        if (mentionEl) {
          event.preventDefault();
          event.stopPropagation();
          const mentionType = mentionEl.getAttribute('data-type');
          const mentionId = mentionEl.getAttribute('data-id');
          const mentionLabel = mentionEl.getAttribute('data-label');
          const textContent = mentionEl.textContent?.trim() || '';
          const metaStr = mentionEl.getAttribute('data-meta');
          const meta = metaStr ? JSON.parse(metaStr) : {};

          // Check if cmd/ctrl was held - opens in adjacent panel
          const openInAdjacentPanel = event.metaKey || event.ctrlKey;

          // Find the source panel for opening in adjacent (needed for split behavior)
          const panelElement = mentionEl.closest('[data-panel-id]');
          const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;

          if (mentionType === 'file' || mentionType === 'file-range') {
            // Open file in main content area
            // Try multiple sources for the file path, preferring the most complete one:
            // 1. meta.fullPath - explicitly stored full path
            // 2. data-label - often contains the display path
            // 3. textContent - the visible text (usually @path/to/file)
            // 4. data-id - may only have filename in legacy data
            let filePath = meta.fullPath || mentionLabel || mentionId;

            // If filePath is just a filename but textContent has a path, use textContent
            if (filePath && !filePath.includes('/') && textContent.includes('/')) {
              filePath = textContent;
            }

            // Strip leading @ if present (cleanup for legacy data or corrupted mentions)
            if (filePath?.startsWith('@')) {
              filePath = filePath.slice(1);
            }
            if (filePath && workspace?.id) {
              appStore.dispatch(
                openWorkspaceFile(workspace.id, filePath, {
                  line: meta.startLine,
                  openInAdjacentPanel,
                  sourcePanelId,
                }),
              );
            }
          } else if (mentionType === 'note' || mentionType === 'note-range') {
            // Open note in main content area
            if (mentionId && workspace?.id) {
              appStore.dispatch(
                openWorkspaceNote(workspace.id, mentionId, {
                  openInAdjacentPanel,
                  sourcePanelId,
                }),
              );
            }
          }
          // Note: folder/source-folder mentions currently don't navigate anywhere
          return true; // Handled
        }

        // Check if clicking on a suggestion
        if (target.closest('.suggestion') && onSuggestionClick) {
          onSuggestionClick(target);
          return true; // Prevent default behavior for suggestions
        }

        // Check if clicking on a file path (e.g., "src/components/Button.tsx")
        // This handles plain text file paths in notes without explicit @mentions
        const filePath = detectFilePathFromClick(target);
        if (filePath && workspace?.id) {
          event.preventDefault();
          const openInAdjacentPanel = event.metaKey || event.ctrlKey;
          logger.debug('[EditorConfig] File path clicked', { filePath, openInAdjacentPanel });
          appStore.dispatch(openWorkspaceFile(workspace.id, filePath, { openInAdjacentPanel }));
          return true;
        }

        // Let other handlers (like Comment extension) process the click
        return false;
      },
    },
  } as any;
}
