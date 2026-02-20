<script lang="ts">
  import { logger } from '$lib/utils/client-logger';

  import type { Editor } from '@tiptap/core';
  import type { Workspace } from '$shared/types';
  import Fa from 'svelte-fa';
  import {
    faBold,
    faItalic,
    faUnderline,
    faCode,
    faCommentDots,
    faStrikethrough,
    faPaperPlane,
    faCheck,
    faLink,
    faTimes,
  } from '@fortawesome/free-solid-svg-icons';
  import { TooltipShortcut } from '$lib/components/ui/tooltip';
  import { type ContextReference, convertContextReferences } from '$features/agent/agent-context';
  import LaunchFromSelectionDialog from './LaunchFromSelectionDialog.svelte';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { createAgentTypeId } from '$shared/types/agent.types';
  import { modelStore } from '$lib/stores/model.store.svelte';
  // import { getAgentTypes } from '$features/agent/instruction-registry';
  import Portal from '$lib/components/ui/Portal.svelte';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-manager.svelte';

  interface Props {
    editor: Editor | null;
    workspace: Workspace;
    noteId?: string;
    onAddComment?: () => void;
    onAgentLaunched?: (agentData: any) => void;
    onCreateSessionComment?: (agentData: any, from: number, to: number) => void;
  }

  let {
    editor = null,
    workspace,
    noteId,
    onAddComment,
    onAgentLaunched,
    onCreateSessionComment: _onCreateSessionComment,
  }: Props = $props();
  let bubbleMenuVisible = $state(false);
  let bubbleMenuPosition = $state({ x: 0, y: 0 });
  let menuRef: HTMLDivElement | null = $state(null);

  // Menu dimensions for edge detection (estimated, updated on mount)
  const MENU_HEIGHT = 40;
  const MENU_OFFSET = 8; // Gap between selection and menu

  // Launch dialog state
  let showLaunchDialog = $state(false);
  let launchDialogPosition = $state({ x: 0, y: 0 });
  let launchDialogSelection = $state('');
  let launchDialogMessage = $state('');
  let launchDialogSelectionFrom = $state(0);
  let launchDialogSelectionTo = $state(0);

  // Link input state
  let showLinkInput = $state(false);
  let linkInputValue = $state('');
  let linkInputElement: HTMLInputElement | null = $state(null);
  let savedLinkSelection: { from: number; to: number } | null = $state(null);

  function toggleBold() {
    editor?.chain().focus().toggleBold().run();
  }

  function toggleItalic() {
    editor?.chain().focus().toggleItalic().run();
  }

  function toggleUnderline() {
    editor?.chain().focus().toggleUnderline().run();
  }

  function toggleStrike() {
    editor?.chain().focus().toggleStrike().run();
  }

  function toggleCode() {
    editor?.chain().focus().toggleCode().run();
  }

  function handleAddComment() {
    if (onAddComment) {
      onAddComment();
    }
  }

  function handleLinkClick() {
    if (!editor) return;

    // Save the current selection so we can restore it when setting the link
    const { selection } = editor.state;
    savedLinkSelection = { from: selection.from, to: selection.to };

    // Check if selection already has a link
    const { href } = editor.getAttributes('link');

    if (href) {
      // If link exists, populate input with current URL
      linkInputValue = href;
    } else {
      linkInputValue = '';
    }

    showLinkInput = true;

    // Focus the input after it's rendered
    setTimeout(() => {
      linkInputElement?.focus();
    }, 0);
  }

  function handleSetLink() {
    if (!editor || !savedLinkSelection) {
      return;
    }

    const url = linkInputValue.trim();

    // Restore the saved selection first
    editor.commands.setTextSelection(savedLinkSelection);

    if (url) {
      // Set the link on the restored selection
      editor.chain().focus().setLink({ href: url }).run();
    } else {
      // If empty, remove the link
      editor.chain().focus().unsetLink().run();
    }

    // Reset state
    showLinkInput = false;
    linkInputValue = '';
    savedLinkSelection = null;
  }

  function handleCancelLink() {
    showLinkInput = false;
    linkInputValue = '';
    savedLinkSelection = null;
    editor?.commands.focus();
  }

  function handleLinkInputKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleSetLink();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      handleCancelLink();
    }
  }

  function handleLaunchAgentClick() {
    if (!editor) return;

    // Capture CURRENT selection (even if dialog is already open)
    const { selection } = editor.state;
    const { from, to } = selection;
    const selectedText = editor.state.doc.textBetween(from, to);

    if (!selectedText || selectedText.trim().length === 0) {
      logger.warn('[BubbleMenu] No text selected');
      return;
    }

    // Position dialog directly below the bubble menu
    // Use the same x position as the bubble menu (centered on selection)
    // and position y below the bubble menu
    launchDialogPosition = {
      x: bubbleMenuPosition.x,
      y: bubbleMenuPosition.y + MENU_HEIGHT + 8, // 8px gap below menu
    };

    // Update selection (but DON'T clear the message)
    launchDialogSelection = selectedText;
    // Store selection positions for session comment creation
    launchDialogSelectionFrom = from;
    launchDialogSelectionTo = to;

    // Open dialog (or keep it open if already open)
    showLaunchDialog = true;
  }

  async function handleLaunchSubmit(event: CustomEvent<{ userMessage: string }>) {
    const { userMessage } = event.detail;

    if (!workspace?.id) {
      logger.error('[BubbleMenu] Cannot launch agent: missing workspace');
      return;
    }

    try {
      // Create context reference with selected text
      const contextReference: ContextReference = {
        type: 'selection',
        selectedText: launchDialogSelection,
        noteId,
      };

      // Note: Selection positions (launchDialogSelectionFrom, launchDialogSelectionTo)
      // are captured in handleLaunchAgentClick() and used below for session comment creation

      // Convert to agent context format
      const context = convertContextReferences([contextReference]);

      // Use user message or default
      const finalUserMessage =
        userMessage.trim() || 'Handle this selection from the current context';

      logger.info('[BubbleMenu] Creating agent with unified creator', {
        workspaceId: WorkspaceId(workspace.id),
        agentType: 'workspace',
        hasSelection: !!launchDialogSelection,
        userMessage: finalUserMessage,
        contextLength: context.length,
        contextContent: context.map((c) => ({
          type: c.type,
          hasContent: !!c.content,
          contentLength: c.content?.length,
        })),
      });

      // Create the agent using agentFactory (consistent with other creation paths)
      // Backend will load instructions based on agentType
      // Note: contextReferences with content (selection) will be automatically
      // extracted to runtime context by AgentFactory
      // Use workspace's default model if set, otherwise fall back to global
      const { agentFactory } = await import('$features/agent/services/agent-factory');
      const result = await agentFactory.createAgent(workspace, {
        name: 'Handle Selection Agent',
        workspaceId: WorkspaceId(workspace.id),
        initialMessage: finalUserMessage, // User message (sent as initial message)
        agentType: createAgentTypeId('workspace'), // Backend loads instructions based on this
        model: modelStore.getWorkspaceDefaultModel(workspace.id),
        contextReferences: context,
        source: 'bubble-menu',
        metadata: {
          source: 'bubble-menu',
          agentType: 'workspace',
          contextReferences: context, // Contains selection - will be auto-extracted to runtime context
        },
      });

      if (!result.success || !result.agent) {
        throw new Error(result.error || 'Failed to create agent');
      }

      const session = result.agent;
      logger.info('[BubbleMenu] Agent created successfully', {
        agentId: session?.id,
        hasSession: !!session,
      });

      // Extract the agent data with the correct structure
      const agentData = {
        id: session?.id,
        name: session?.name || 'Agent',
        workspaceId: session?.workspaceId,
      };

      // Close dialog and CLEAR the message on successful launch
      showLaunchDialog = false;
      launchDialogMessage = '';

      // Open the agent tab in the panel layout
      if (agentData.id && workspace?.id) {
        const layoutManager = getPanelLayoutManager(workspace.id);
        layoutManager.openTab({
          type: 'agent',
          title: agentData.name || 'Agent',
          agentId: agentData.id,
          closable: true,
        });
        logger.info('[BubbleMenu] Opened agent tab', { agentId: agentData.id });
      }

      // Bubble up result
      if (agentData.id && onAgentLaunched) {
        onAgentLaunched(agentData);
      }
    } catch (error) {
      logger.error('[BubbleMenu] Failed to launch agent:', error);
      // Don't close dialog on error - let user retry
    }
  }

  function handleLaunchDialogClose() {
    // Clear message when user explicitly cancels
    launchDialogMessage = '';
    showLaunchDialog = false;
  }

  // Hide bubble menu when editor loses focus
  // Use queueMicrotask to avoid state_unsafe_mutation error when called from TipTap callbacks
  function hideBubbleMenu() {
    queueMicrotask(() => {
      bubbleMenuVisible = false;
    });
  }

  // Update bubble menu visibility and position based on selection
  $effect(() => {
    if (!editor) return;

    const updateBubbleMenu = () => {
      const { selection } = editor.state;
      const { from, to } = selection;

      // Show menu only when text is selected AND editor has focus
      if (from === to || !editor.isFocused) {
        bubbleMenuVisible = false;
        return;
      }

      bubbleMenuVisible = true;

      // Calculate position for the bubble menu using viewport coordinates (for portal)
      const view = editor.view;
      const coords = view.coordsAtPos(from);
      const endCoords = view.coordsAtPos(to);

      // Calculate center X position in viewport coordinates
      let x = (coords.left + endCoords.right) / 2;
      let y = coords.top - MENU_HEIGHT - MENU_OFFSET;

      // Edge detection: Keep menu within viewport
      const menuWidth = menuRef?.offsetWidth || 280; // Estimated width if not measured

      // Clamp X to keep menu in viewport (with padding)
      const padding = 12;
      const minX = menuWidth / 2 + padding;
      const maxX = window.innerWidth - menuWidth / 2 - padding;
      x = Math.max(minX, Math.min(maxX, x));

      // If menu would go above viewport, show it below the selection
      if (y < padding) {
        y = endCoords.bottom + MENU_OFFSET;
      }

      bubbleMenuPosition = { x, y };
    };

    // Listen to editor updates
    editor.on('selectionUpdate', updateBubbleMenu);
    editor.on('update', updateBubbleMenu);
    editor.on('blur', hideBubbleMenu);

    return () => {
      if (editor) {
        editor.off('selectionUpdate', updateBubbleMenu);
        editor.off('update', updateBubbleMenu);
        editor.off('blur', hideBubbleMenu);
      }
    };
  });

  // Hide bubble menu when tab becomes hidden (user switches tabs/apps)
  $effect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        hideBubbleMenu();
        showLaunchDialog = false;
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  });
</script>

