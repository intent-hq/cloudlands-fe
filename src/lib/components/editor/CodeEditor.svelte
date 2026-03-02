<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { monaco, initializeMonaco, ensureMonacoInitialized } from '$lib/utils/monaco-workers';
  import { defineMonacoThemes, getActiveMonacoThemeName } from '$lib/utils/monaco-theme';
  import { themeManager } from '$lib/utils/theme';
  import { agentFollowStore } from '$features/agent/agent-follow.store.svelte';
  import { createLogger } from '$lib/utils/client-logger';
  import AgentTypingAnimation from './AgentTypingAnimation.svelte';
  import { type LineChange, createLineChangeDecorations } from '$lib/utils/line-change-decorations';
  import { unifiedStateStore } from '$features/agent/services/unified-state-store';
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faExternalLinkAlt, faFolderOpen } from '@fortawesome/free-solid-svg-icons';
  import { invoke } from '$lib/electron-bridge';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { codeFontSettings } from '$lib/stores/code-font-settings.store.svelte';

  const logger = createLogger('CodeEditor');

  // Content size limit to prevent Monaco from freezing on large files
  const MAX_CONTENT_SIZE_BYTES = 500 * 1024; // 500KB

  interface Props {
    value?: string;
    language?: string;
    theme?: 'light' | 'dark';
    readOnly?: boolean;
    lineNumbers?: boolean;
    highlightActiveLine?: boolean;
    diffMode?: boolean;
    originalValue?: string;
    fileName?: string;
    lineWrapping?: boolean;
    jumpTo?: { line?: number; column?: number };
    /** Line changes to highlight in the gutter (like VS Code) */
    lineChanges?: LineChange[];
    workspaceId?: string;
    filePath?: string;
    /** Placeholder text shown when editor is empty */
    placeholder?: string;
  }

  let {
    value = $bindable(''),
    language = 'javascript',
    theme = 'light',
    readOnly = false,
    lineNumbers = true,
    highlightActiveLine = true,
    diffMode = false,
    originalValue = '',
    fileName = '',
    lineWrapping = true,
    jumpTo = undefined,
    lineChanges = [],
    workspaceId,
    filePath,
    placeholder,
  }: Props = $props();

  // Content size tracking
  let contentTooLarge = $state(false);
  let contentSize = $state(0);

  // Helper to format file size
  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Open file in VS Code
  async function openInVSCode() {
    if (!filePath) {
      logger.error('Cannot open file: missing file path');
      return;
    }

    let absolutePath: string;
    if (filePath.startsWith('/')) {
      // Already absolute
      absolutePath = filePath;
    } else {
      // Need to resolve relative path
      const workspace = workspaceId
        ? workspaceStore.findById(WorkspaceId(workspaceId))
        : workspaceStore.current;
      const workspacePath = workspace?.worktreePath || workspace?.repositoryPath;

      if (!workspacePath) {
        logger.error('Cannot open file: missing workspace path for relative file path');
        return;
      }
      absolutePath = `${workspacePath}/${filePath}`;
    }

    try {
      await invoke('vscode:openFile', { file: absolutePath });
    } catch (err) {
      logger.error('Failed to open file in VS Code:', err);
    }
  }

  // Reveal file in Finder
  async function revealInFolder() {
    if (!filePath) {
      logger.error('Cannot reveal file: missing file path');
      return;
    }

    let absolutePath: string;
    if (filePath.startsWith('/')) {
      // Already absolute
      absolutePath = filePath;
    } else {
      // Need to resolve relative path
      const workspace = workspaceId
        ? workspaceStore.findById(WorkspaceId(workspaceId))
        : workspaceStore.current;
      const workspacePath = workspace?.worktreePath || workspace?.repositoryPath;

      if (!workspacePath) {
        logger.error('Cannot reveal file: missing workspace path for relative file path');
        return;
      }
      absolutePath = `${workspacePath}/${filePath}`;
    }

    try {
      await invoke('shell:showItemInFolder', { path: absolutePath });
    } catch (err) {
      logger.error('Failed to reveal file:', err);
    }
  }

  // Svelte 5: bind:this updates the variable; use $state.raw to keep it reactive
  // without proxying DOM nodes.
  let container = $state.raw<HTMLDivElement | undefined>(undefined);
  let editor: monaco.editor.IStandaloneCodeEditor | null = null;
  let editorReady = $state(false);
  let isFollowingAgent = $derived(agentFollowStore.isFollowing);
  let agentColor = $derived(agentFollowStore.agentColor);

  // Track decoration IDs for line changes
  let lineChangeDecorationIds: string[] = [];

  // Theme change listener cleanup function - set on mount
  let themeCleanup: (() => void) | undefined;

  // Detect current theme using ThemeManager for consistency
  function detectCurrentTheme(): boolean {
    if (typeof window === 'undefined') return false;
    // Use ThemeManager's isDark() method as source of truth
    return themeManager.isDark();
  }

  let isDarkMode = detectCurrentTheme();

  // Ensure we always pass a string to Monaco APIs. If upstream code accidentally
  // provides a non-string value (e.g. an object), Monaco's internal
  // createTextBuffer() can throw `TypeError: factory.create is not a function`.
  function toEditorContent(val: unknown): string {
    if (typeof val === 'string') return val;
    if (val == null) return '';
    try {
      return JSON.stringify(val, null, 2);
    } catch {
      return String(val);
    }
  }

  // Track whether we need to initialize the editor after contentTooLarge is cleared
  let needsEditorInit = $state(false);

  // Monitor content size changes and reset contentTooLarge when navigating to smaller files
  $effect(() => {
    // Explicitly access value to create dependency
    const val = toEditorContent(value);
    const currentSize = val.length;

    if (currentSize <= MAX_CONTENT_SIZE_BYTES) {
      // Content is now acceptable - reset the "too large" state if it was set
      if (contentTooLarge) {
        logger.debug('Content size now acceptable, resetting contentTooLarge', {
          fileName,
          size: currentSize,
          limit: MAX_CONTENT_SIZE_BYTES,
        });
        contentTooLarge = false;
        contentSize = 0;
        // Mark that we need to initialize the editor since it wasn't created before
        needsEditorInit = true;
      }
    } else {
      // Content is too large
      if (!contentTooLarge) {
        logger.warn('Content too large for Monaco editor', {
          fileName,
          size: currentSize,
          limit: MAX_CONTENT_SIZE_BYTES,
        });
        contentTooLarge = true;
        contentSize = currentSize;
        // Dispose of existing editor if any
        if (editor) {
          editor.dispose();
          editor = null;
        }
      }
    }
  });

  // Initialize editor when needsEditorInit is set (after contentTooLarge is cleared)
  $effect(() => {
    if (needsEditorInit && container && !editor && !contentTooLarge) {
      needsEditorInit = false;
      // Use an async IIFE to initialize the editor
      (async () => {
        try {
          const initialValue = toEditorContent(value);
          await ensureMonacoInitialized();

          // Check if container is still in DOM after async operation
          if (!container || !container.parentNode || !document.body.contains(container)) {
            logger.debug('Container removed from DOM before editor reinitialization, skipping');
            return;
          }

          await initializeMonaco();

          // Check again after another async operation
          if (!container || !container.parentNode || !document.body.contains(container)) {
            logger.debug('Container removed from DOM before editor reinitialization, skipping');
            return;
          }

          defineMonacoThemes();

          const languageId = getLanguageId(language);
          isDarkMode = detectCurrentTheme();
          const selectedTheme = getActiveMonacoThemeName(isDarkMode);

          // Final check before creating editor
          if (!container || !container.parentNode || !document.body.contains(container)) {
            logger.debug('Container removed from DOM before editor reinitialization, skipping');
            return;
          }

          editor = monaco.editor.create(container, {
            value: initialValue,
            language: languageId,
            theme: selectedTheme,
            readOnly: readOnly,
            lineNumbers: lineNumbers ? 'on' : 'off',
            lineNumbersMinChars: 5,
            minimap: { enabled: false },
            automaticLayout: true,
            wordWrap: lineWrapping ? 'on' : 'off',
            overviewRulerLanes: 0,
            scrollBeyondLastLine: false,
            fontSize: 13,
            fontFamily: codeFontSettings.fontFamilyCSS,
            fontWeight: '500',
            fontLigatures: true,
            guides: { indentation: false }, // Disable indent guides to work around Monaco 0.54.0 crash
            scrollbar: {
              vertical: 'auto',
              horizontal: 'auto',
              verticalScrollbarSize: 10,
              horizontalScrollbarSize: 10,
            },
          });

          // Mark editor as ready for jumpTo effect
          editorReady = true;

          // Listen for changes
          editor?.onDidChangeModelContent(() => {
            value = editor?.getValue() || '';
          });

          // Listen for selection changes
          editor?.onDidChangeCursorSelection((e) => {
            const selection = e.selection;
            if (!selection.isEmpty() && editor?.hasTextFocus()) {
              // Only report selections when editor has focus (user-initiated).
              // This prevents phantom selections during initialization or external updates.
              const model = editor?.getModel();
              const selectedText = model?.getValueInRange(selection) || '';
              if (selectedText) {
                unifiedStateStore.selectionContext = {
                  text: selectedText,
                  file: fileName,
                  language: language,
                  range: undefined,
                };
                window.dispatchEvent(
                  new CustomEvent('editor:selection-change', {
                    detail: { text: selectedText, file: fileName, language, source: 'monaco' },
                  }),
                );
              }
            } else if (editor?.hasTextFocus()) {
              // Only clear selection if editor still has focus
              // This preserves the selection when user clicks to another panel
              unifiedStateStore.selectionContext = null;
              window.dispatchEvent(
                new CustomEvent('editor:selection-change', {
                  detail: { text: '', file: fileName, language, source: 'monaco' },
                }),
              );
            }
          });

          logger.debug('Editor re-initialized after contentTooLarge was cleared');
        } catch (err) {
          logger.error('Failed to initialize editor after contentTooLarge cleared:', err);
        }
      })();
    }
  });

  // Update editor content when value changes
  $effect(() => {
    // Explicitly access value to create dependency
    const val = toEditorContent(value);
    if (editor) {
      const currentValue = editor.getValue();
      if (currentValue !== val) {
        // If following an agent, don't update immediately - let animation handle it
        if (!isFollowingAgent) {
          // Save cursor position before updating
          const position = editor.getPosition();
          editor.setValue(val);
          // Restore cursor position after update
          if (position) {
            editor.setPosition(position);
          }
        }
      }
    }
  });

  // Update line change decorations when lineChanges prop changes
  $effect(() => {
    // Explicitly access lineChanges to create dependency
    const changes = lineChanges;
    if (!editor || !changes || changes.length === 0) {
      // Clear decorations if no changes
      if (editor && lineChangeDecorationIds.length > 0) {
        lineChangeDecorationIds = editor.deltaDecorations(lineChangeDecorationIds, []);
      }
      return;
    }

    // Create and apply decorations
    const decorations = createLineChangeDecorations(monaco, changes);
    lineChangeDecorationIds = editor.deltaDecorations(lineChangeDecorationIds, decorations);
  });

  // Handle agent typing animations
  $effect(() => {
    if (!editor || !isFollowingAgent) return;

    const handleAnimationEvent = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | {
            content?: string;
            isAddition?: boolean;
            lineNumber?: number;
            column?: number;
          }
        | undefined;
      if (!detail || typeof detail.content !== 'string') return;
      const { content, isAddition, lineNumber, column } = detail;

      if (editor) {
        if (isAddition) {
          // Use provided position or current position
          const position = lineNumber && column ? { lineNumber, column } : editor.getPosition();

          if (position) {
            // Insert text at position with animation effect
            const range = new monaco.Range(
              position.lineNumber,
              position.column,
              position.lineNumber,
              position.column,
            );

            editor.executeEdits('agent-typing', [
              {
                range,
                text: content,
                forceMoveMarkers: true,
              },
            ]);

            // Move cursor to end of inserted text
            const newPosition = {
              lineNumber: position.lineNumber,
              column: position.column + content.length,
            };
            editor.setPosition(newPosition);

            // Smooth scroll to position with padding
            editor.revealPositionInCenterIfOutsideViewport(newPosition, 0);
          }
        } else {
          // Handle deletions
          const position = lineNumber && column ? { lineNumber, column } : editor.getPosition();

          if (position && content.length > 0) {
            const range = new monaco.Range(
              position.lineNumber,
              Math.max(1, position.column - content.length),
              position.lineNumber,
              position.column,
            );

            editor.executeEdits('agent-typing', [
              {
                range,
                text: '',
                forceMoveMarkers: true,
              },
            ]);

            // Reveal the deletion position
            editor.revealPositionInCenterIfOutsideViewport(position, 0);
          }
        }
      }
    };

    window.addEventListener('agent-follow-animation', handleAnimationEvent);

    return () => {
      window.removeEventListener('agent-follow-animation', handleAnimationEvent);
    };
  });

  // Update language when it changes
  $effect(() => {
    // Explicitly access language to create dependency
    const lang = language;
    if (editor && lang) {
      const languageId = getLanguageId(lang);
      const model = editor.getModel();
      if (model) {
        monaco.editor.setModelLanguage(model, languageId);
      }
    }
  });

  // Update word wrap when lineWrapping prop changes
  $effect(() => {
    const wrap = lineWrapping;
    if (editor) {
      editor.updateOptions({ wordWrap: wrap ? 'on' : 'off' });
    }
  });

  // Update font when code font settings change
  $effect(() => {
    const fontFamily = codeFontSettings.fontFamilyCSS;
    if (editor) {
      editor.updateOptions({ fontFamily });
    }
  });

  function getLanguageId(lang: string): string {
    const langMap: Record<string, string> = {
      js: 'javascript',
      ts: 'typescript',
      jsx: 'javascript',
      tsx: 'typescript',
      py: 'python',
      rs: 'rust',
      html: 'html',
      css: 'css',
      scss: 'scss',
      less: 'less',
      json: 'json',
      md: 'markdown',
      yaml: 'yaml',
      yml: 'yaml',
      xml: 'xml',
      cpp: 'cpp',
      c: 'c',
      java: 'java',
      sh: 'shell',
      bash: 'shell',
      zsh: 'shell',
      sql: 'sql',
      svelte: 'svelte',
      vue: 'html', // Vue is similar to HTML
      go: 'go',
      rb: 'ruby',
      php: 'php',
      swift: 'swift',
      kt: 'kotlin',
      scala: 'scala',
      r: 'r',
      lua: 'lua',
      dockerfile: 'dockerfile',
      toml: 'ini',
      ini: 'ini',
      graphql: 'graphql',
      gql: 'graphql',
    };
    return langMap[lang] || lang;
  }

  onMount(async () => {
    if (!container) return;

    try {
      // Check content size before creating editor
      const initialValue = toEditorContent(value);
      if (initialValue.length > MAX_CONTENT_SIZE_BYTES) {
        logger.warn('Content too large for Monaco editor', {
          fileName,
          size: initialValue.length,
          limit: MAX_CONTENT_SIZE_BYTES,
        });
        contentTooLarge = true;
        contentSize = initialValue.length;
        return;
      }

      // Ensure Monaco is fully initialized before creating editor
      await ensureMonacoInitialized();

      // Check if container is still in DOM after async operation
      if (!container || !container.parentNode || !document.body.contains(container)) {
        logger.debug('Container removed from DOM before editor creation, skipping');
        return;
      }

      // Initialize Monaco configuration
      await initializeMonaco();

      // Check again after another async operation
      if (!container || !container.parentNode || !document.body.contains(container)) {
        logger.debug('Container removed from DOM before editor creation, skipping');
        return;
      }

      // Define custom themes before creating the editor
      defineMonacoThemes();

      const languageId = getLanguageId(language);

      // Re-detect theme right before creating editor (async operations above may have allowed theme to change)
      isDarkMode = detectCurrentTheme();
      const selectedTheme = getActiveMonacoThemeName(isDarkMode);

      // Final check before creating editor
      if (!container || !container.parentNode || !document.body.contains(container)) {
        logger.debug('Container removed from DOM before editor creation, skipping');
        return;
      }

      // Create the editor with the appropriate theme
      editor = monaco.editor.create(container, {
        value: initialValue,
        language: languageId,
        theme: selectedTheme,
        readOnly: readOnly,
        lineNumbers: lineNumbers ? 'on' : 'off',
        lineNumbersMinChars: 5,
        minimap: { enabled: false },
        automaticLayout: true,
        wordWrap: lineWrapping ? 'on' : 'off',
        overviewRulerLanes: 0,
        scrollBeyondLastLine: false,
        fontSize: 13,
        fontFamily: codeFontSettings.fontFamilyCSS,
        fontWeight: '500',
        fontLigatures: true,
        guides: { indentation: false }, // Disable indent guides to work around Monaco 0.54.0 crash
        scrollbar: {
          vertical: 'auto',
          horizontal: 'auto',
          verticalScrollbarSize: 10,
          horizontalScrollbarSize: 10,
        },
      });

      // Mark editor as ready for jumpTo effect
      editorReady = true;

      // Listen for changes
      editor?.onDidChangeModelContent(() => {
        value = editor?.getValue() || '';
      });

      // Listen for selection changes
      editor?.onDidChangeCursorSelection((e) => {
        const selection = e.selection;
        if (!selection.isEmpty() && editor?.hasTextFocus()) {
          // Only report selections when editor has focus (user-initiated).
          // This prevents phantom selections during initialization or external updates.
          const model = editor?.getModel();
          const selectedText = model?.getValueInRange(selection) || '';
          if (selectedText) {
            unifiedStateStore.selectionContext = {
              text: selectedText,
              file: fileName,
              language: language,
              range: undefined,
            };
            // Dispatch a custom event for components to listen to
            window.dispatchEvent(
              new CustomEvent('editor:selection-change', {
                detail: { text: selectedText, file: fileName, language, source: 'monaco' },
              }),
            );
          }
        } else if (editor?.hasTextFocus()) {
          // Only clear selection if editor still has focus
          // This preserves the selection when user clicks to another panel
          unifiedStateStore.selectionContext = null;
          window.dispatchEvent(
            new CustomEvent('editor:selection-change', {
              detail: { text: '', file: fileName, language, source: 'monaco' },
            }),
          );
        }
      });
    } catch (err) {
      logger.error('[CodeEditor] Failed to create Monaco editor:', err);
      // Try to create a basic editor with fallback theme
      try {
        // Ensure Monaco is loaded even for fallback
        await ensureMonacoInitialized();

        // Re-detect theme for fallback editor
        isDarkMode = detectCurrentTheme();

        const fallbackValue = toEditorContent(value);
        editor = monaco.editor.create(container, {
          value: fallbackValue,
          language: getLanguageId(language),
          theme: isDarkMode ? 'vs-dark' : 'vs',
          readOnly: readOnly,
          lineNumbers: lineNumbers ? 'on' : 'off',
          minimap: { enabled: false },
          automaticLayout: true,
          wordWrap: lineWrapping ? 'on' : 'off',
          fontFamily: codeFontSettings.fontFamilyCSS,
          guides: { indentation: false }, // Disable indent guides to work around Monaco 0.54.0 crash
        });

        // Mark editor as ready for jumpTo effect
        editorReady = true;

        // Listen for changes
        editor?.onDidChangeModelContent(() => {
          value = editor?.getValue() || '';
        });

        // Listen for selection changes (fallback editor)
        editor?.onDidChangeCursorSelection((e) => {
          const selection = e.selection;
          if (!selection.isEmpty() && editor?.hasTextFocus()) {
            // Only report selections when editor has focus (user-initiated).
            // This prevents phantom selections during initialization or external updates.
            const model = editor?.getModel();
            const selectedText = model?.getValueInRange(selection) || '';
            if (selectedText) {
              unifiedStateStore.selectionContext = {
                text: selectedText,
                file: fileName,
                language: language,
                range: undefined,
              };
              window.dispatchEvent(
                new CustomEvent('editor:selection-change', {
                  detail: { text: selectedText, file: fileName, language, source: 'monaco' },
                }),
              );
            }
          } else if (editor?.hasTextFocus()) {
            // Only clear selection if editor still has focus
            // This preserves the selection when user clicks to another panel
            unifiedStateStore.selectionContext = null;
            window.dispatchEvent(
              new CustomEvent('editor:selection-change', {
                detail: { text: '', file: fileName, language, source: 'monaco' },
              }),
            );
          }
        });
      } catch (fallbackErr) {
        logger.error('[CodeEditor] Failed to create fallback editor:', fallbackErr);
      }
    }

    // Set up theme change listeners
    if (typeof window !== 'undefined') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

      const handleChange = () => {
        const newTheme = detectCurrentTheme();
        isDarkMode = newTheme;
        // Update Monaco theme when theme changes
        if (editor) {
          monaco.editor.setTheme(getActiveMonacoThemeName(newTheme));
        }
      };

      // Listen to system preference changes
      mediaQuery.addEventListener('change', handleChange);

      // Listen to ThemeManager's theme-changed event (primary source of truth)
      const handleThemeChanged = (event: Event) => {
        const customEvent = event as CustomEvent<{ theme: string; isDark: boolean }>;
        isDarkMode = customEvent.detail.isDark;
        if (editor) {
          monaco.editor.setTheme(getActiveMonacoThemeName(customEvent.detail.isDark));
        }
      };
      window.addEventListener('theme-changed', handleThemeChanged);

      // Also watch for class changes on html element as fallback
      const observer = new MutationObserver(() => {
        const newTheme = detectCurrentTheme();
        isDarkMode = newTheme;
        if (editor) {
          monaco.editor.setTheme(getActiveMonacoThemeName(newTheme));
        }
      });

      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      });

      themeCleanup = () => {
        mediaQuery.removeEventListener('change', handleChange);
        window.removeEventListener('theme-changed', handleThemeChanged);
        observer.disconnect();
      };
    }

    // Set up scroll position save/restore event listeners
    const handleSaveScrollPosition = (
      event: CustomEvent<{ callback: (scrollTop: number) => void }>,
    ) => {
      if (editor) {
        const scrollTop = editor.getScrollTop();
        event.detail.callback(scrollTop);
      }
    };

    const handleRestoreScrollPosition = (
      event: CustomEvent<{ scrollPosition: number; filePath?: string }>,
    ) => {
      // Only restore if this is for our file (or no filePath specified)
      if (event.detail.filePath && event.detail.filePath !== fileName) return;

      if (editor && typeof event.detail.scrollPosition === 'number') {
        // Use requestAnimationFrame to ensure the editor is ready
        requestAnimationFrame(() => {
          if (editor) {
            editor.setScrollTop(event.detail.scrollPosition);
            logger.debug('[CodeEditor] Restored scroll position', {
              fileName,
              scrollPosition: event.detail.scrollPosition,
            });
          }
        });
      }
    };

    window.addEventListener('file:save-scroll-position', handleSaveScrollPosition as EventListener);
    window.addEventListener(
      'file:restore-scroll-position',
      handleRestoreScrollPosition as EventListener,
    );

    // Store cleanup functions
    const scrollCleanup = () => {
      window.removeEventListener(
        'file:save-scroll-position',
        handleSaveScrollPosition as EventListener,
      );
      window.removeEventListener(
        'file:restore-scroll-position',
        handleRestoreScrollPosition as EventListener,
      );
    };

    // Extend themeCleanup to also clean up scroll listeners
    const originalThemeCleanup = themeCleanup;
    themeCleanup = () => {
      originalThemeCleanup?.();
      scrollCleanup();
    };
  });

  /**
   * Focus the Monaco editor.
   * Called when switching to this panel via keyboard navigation.
   */
  export function focus(): boolean {
    if (editor) {
      try {
        editor.focus();
        return true;
      } catch (e) {
        logger.debug('[CodeEditor] Editor not ready for focus:', e);
      }
    }
    return false;
  }

  onDestroy(() => {
    // Clean up theme listeners (which now also includes scroll listeners)
    themeCleanup?.();

    if (editor) {
      // Wrap entire disposal in try-catch to handle any Monaco internal errors
      try {
        // Dispose the editor directly without clearing the model
        // Monaco will handle model cleanup internally
        editor.dispose();
      } catch (e) {
        // Silently ignore all disposal errors
        // These are usually harmless Monaco internal cleanup issues
      }
      editor = null;
      editorReady = false;
    }
  });

  // Jump to a specific line/column when requested
  // This effect needs to run when either jumpTo changes OR when editor becomes ready
  $effect(() => {
    // Read both values to track them - editorReady triggers re-run when editor is created
    const currentJumpTo = jumpTo;
    const isEditorReady = editorReady;
    if (!editor || !currentJumpTo || !isEditorReady) return;
    const line = Math.max(1, Math.floor(currentJumpTo.line ?? 1));
    const column = Math.max(1, Math.floor(currentJumpTo.column ?? 1));
    const model = editor.getModel?.();
    const maxLine = model?.getLineCount?.() ?? line;
    const clampedLine = Math.min(line, maxLine);
    const position = { lineNumber: clampedLine, column } as const;
    try {
      editor.setPosition(position);
      editor.revealPositionInCenterIfOutsideViewport(position, 0);
      editor.focus();
    } catch (e) {
      // ignore
    }
  });

  // Listen for F12 "Go to Definition" global shortcut
  $effect(() => {
    if (!editor) return;

    const handleGoToDefinition = () => {
      // Only trigger if this editor is focused
      if (editor?.hasTextFocus()) {
        editor.trigger('keyboard', 'editor.action.revealDefinition', {});
      }
    };

    window.addEventListener('editor:go-to-definition', handleGoToDefinition);
    return () => {
      window.removeEventListener('editor:go-to-definition', handleGoToDefinition);
    };
  });