<!-- Floating Bubble Menu - rendered via Portal to avoid clipping -->
{#if bubbleMenuVisible && editor}
  <Portal zIndex={100}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      bind:this={menuRef}
      class="bubble-menu-floating"
      style="left: {bubbleMenuPosition.x}px; top: {bubbleMenuPosition.y}px;"
      onmousedown={(e) => e.preventDefault()}
    >
      <div class="bubble-menu-container">
        <TooltipShortcut label="Bold" shortcut="cmd+b" side="top" delayDuration={200}>
          <button
            class="bubble-menu-btn"
            onclick={toggleBold}
            aria-label="Bold"
            disabled={!editor.can().chain().focus().toggleBold().run()}
            data-active={editor.isActive('bold')}
          >
            <Fa icon={faBold} size="xs" />
          </button>
        </TooltipShortcut>

        <TooltipShortcut label="Italic" shortcut="cmd+i" side="top" delayDuration={200}>
          <button
            class="bubble-menu-btn"
            onclick={toggleItalic}
            aria-label="Italic"
            disabled={!editor.can().chain().focus().toggleItalic().run()}
            data-active={editor.isActive('italic')}
          >
            <Fa icon={faItalic} size="xs" />
          </button>
        </TooltipShortcut>

        <TooltipShortcut label="Underline" shortcut="cmd+u" side="top" delayDuration={200}>
          <button
            class="bubble-menu-btn"
            onclick={toggleUnderline}
            aria-label="Underline"
            disabled={!editor.can().chain().focus().toggleUnderline().run()}
            data-active={editor.isActive('underline')}
          >
            <Fa icon={faUnderline} size="xs" />
          </button>
        </TooltipShortcut>

        <TooltipShortcut
          label="Strikethrough"
          shortcut="cmd+shift+x"
          side="top"
          delayDuration={200}
        >
          <button
            class="bubble-menu-btn"
            onclick={toggleStrike}
            aria-label="Strikethrough"
            disabled={!editor.can().chain().focus().toggleStrike().run()}
            data-active={editor.isActive('strike')}
          >
            <Fa icon={faStrikethrough} size="xs" />
          </button>
        </TooltipShortcut>

        <TooltipShortcut label="Code" shortcut="cmd+e" side="top" delayDuration={200}>
          <button
            class="bubble-menu-btn"
            onclick={toggleCode}
            aria-label="Code"
            disabled={!editor.can().chain().focus().toggleCode().run()}
            data-active={editor.isActive('code')}
          >
            <Fa icon={faCode} size="xs" />
          </button>
        </TooltipShortcut>

        <TooltipShortcut label="Add link" shortcut="cmd+k" side="top" delayDuration={200}>
          <button
            class="bubble-menu-btn"
            onclick={handleLinkClick}
            aria-label="Add link"
            data-active={editor.isActive('link')}
          >
            <Fa icon={faLink} size="xs" />
          </button>
        </TooltipShortcut>

        <div class="bubble-menu-divider"></div>

        <TooltipShortcut label="Add comment" side="top" delayDuration={200}>
          <button class="bubble-menu-btn" onclick={handleAddComment} aria-label="Add comment">
            <Fa icon={faCommentDots} size="xs" />
          </button>
        </TooltipShortcut>

        <TooltipShortcut label="Send to Agent" side="top" delayDuration={200}>
          <button
            class="bubble-menu-btn"
            onclick={handleLaunchAgentClick}
            aria-label="Send to Agent"
          >
            <Fa icon={faPaperPlane} size="xs" />
          </button>
        </TooltipShortcut>
      </div>

      <!-- Link Input (appears below the bubble menu) -->
      {#if showLinkInput}
        <div class="link-input-container">
          <input
            bind:this={linkInputElement}
            bind:value={linkInputValue}
            onkeydown={handleLinkInputKeydown}
            type="text"
            placeholder="Enter URL..."
            class="link-input"
          />
          <div class="link-input-actions">
            <button class="bubble-menu-btn small" onclick={handleSetLink} aria-label="Set link">
              <Fa icon={faCheck} size="xs" />
            </button>
            <button class="bubble-menu-btn small" onclick={handleCancelLink} aria-label="Cancel">
              <Fa icon={faTimes} size="xs" />
            </button>
          </div>
        </div>
      {/if}
    </div>
  </Portal>
{/if}

<!-- Launch From Selection Dialog -->
{#if showLaunchDialog}
  <LaunchFromSelectionDialog
    x={launchDialogPosition.x}
    y={launchDialogPosition.y}
    {workspace}
    {noteId}
    initialMessage={launchDialogMessage}
    onSubmit={handleLaunchSubmit}
    onClose={handleLaunchDialogClose}
  />
{/if}

<style>
  .bubble-menu-floating {
    position: fixed;
    z-index: 100;
    background-color: hsl(var(--popover));
    border: 1px solid hsl(var(--border));
    border-radius: 6px;
    box-shadow:
      0 1px 2px hsl(var(--foreground) / 0.04),
      0 4px 16px hsl(var(--foreground) / 0.08);
    padding: 3px;
    transform: translateX(-50%);
    animation: bubbleMenuFadeIn 0.12s ease-out;
  }

  .bubble-menu-container {
    display: flex;
    align-items: center;
    gap: 1px;
  }

  .bubble-menu-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    background: transparent;
    color: hsl(var(--muted-foreground));
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.1s ease;
  }

  .bubble-menu-btn:hover:not(:disabled) {
    background-color: hsl(var(--muted) / 0.5);
    color: hsl(var(--foreground));
  }

  .bubble-menu-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .bubble-menu-btn[data-active='true'] {
    background-color: hsl(var(--muted));
    color: hsl(var(--foreground));
  }

  .bubble-menu-btn.small {
    width: 22px;
    height: 22px;
  }

  .bubble-menu-divider {
    width: 1px;
    height: 16px;
    background-color: hsl(var(--border));
    margin: 0 2px;
  }

  @keyframes bubbleMenuFadeIn {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }

  .link-input-container {
    margin-top: 4px;
    padding: 4px;
    border-top: 1px solid hsl(var(--border));
    display: flex;
    gap: 4px;
    align-items: center;
  }

  .link-input {
    flex: 1;
    min-width: 180px;
    padding: 4px 8px;
    font-size: 12px;
    border: 1px solid hsl(var(--border));
    border-radius: 4px;
    background-color: hsl(var(--background));
    color: hsl(var(--foreground));
    outline: none;
  }

  .link-input::placeholder {
    color: hsl(var(--muted-foreground));
  }

  .link-input:focus {
    border-color: hsl(var(--border));
    box-shadow: 0 0 0 1px hsl(var(--border));
  }

  .link-input-actions {
    display: flex;
    gap: 2px;
  }

  /* Hide the default Tiptap bubble menu since we're using our own */
  :global(.tippy-box .bubble-menu) {
    display: none !important;
  }
</style>