</script>

<div class="relative h-full w-full">
  {#if contentTooLarge}
    <div class="content-too-large">
      <div class="text-center space-y-4 max-w-md">
        <div class="text-subtle">
          <svg
            class="w-16 h-16 mx-auto mb-4 opacity-50"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <h3 class="text-lg font-medium mb-2">File Too Large</h3>
          <p class="text-sm">
            This file is too large to display inline ({formatFileSize(contentSize)}). Open it in an
            external application instead.
          </p>
          {#if workspaceId && filePath}
            <div class="mt-4 flex items-center justify-center gap-2">
              <Button variant="secondary" size="sm" onclick={openInVSCode}>
                <Fa icon={faExternalLinkAlt} class="mr-2" />
                Open in VS Code
              </Button>
              <Button variant="ghost" size="sm" onclick={revealInFolder}>
                <Fa icon={faFolderOpen} class="mr-2" />
                Reveal in Finder
              </Button>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {:else}
    {#if isFollowingAgent}
      <AgentTypingAnimation
        bind:content={value}
        onContentChange={(newContent) => (value = newContent)}
        isActive={true}
      />
    {/if}
    <div bind:this={container} class="w-full h-full"></div>
    {#if placeholder && !value}
      <div class="placeholder-overlay">
        <span class="text-subtle text-sm italic">{placeholder}</span>
      </div>
    {/if}
  {/if}
</div>

<style>
  .content-too-large {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 2rem;
    background: var(--background);
  }

  .placeholder-overlay {
    position: absolute;
    top: 0;
    left: 64px; /* Account for line numbers gutter */
    pointer-events: none;
    padding: 0 0.5rem;
    z-index: 1;
  }

  :global(.monaco-editor) {
    /* font-family is set dynamically via codeFontSettings in Monaco config */
    font-weight: 500 !important;
    font-size: 13px !important;
  }

  :global(.monaco-editor .mtk1),
  :global(.monaco-editor .mtk2),
  :global(.monaco-editor .mtk3),
  :global(.monaco-editor .mtk4),
  :global(.monaco-editor .mtk6),
  :global(.monaco-editor .mtk8),
  :global(.monaco-editor .mtk11),
  :global(.monaco-editor .mtk12),
  :global(.monaco-editor .mtk16),
  :global(.monaco-editor .mtk17),
  :global(.monaco-editor .mtk18),
  :global(.monaco-editor .mtk19),
  :global(.monaco-editor .mtk20) {
    font-weight: 500 !important;
  }

  /* Dark theme token colors */
  :global(.dark .monaco-editor .mtk1) {
    color: #d4d4d4 !important;
  }
  :global(.dark .monaco-editor .mtk5) {
    color: #9cdcfe !important;
  }
  :global(.dark .monaco-editor .mtk7) {
    color: #ce9178 !important;
  }
  :global(.dark .monaco-editor .mtk9) {
    color: #569cd6 !important;
  }
  :global(.dark .monaco-editor .mtk10) {
    color: #6a9955 !important;
  }
  :global(.dark .monaco-editor .mtk13) {
    color: #4ec9b0 !important;
  }
  :global(.dark .monaco-editor .mtk14) {
    color: #dcdcaa !important;
  }
  :global(.dark .monaco-editor .mtk15) {
    color: #b5cea8 !important;
  }

  /* Light theme token colors */
  :global(.light .monaco-editor .mtk1) {
    color: #1f2937 !important;
  }
  :global(.light .monaco-editor .mtk5) {
    color: #374151 !important;
  }
  :global(.light .monaco-editor .mtk7) {
    color: #047857 !important;
  }
  :global(.light .monaco-editor .mtk9) {
    color: #7c3aed !important;
  }
  :global(.light .monaco-editor .mtk10) {
    color: #6b7280 !important;
  }
  :global(.light .monaco-editor .mtk13) {
    color: #b45309 !important;
  }
  :global(.light .monaco-editor .mtk14) {
    color: #1d4ed8 !important;
  }
  :global(.light .monaco-editor .mtk15) {
    color: #c2410c !important;
  }

  :global(.monaco-editor .line-numbers) {
    color: hsl(var(--muted-foreground) / 0.5) !important;
  }

  /* Line change indicators - VS Code style gutter decorations */
  :global(.line-change-indicator) {
    width: 3px !important;
    margin-left: 3px;
  }

  :global(.line-change-added) {
    background-color: #22c55e !important;
  }

  :global(.line-change-modified) {
    background-color: #3b82f6 !important;
  }

  :global(.line-change-deleted) {
    background-color: #ef4444 !important;
  }
</style>
