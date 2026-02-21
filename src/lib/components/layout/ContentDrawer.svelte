<script lang="ts">
  import { untrack } from 'svelte';
  import { logger } from '$lib/utils/client-logger';

  import { invoke } from '$lib/electron-bridge';
  import { CHAT_EXPORT_CHANNELS } from '$shared/ipc/channels';
  import { agentService } from '$features/agent/agent.service';
  import { unreadTrackingService } from '$features/agent/services/unread-tracking.service';
  import type { Workspace } from '$shared/types';
  import {
    faChevronLeft,
    faCode,
    faCodeBranch,
    faCommentDots,
    faCopy,
    faEllipsisVertical,
    faFileAlt,
    faFileExport,
    faTerminal,
    faTrash,
    faXmark,
    faStarOfLife,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import ChatPanel from '$lib/components/chat/ChatPanel.svelte';
  import UnifiedDiffViewer from '$lib/components/editor/UnifiedDiffViewer.svelte';
  import CodeBlock from '$lib/components/editor/CodeBlock.svelte';
  import CodeEditor from '$lib/components/editor/CodeEditor.svelte';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import VSCodeIcon from '$lib/components/shared/icons/VSCodeIcon.svelte';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import { Button } from '$lib/components/ui/button';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import FileActionsDropdown from '$lib/components/ui/FileActionsDropdown.svelte';
  import { getLanguageFromPath } from '$lib/utils/file-utils';
  import type { PanelVisibilityManager } from '$features/workspace/panel-visibility-manager.svelte';
  import { agentFollowStore } from '$features/agent/agent-follow.store.svelte';
  import { getAvatarColors } from '$lib/components/ui/auggie-avatar/avatar-constants';
  import OverviewPanel from '$lib/components/workspace/OverviewPanel.svelte';
  import Terminal from '$lib/components/terminal/Terminal.svelte';
  import FirstAgentWelcome from '../chat/FirstAgentWelcome.svelte';
  import DateSeparator from '../chat/DateSeparator.svelte';
  import ChatMessage from '../chat/ChatMessage.svelte';
  import StreamingTypingIndicator from '../chat/StreamingTypingIndicator.svelte';
  import { isGenericAgentName, generateRandomAgentName } from '$lib/utils/agent-name-generator';
  import { sessionStore, subscribeToAgent } from '$features/agent/browser';
  import type { AgentSession } from '$shared/types';
  import { modelStore } from '$lib/stores/model.store.svelte';
  import { specialistsStore } from '$lib/stores/specialists.store.svelte';

  interface Props {
    isOpen?: boolean;
    contentType?: 'agent' | 'diff' | 'file' | 'notes' | 'note' | 'code' | 'overview' | 'terminal';
    content?: any;
    workspace?: Workspace | null;
    workspacePath?: string;
    workspaceId?: string;
    agentStatus?: 'idle' | 'thinking' | 'running' | 'interrupted' | 'error';
    executionMode?: 'auto' | 'manual';
    currentContext?: {
      type: 'file' | 'note' | 'spec';
      path?: string;
      title?: string;
      noteId?: string;
      kind?: 'file' | 'note' | 'spec' | 'diff';
    };
    actions?: any;
    isFullWidth?: boolean;
    hideHeader?: boolean;
    isNewWorkspaceSession?: boolean;
    initialPrompt?: string | null;
    /** Draft prompt to pre-fill the input without sending */
    draftPrompt?: string | null;
    onClose?: () => void;
    onSendMessage?: (message: any) => void;
    onStopGeneration?: () => void;
    onOpenFile?: (data: any) => void;
    onExecuteCommand?: (data: any) => void;
    onUpdateExecutionMode?: (data: any) => void;
    onNavigateToAgent?: (agentId: string, messageId?: string) => void;
    onBack?: () => void;
    onChatUpdate?: (content: any) => void;
    onDelete?: () => void;
    onAgentStatusChange?: (status: string) => void;
    panelVisibilityManager?: PanelVisibilityManager;
    agentsList?: any[];
    agentsLoading?: boolean;
    terminalsList?: any[];
    onSelectAgent?: (agentId: string) => void;
    onSelectTerminal?: (terminalId: string) => void;
    onCreateAgent?: () => void;
    onCreateTerminal?: () => void;
    onUpdateAgent?: (agentId: string, updates: any) => void;
  }

  let {
    isOpen = $bindable(false),
    contentType = 'file',
    content = null,
    workspace = null,
    workspacePath: _workspacePath = '',
    workspaceId = '',
    agentStatus: _agentStatus = 'idle',
    executionMode: _executionMode = 'manual',
    currentContext: _currentContext,
    actions,
    isFullWidth = false,
    hideHeader = false,
    isNewWorkspaceSession = false,
    initialPrompt = null,
    draftPrompt = null,
    onClose,
    onSendMessage: _onSendMessage,
    onStopGeneration: _onStopGeneration,
    onOpenFile: _onOpenFile,
    onExecuteCommand: _onExecuteCommand,
    onUpdateExecutionMode: _onUpdateExecutionMode,
    onNavigateToAgent: _onNavigateToAgent,
    onBack: _onBack,
    onChatUpdate: _onChatUpdate,
    onDelete,
    onAgentStatusChange,
    panelVisibilityManager,
    agentsList = [],
    agentsLoading: _agentsLoading = false,
    terminalsList = [],
    onSelectAgent,
    onSelectTerminal,
    onCreateAgent,
    onCreateTerminal,
    onUpdateAgent: _onUpdateAgent,
  }: Props = $props();

  let isChatFocusedMode = $derived(panelVisibilityManager?.isChatFocusedMode ?? false);

  // Extract content ID as a primitive string for stable reactive dependency
  // This prevents infinite loops caused by object proxy re-creations
  let contentIdPrimitive = $derived(content?.id ? String(content.id) : undefined);
  let contentNamePrimitive = $derived(content?.name ? String(content.name) : undefined);
  let contentSessionIdPrimitive = $derived(
    content?.sessionId ? String(content.sessionId) : undefined,
  );

  // Create a local state for content to avoid mutating props
  let localContent = $state(content ? { ...content } : null);
  let lastContentType: string | undefined = $state(contentType);
  // IMPORTANT: Initialize lastContentId as a string to match how currentContentId is computed
  // This prevents type mismatches that could cause infinite loops
  let lastContentId: string | undefined = $state(content?.id ? String(content.id) : undefined);
  // Stable key for the {#key} block - only updated when ID actually changes
  // This prevents unnecessary remounts due to object reference changes
  let stableAgentKey: string = $state(content?.id ? String(content.id) : 'no-agent');

  // Combine regular agents with background agents for the overview panel
  let allAgents = $derived.by(() => {
    if (!workspace?.id) return agentsList;

    // Get ALL sessions including background agents
    const allSessions = agentService.getAllSessions();
    const backgroundAgents = allSessions.filter(
      (s) => s.workspaceId === workspace.id && (s.metadata?.isBackground || s.isBackground),
    );

    // Merge regular agents with background agents
    // Background agents might not be in agentsList yet
    const agentIds = new Set(agentsList.map((a) => a.id));
    const uniqueBackgroundAgents = backgroundAgents.filter((bg) => !agentIds.has(bg.id));

    return [...agentsList, ...uniqueBackgroundAgents];
  });

  // Reactive agent session for model picker - subscribes to agent updates
  // This is needed because sessionStore.getSession() doesn't establish reactivity
  let agentSessionForChat = $state<AgentSession | undefined>(undefined);

  $effect(() => {
    if (contentType !== 'agent' || !agentId) {
      agentSessionForChat = undefined;
      return;
    }

    // Subscribe to agent updates for reactivity
    const unsubscribe = subscribeToAgent(agentId, (session) => {
      agentSessionForChat = session;
    });

    return () => {
      unsubscribe();
    };
  });

  // Get agent model from session, falling back to workspace default model
  // This ensures the model picker shows the correct model even if localContent.model is undefined
  // For specialist agents, use the specialist's effective model (which includes user overrides)
  const agentModelForChat = $derived.by(() => {
    // Access overridesLoaded to establish reactivity - when overrides load, this will re-evaluate
    const _overridesLoaded = specialistsStore.overridesLoaded;
    // Use the reactive agentSessionForChat instead of sessionStore.getSession()
    const session = agentSessionForChat;

    // First try to get model from localContent (passed from parent)
    if (localContent?.model) {
      return localContent.model;
    }
    // Then try to get from session store
    if (contentType === 'agent' && agentId) {
      // If the agent has a specialist, use the specialist's effective model
      // This reflects user overrides for specialist models
      const specialistId = session?.metadata?.specialist || session?.agentMetadata?.specialist;
      if (specialistId) {
        const effectiveModel = specialistsStore.getEffectiveModel(specialistId as string);
        if (effectiveModel) {
          return effectiveModel;
        }
      }
      // Fall back to session model if no specialist or no effective model
      if (session?.model) {
        return session.model;
      }
    }
    // Fall back to workspace default model
    return modelStore.getWorkspaceDefaultModel(workspaceId);
  });

  // Update local content when prop changes
  $effect(() => {
    // Force update when content changes - check both ID and type
    // Also update if content becomes null/undefined
    // Special handling for overview which is just a string
    // IMPORTANT: Use primitive derived values (contentIdPrimitive, contentNamePrimitive) as reactive dependencies
    // This prevents infinite loops caused by object proxy re-creations while still detecting real changes
    const currentContentId = contentType === 'overview' ? 'overview' : contentIdPrimitive;
    const currentContentName = contentNamePrimitive;
    // Read the full content object with untrack to avoid creating additional reactive dependencies
    const currentContent = untrack(() => content);

    // Use untrack when reading localContent/lastContentId/lastContentType to avoid
    // creating reactive dependencies that could cause infinite loops during HMR
    const currentLocalContent = untrack(() => localContent);
    const currentLastContentId = untrack(() => lastContentId);
    const currentLastContentType = untrack(() => lastContentType);

    const contentChanged =
      currentContentId !== currentLastContentId ||
      contentType !== currentLastContentType ||
      (!currentContent && currentLocalContent && contentType !== 'overview') ||
      (currentContent && !currentLocalContent && contentType !== 'overview');

    // Also update if name changed (for agent rename)
    const nameChanged =
      contentType === 'agent' &&
      currentLocalContent &&
      currentContentName !== currentLocalContent.name;

    if (contentChanged || nameChanged) {
      // Log the change with correct old values (before updating them)
      logger.info('[ContentDrawer] Content changed', {
        oldId: currentLastContentId,
        newId: currentContentId,
        oldType: currentLastContentType,
        newType: contentType,
        // Don't log full content/localContent as they might be Proxies
        hasSessionId: !!currentContent?.sessionId,
        hasContent: !!currentContent,
        contentIdFromProp: currentContent?.id,
        isNewWorkspaceSession,
        isFirstWorkspaceAgent: currentContent?.isFirstWorkspaceAgent,
        isInitialAgent: currentContent?.isInitialAgent,
      });

      // Handle overview as a special case (it's just a string, not an object)
      // Use untrack for state mutations to prevent reactive cascades during HMR
      if (contentType === 'overview') {
        untrack(() => {
          localContent = null; // Overview doesn't need content data
        });
      } else if (currentContent) {
        // Create a plain object copy to avoid Proxy issues
        // Ensure IDs are plain strings and handle empty strings
        const contentId = currentContent.id ? String(currentContent.id) : null;

        untrack(() => {
          localContent = {
            ...currentContent,
            id: contentId || undefined, // Convert null/empty string to undefined
            sessionId: currentContent.sessionId ? String(currentContent.sessionId) : undefined,
            // Preserve initial agent flags
            isFirstWorkspaceAgent: currentContent.isFirstWorkspaceAgent,
            isInitialAgent: currentContent.isInitialAgent,
          };
        });

        logger.debug('[ContentDrawer] Created localContent', {
          contentId,
          localContentId: untrack(() => localContent?.id),
          isFirstWorkspaceAgent: untrack(() => localContent?.isFirstWorkspaceAgent),
          isInitialAgent: untrack(() => localContent?.isInitialAgent),
          hasValidId: !!untrack(() => localContent?.id),
        });
      } else {
        untrack(() => {
          localContent = null;
        });
        logger.debug('[ContentDrawer] No content provided, localContent set to null');
      }

      // Update last values after processing (so next comparison has correct old values).
      // Avoid no-op assignments (value unchanged) because they can still trigger additional
      // reactive work in Svelte 5 and contribute to effect depth blow-ups when parent state
      // re-renders frequently (e.g. unread updates while a drawer is open).
      untrack(() => {
        if (lastContentType !== contentType) {
          lastContentType = contentType;
        }

        if (lastContentId !== currentContentId) {
          lastContentId = currentContentId;
        }

        const nextStableAgentKey =
          contentType === 'agent'
            ? (contentIdPrimitive ?? contentSessionIdPrimitive ?? 'no-agent')
            : contentType === 'overview'
              ? 'overview'
              : (currentContentId ?? 'no-agent');

        if (stableAgentKey !== nextStableAgentKey) {
          stableAgentKey = nextStableAgentKey;
        }
      });

      // For agents, ensure we don't carry over sessionId from a different agent
      const updatedLocalContent = untrack(() => localContent);
      if (contentType === 'agent' && updatedLocalContent && currentContent) {
        // Session IDs are UUIDs from the backend, not prefixed with agent ID
        // Keep the sessionId if it exists - it's needed for AuggieChatPanel
        if (currentContent.sessionId && !updatedLocalContent.sessionId) {
          // If the content has a sessionId but localContent doesn't, copy it over
          untrack(() => {
            localContent = { ...updatedLocalContent, sessionId: currentContent.sessionId };
          });
          logger.info('[ContentDrawer] Copying sessionId from content', {
            agentId: currentContent.id,
            sessionId: currentContent.sessionId,
          });
        }
      }
    }
  });

  // Make reactive statements explicitly depend on localContent and contentType
  let title = $derived(getTitle(contentType, localContent));
  let icon = $derived(getIcon(contentType));

  // Track if file is being saved
  let isSaving = $state(false);
  let saveError: string | null = $state(null);
  let editedContent: string = $state('');
  let lastFilePath: string | null = $state(null);

  // Chat panel reference and navigation state
  let chatPanelRef: ChatPanel | null = $state(null);
  let navigationState = $state({
    userMessageCount: 0,
    currentMessageIndex: 0,
    canNavigatePrevious: false,
    canNavigateNext: false,
    isAtTop: true,
    isAtBottom: true,
  });

  // Agent messages for agent chat
  let agentMessages: any[] = $state([]);

  // Track copied state for tooltip
  let isCopied = $state(false);
  let copyTimeoutId: NodeJS.Timeout | null = null;

  // Follow state for agents - derive the agent identifier from stable prop primitives (id or sessionId)
  // This avoids coupling agent-related side effects to localContent reassignments (which can be frequent
  // during drawer updates) and prevents reactive feedback loops when parent state is also derived
  // from agent/unread updates.
  let agentId = $derived(
    contentType === 'agent' ? (contentIdPrimitive ?? contentSessionIdPrimitive) : undefined,
  );

  // Track unread status - mark agent as viewed when drawer opens with this agent
  $effect(() => {
    if (contentType === 'agent' && agentId && isOpen) {
      const plainAgentId = String(agentId);
      // Mark this agent as currently being viewed (clears unread status)
      unreadTrackingService.markAsViewed(plainAgentId);
    } else if (contentType !== 'agent' || !isOpen) {
      // No agent is being viewed
      unreadTrackingService.clearCurrentlyViewed();
    }
  });

  let isFollowing = $derived(
    contentType === 'agent' && agentId && agentFollowStore.followedAgentId === agentId,
  );

  let agentColor = $derived(contentType === 'agent' && agentId ? getAvatarColors(agentId) : null);

  // Check if the current agent is a background agent
  let isBackgroundAgent = $derived.by(() => {
    if (contentType !== 'agent' || !agentId) return false;
    const session = agentService.getSession(String(agentId));
    return session?.isBackground || session?.metadata?.isBackground || false;
  });

  // Subscribe to message updates during streaming
  // Use a more efficient approach that only updates when streaming
  let isAgentStreaming = $state(false);
  let messageUpdateInterval: NodeJS.Timeout | null = null;

  $effect(() => {
    if (contentType === 'agent' && agentId) {
      const plainAgentId = String(agentId);

      // Clear any existing interval
      if (messageUpdateInterval) {
        clearInterval(messageUpdateInterval);
        messageUpdateInterval = null;
      }

      // Function to check and update messages
      const checkForUpdates = () => {
        const agent = agentService.getSession(plainAgentId);
        if (agent) {
          // Check if agent is streaming using the agentService method
          // Use untrack to read wasStreaming without creating a reactive dependency
          const wasStreaming = untrack(() => isAgentStreaming);
          const newIsStreaming = agentService.isStreaming(plainAgentId);
          if (newIsStreaming !== wasStreaming) {
            untrack(() => {
              isAgentStreaming = newIsStreaming;
            });
          }

          // Always update messages if we have them, regardless of streaming state
          // This ensures we don't lose messages when streaming completes
          if (agent.messages && agent.messages.length > 0) {
            // Get the last message
            const lastMessage = agent.messages[agent.messages.length - 1];

            // Use untrack to read agentMessages without creating reactive dependency
            const currentMessages = untrack(() => agentMessages);
            // Check if we need to update - compare by ID and content length for efficiency
            // Avoid expensive JSON.stringify comparison
            const currentLastMessage = currentMessages[currentMessages.length - 1];
            const needsUpdate =
              currentMessages.length !== agent.messages.length ||
              (currentMessages.length > 0 &&
                (currentLastMessage?.id !== lastMessage?.id ||
                  currentLastMessage?.contentBlocks?.length !==
                    lastMessage?.contentBlocks?.length));

            if (needsUpdate) {
              // Create a new array to trigger reactivity - use untrack for write
              untrack(() => {
                agentMessages = [...agent.messages];
              });
              logger.info('[ContentDrawer] Updated messages', {
                agentId: plainAgentId,
                messageCount: agent.messages.length,
                isStreaming: newIsStreaming,
                wasStreaming: wasStreaming,
              });
            }
          }

          // If streaming just stopped, do one more update after a short delay
          // to ensure we capture the final state
          if (wasStreaming && !newIsStreaming) {
            setTimeout(() => {
              const finalAgent = agentService.getSession(plainAgentId);
              if (finalAgent && finalAgent.messages && finalAgent.messages.length > 0) {
                untrack(() => {
                  agentMessages = [...finalAgent.messages];
                });
                logger.info('[ContentDrawer] Final update after streaming stopped', {
                  agentId: plainAgentId,
                  messageCount: finalAgent.messages.length,
                });
              }
            }, 100); // Small delay to ensure backend has finished updating
          }

          // If not streaming anymore, clear the interval
          if (!newIsStreaming && messageUpdateInterval) {
            clearInterval(messageUpdateInterval);
            messageUpdateInterval = null;
          }
        }
      };

      // Start polling when component mounts or agent changes
      checkForUpdates(); // Initial check

      // Set up polling interval - 150ms provides smooth updates without excessive overhead
      // 50ms was too aggressive and caused performance issues during streaming
      messageUpdateInterval = setInterval(checkForUpdates, 150);

      // Cleanup on unmount
      return () => {
        if (messageUpdateInterval) {
          clearInterval(messageUpdateInterval);
          messageUpdateInterval = null;
        }
      };
    }
  });

  // Toggle following this agent
  function toggleFollow() {
    if (contentType === 'agent' && agentId) {
      if (isFollowing) {
        agentFollowStore.stopFollowing();
      } else {
        // Get the agent session using the agent ID
        const agent = agentService.getSession(agentId);
        if (agent) {
          agentFollowStore.startFollowing(agent);
        }
      }
    }
  }

  // Watch for external changes to isOpen and reset state when drawer is closed
  $effect(() => {
    // Read lastContentType with untrack to avoid reactive dependency on internal state
    const currentLastContentType = untrack(() => lastContentType);

    if (!isOpen) {
      // Reset state when drawer is closed from outside (but don't destroy terminals)
      // Use untrack for writes to avoid triggering reactive updates
      untrack(() => {
        editedContent = '';
        lastFilePath = null;
        isSaving = false;
        saveError = null;
      });
    } else if (isOpen && contentType === 'agent') {
      // Focus prompt box when drawer opens with an agent
      // Use a longer delay when switching from terminal to ensure proper mounting
      const delay = currentLastContentType === 'terminal' ? 300 : 150;
      setTimeout(() => {
        chatPanelRef?.focusPrompt?.();
      }, delay);
    }
  });

  // Track previous agent ID to detect agent switches
  let previousAgentId = $state<string | undefined>(undefined);

  // Focus prompt when switching between agents (drawer already open)
  $effect(() => {
    if (contentType === 'agent' && agentId && isOpen) {
      const currentAgentId = String(agentId);
      const prevAgentId = untrack(() => previousAgentId);

      // If we switched to a different agent while drawer was already open
      if (prevAgentId && prevAgentId !== currentAgentId) {
        logger.debug('[ContentDrawer] Agent switched, focusing prompt', {
          from: prevAgentId,
          to: currentAgentId,
        });
        setTimeout(() => {
          chatPanelRef?.focusPrompt?.();
        }, 100);
      }

      // Update previous agent ID
      previousAgentId = currentAgentId;
    }
  });

  // Track the last loaded agent ID to prevent duplicate loads
  let lastLoadedAgentId = $state<string | null>(null);

  // Track previous isOpen state to detect when drawer closes
  let prevIsOpen = $state(isOpen);

  // Load agent messages when opening an agent chat
  $effect(() => {
    // Track agentId to re-run when agent changes
    const currentAgentId = agentId;

    // Read localContent with untrack to avoid creating reactive dependencies on localContent itself
    // We only want this effect to re-run when contentType, workspace, or agentId changes
    const currentLocalContent = untrack(() => localContent);
    const currentLastLoadedAgentId = untrack(() => lastLoadedAgentId);
    const currentPrevIsOpen = untrack(() => prevIsOpen);
    const currentIsOpen = untrack(() => isOpen);

    // Update prevIsOpen for next run
    if (currentPrevIsOpen !== currentIsOpen) {
      untrack(() => {
        prevIsOpen = currentIsOpen;
      });
      // If drawer just closed, reset lastLoadedAgentId so reopening triggers a fresh load
      if (!currentIsOpen && currentPrevIsOpen) {
        untrack(() => {
          lastLoadedAgentId = null;
        });
        return; // Don't try to load when closing
      }
    }

    if (contentType === 'agent' && currentAgentId && workspace && currentIsOpen) {
      // Only load if we haven't already loaded this agent
      if (currentLastLoadedAgentId !== currentAgentId) {
        logger.info('[ContentDrawer] Loading agent messages for', {
          agentId: currentAgentId,
          hasSessionId: !!currentLocalContent?.sessionId,
          sessionId: currentLocalContent?.sessionId ? String(currentLocalContent.sessionId) : null,
          contentType,
          // Don't log the full localContent as it might be a Proxy
        });
        untrack(() => {
          lastLoadedAgentId = currentAgentId;
        });
        // Try to load agent messages, restoring from disk if needed
        loadAgentMessages(currentAgentId);
      }
    } else if (contentType !== 'agent') {
      // Reset when switching away from agent
      untrack(() => {
        lastLoadedAgentId = null;
      });
    }
  });

  async function loadAgentMessages(agentId: string) {
    // Ensure agentId is a plain string (not a Proxy)
    const plainAgentId = String(agentId);

    // First try to get from memory
    let agent = agentService.getSession(plainAgentId);

    // If not in memory, try to restore from disk
    if (!agent && workspace) {
      logger.info(
        `[ContentDrawer] Agent ${plainAgentId} not in memory, attempting to restore from disk`,
      );
      agent = await agentService.restoreSession(plainAgentId, workspace);
    }

    if (agent && agent.messages) {
      logger.info(
        `[ContentDrawer] Loading ${agent.messages.length} messages for agent ${plainAgentId}`,
      );
      agentMessages = agent.messages;
    } else {
      logger.info(`[ContentDrawer] No messages found for agent ${plainAgentId}`);
      agentMessages = [];
    }
  }

  // Initialize edited content only when the file changes (not on every content update)
  $effect(() => {
    // Read localContent with untrack to avoid reactive dependency on internal state
    const currentLocalContent = untrack(() => localContent);
    const currentFilePath = currentLocalContent?.filePath || currentLocalContent?.fileName || null;

    // Use untrack to read lastFilePath without creating reactive dependency
    const currentLastFilePath = untrack(() => lastFilePath);

    // Only re-initialize if the file path changed (new file opened)
    if (currentFilePath !== currentLastFilePath) {
      // Use untrack for all state mutations
      untrack(() => {
        lastFilePath = currentFilePath;

        if (currentLocalContent?.newContent !== undefined) {
          editedContent = currentLocalContent.newContent;
          logger.info(
            '[ContentDrawer] Initialized editedContent with newContent:',
            editedContent.substring(0, 100),
          );
        } else if (currentLocalContent?.content !== undefined) {
          editedContent = currentLocalContent.content;
          logger.info(
            '[ContentDrawer] Initialized editedContent with content:',
            editedContent.substring(0, 100),
          );
        }
      });

      // Debug what we received
      if (contentType === 'diff') {
        logger.info('[ContentDrawer] Diff mode with:', {
          hasOldContent: currentLocalContent?.oldContent !== undefined,
          hasNewContent: currentLocalContent?.newContent !== undefined,
          oldLength: currentLocalContent?.oldContent?.length,
          newLength: currentLocalContent?.newContent?.length,
          hasDiffChunks: !!(
            currentLocalContent?.diffChunks && currentLocalContent.diffChunks.length > 0
          ),
        });
      } else if (contentType === 'file') {
        logger.info('[ContentDrawer] File mode with:', {
          hasOldContent: currentLocalContent?.oldContent !== undefined,
          hasContent: currentLocalContent?.content !== undefined,
          hasNewContent: currentLocalContent?.newContent !== undefined,
          oldLength: currentLocalContent?.oldContent?.length,
          contentLength: currentLocalContent?.localContent?.length,
          newLength: currentLocalContent?.newContent?.length,
          willShowDiff: !!currentLocalContent?.oldContent,
        });
      }
    }
  });

  async function saveFile() {
    if (!localContent?.filePath || !workspaceId) {
      saveError = 'Missing file path or space ID';
      return;
    }

    // Store filePath to avoid issues if localContent becomes null during async operation
    const filePath = localContent.filePath;

    isSaving = true;
    saveError = null;

    try {
      const result = (await invoke('write_file', {
        workspaceId,
        filePath,
        content: editedContent,
      })) as { success?: boolean; error?: string };

      if (result.success) {
        // Update the local content to reflect the saved state
        if (localContent?.newContent !== undefined) {
          localContent.newContent = editedContent;
        } else if (localContent?.content !== undefined) {
          localContent.content = editedContent;
        }
        logger.info('[ContentDrawer] File saved successfully:', filePath);
      } else {
        saveError = result.error || 'Failed to save file';
      }
    } catch (error) {
      logger.error('[ContentDrawer] Error saving file:', error as Error);
      saveError = (error as Error).message || 'Failed to save file';
    } finally {
      isSaving = false;
    }
  }

  function handleContentChange(newContent: string) {
    editedContent = newContent;
  }

  function handleClose() {
    // Reset state when closing the drawer
    editedContent = '';
    lastFilePath = null;
    isSaving = false;
    saveError = null;

    // Update the bindable isOpen state
    isOpen = false;

    // Note: We don't dispose terminals here because they should persist
    // across drawer open/close cycles. Terminals are only disposed when
    // explicitly removed from the dock.

    // Call the parent's onClose handler
    onClose?.();
  }

  async function handleCopyConversation() {
    if (contentType !== 'agent' || !agentMessages || agentMessages.length === 0) {
      logger.warn('[ContentDrawer] Cannot copy: no messages available', {
        contentType,
        messageCount: agentMessages?.length || 0,
      });
      return;
    }

    try {
      // Format the conversation as text with different separators
      const parts: string[] = [];
      let prevRole: string | null = null;

      for (const msg of agentMessages) {
        // Extract text from content blocks
        const text =
          msg.contentBlocks
            ?.filter((block: any) => block.type === 'text')
            .map((block: any) => block.text || block.content || '')
            .join('\n') || '';

        if (!text.trim()) continue;

        // Add separator based on role transition
        if (prevRole !== null) {
          if (prevRole === 'assistant' && msg.role === 'user') {
            // Strong separator between pairs (after assistant, before next user)
            parts.push('\n' + '='.repeat(80) + '\n');
          } else {
            // Weak separator within a pair (between user and assistant)
            parts.push('\n---\n');
          }
        }

        // Format with role prefix
        const role = msg.role === 'user' ? 'User' : 'Assistant';
        const timestamp = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : '';

        parts.push(`${role}${timestamp ? ` (${timestamp})` : ''}:\n${text}`);
        prevRole = msg.role;
      }

      const conversationText = parts.join('\n');

      // Copy to clipboard
      await navigator.clipboard.writeText(conversationText);

      logger.info('[ContentDrawer] Conversation copied to clipboard', {
        messageCount: agentMessages.length,
        textLength: conversationText.length,
      });

      // Set copied state and reset after 2 seconds
      isCopied = true;
      if (copyTimeoutId) {
        clearTimeout(copyTimeoutId);
      }
      copyTimeoutId = setTimeout(() => {
        isCopied = false;
        copyTimeoutId = null;
      }, 2000);
    } catch (error) {
      logger.error('[ContentDrawer] Failed to copy conversation', error);
    }
  }

  async function handleExportAsHtml() {
    if (contentType !== 'agent' || !agentMessages || agentMessages.length === 0) {
      logger.warn('[ContentDrawer] Cannot export: no messages available', {
        contentType,
        messageCount: agentMessages?.length || 0,
      });
      return;
    }

    try {
      const agentName = localContent?.name || 'chat';

      // Clone messages to plain objects for IPC serialization
      // Svelte 5 proxies and reactive objects can't be cloned by Electron IPC
      const plainMessages = JSON.parse(JSON.stringify(agentMessages));

      const result = (await invoke(CHAT_EXPORT_CHANNELS.CHAT_TO_HTML, {
        messages: plainMessages,
        title: agentName,
      })) as { success?: boolean; canceled?: boolean; error?: string; filePath?: string };

      if (result.success) {
        logger.info('[ContentDrawer] Chat exported successfully', {
          filePath: result.filePath,
          messageCount: agentMessages.length,
        });
      } else if (result.canceled) {
        logger.info('[ContentDrawer] Export canceled by user');
      } else {
        logger.error('[ContentDrawer] Export failed', {
          error: result.error,
        });
      }
    } catch (error) {
      logger.error('[ContentDrawer] Failed to export chat', error);
    }
  }

  async function openInVSCode() {
    if (!localContent?.filePath) return;
    try {
      // For diffs, open in diff view using VSCode's -d flag
      if (contentType === 'diff' && localContent?.oldContent !== undefined) {
        // Create temp files for diff view
        const fileName = localContent.filePath.split('/').pop() || 'file';
        const oldFileName = `${fileName}.original`;
        const newFileName = `${fileName}.modified`;

        // Invoke IPC to create temp files and open diff
        await invoke('vscode:open-diff', {
          oldContent: localContent.oldContent,
          newContent: localContent.newContent,
          oldFileName,
          newFileName,
          filePath: localContent.filePath,
        });
      } else {
        // For regular files, open with folder context
        const folderPath = workspace?.worktreePath || workspace?.repositoryPath;
        if (folderPath) {
          await invoke('vscode:open', { folder: folderPath, file: localContent.filePath });
        } else {
          await invoke('vscode:open', localContent.filePath);
        }
      }
    } catch (error) {
      logger.error('Failed to open in VSCode:', error);
    }
  }

  async function openInFinder() {
    if (!localContent?.filePath) return;
    try {
      await invoke('shell:showItemInFolder', { path: localContent.filePath });
    } catch (error) {
      logger.error('Failed to open in Finder:', error);
    }
  }

  function getTitle(type: typeof contentType, data: typeof content) {
    switch (type) {
      case 'agent':
        return data?.name || 'Agent Chat';
      case 'diff':
        return data?.fileName || 'Code Changes';
      case 'file':
        return data?.fileName || 'File View';
      case 'notes':
        return 'Notes';
      case 'note':
        return data?.title || 'Note';
      case 'code':
        return 'Code History';
      case 'overview':
        return 'Overview';
      case 'terminal':
        return data?.title || 'Terminal';
      default:
        return 'Content';
    }
  }

  function getIcon(type: typeof contentType) {
    switch (type) {
      case 'agent':
        return faCommentDots;
      case 'diff':
        return faCodeBranch;
      case 'file':
        return faFileAlt;
      case 'notes':
        return faFileAlt;
      case 'note':
        return faFileAlt;
      case 'code':
        return faCode;
      case 'overview':
        return faStarOfLife;
      case 'terminal':
        return faTerminal;
      default:
        return faFileAlt;
    }
  }

  // Removed: getLanguageFromPath - now imported from $lib/utils/file-utils
</script>

<div
  class="w-full h-full flex flex-col pb-1 pt-4"
  data-testid="content-drawer"
  data-content-type={contentType}
  data-content-id={contentType === 'agent' ? localContent?.id : undefined}
  role="region"
  aria-label={getTitle(contentType, localContent)}
>
  {#if !hideHeader}
    <div class="h-(--panel-header-height) flex-none flex justify-between items-center min-w-0 px-5">
      {#if workspace}
        <div class="flex items-center flex-1 gap-px min-w-0">
          <div class="flex-1 flex items-center gap-1.5 min-w-0">
            {#if contentType === 'agent' && localContent?.id}
              <div class="relative">
                {#if isFollowing && agentColor}
                  <div
                    class="absolute inset-0 rounded-full animate-pulse"
                    style="box-shadow: 0 0 0 3px {agentColor.start}40"
                  ></div>
                {/if}
                <!-- {#key localContent?.id}
                  <AuggieAvatar
                    faceSeed={localContent?.id}
                    colorSeed={localContent?.id}
                    size={24}
                  />
                {/key} -->
              </div>
            {/if}

            <h2 class="text-sm font-semibold text-foreground m-0 truncate min-w-0 flex-1">
              {#if contentType === 'agent' && !isGenericAgentName(localContent?.name)}
                {localContent.name}
              {:else if contentType === 'agent' && localContent?.id}
                {localContent.name || generateRandomAgentName()}
              {:else if contentType === 'overview'}
                Overview
              {:else}
                <!-- {title} -->
              {/if}
            </h2>
            {#if isBackgroundAgent}
              <div
                class="px-1 py-0.5 text-[8px] font-bold bg-muted text-muted-foreground rounded mr-1"
              >
                BG
              </div>
            {/if}
          </div>

          {#if contentType === 'agent' && navigationState.userMessageCount > 0}
            <!-- Navigation controls for chat -->
            <div class="flex items-center">
              <!-- <Button
                onclick={() => {
                  if (chatPanelRef) {
                    if (navigationState.currentMessageIndex === 0 && !navigationState.isAtTop) {
                      chatPanelRef.scrollToTop();
                    } else if (chatPanelRef.navigateToPrevious) {
                      chatPanelRef.navigateToPrevious();
                    }
                  }
                }}
                disabled={navigationState.currentMessageIndex === 0 && navigationState.isAtTop}
                variant="ghost-light"
                size="icon-xs"
                title={navigationState.currentMessageIndex === 0 && !navigationState.isAtTop
                  ? 'Scroll to top'
                  : 'Previous message'}
              >
                <Fa
                  icon={navigationState.currentMessageIndex === 0 && !navigationState.isAtTop
                    ? faArrowUp
                    : faChevronUp}
                  size="10"
                />
              </Button> -->

              <!-- Message counter -->
              <!-- <div class="text-xs text-muted-foreground px-1">
            {navigationState.currentMessageIndex + 1} / {navigationState.userMessageCount}
          </div> -->

              <!-- <Button
                onclick={() => {
                  if (chatPanelRef) {
                    const isAtLast =
                      navigationState.currentMessageIndex === navigationState.userMessageCount - 1;
                    if (isAtLast && !navigationState.isAtBottom && chatPanelRef.scrollToBottom) {
                      chatPanelRef.scrollToBottom();
                    } else if (chatPanelRef.navigateToNext) {
                      chatPanelRef.navigateToNext();
                    }
                  }
                }}
                disabled={navigationState.currentMessageIndex ===
                  navigationState.userMessageCount - 1 && navigationState.isAtBottom}
                variant="ghost-light"
                size="icon-xs"
                class="-ml-1"
                title={navigationState.currentMessageIndex ===
                  navigationState.userMessageCount - 1 && !navigationState.isAtBottom
                  ? 'Scroll to bottom'
                  : 'Next message'}
              >
                <Fa
                  icon={navigationState.currentMessageIndex ===
                    navigationState.userMessageCount - 1 && !navigationState.isAtBottom
                    ? faArrowDown
                    : faChevronDown}
                  size="10"
                />
              </Button> -->
            </div>
          {/if}

          <!-- {#if contentType === "agent" && agentStatus !== "idle"}
        <span
          class="px-2 py-0.5 text-xs rounded-full {agentStatus === 'thinking'
            ? 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400'
            : agentStatus === 'running'
              ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400'
              : agentStatus === 'error'
                ? 'bg-red-500/20 text-red-600 dark:text-red-400'
                : 'bg-muted text-muted-foreground'}"
        >
          {agentStatus}
        </span>
      {/if} -->

          {#if contentType === 'file' && localContent?.filePath}
            <div class="flex items-center gap-2">
              {#if localContent?.onBack}
                <Button size="sm" variant="ghost" onclick={localContent.onBack} class="px-2">
                  <Fa icon={faChevronLeft} />
                  Back
                </Button>
              {/if}
              <Button
                size="sm"
                variant="default"
                onclick={saveFile}
                disabled={isSaving ||
                  editedContent === (localContent?.content || localContent?.newContent)}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
              <FileActionsDropdown
                filePath={localContent?.filePath || ''}
                {workspaceId}
                workspaceFolderPath={workspace?.worktreePath || workspace?.repositoryPath}
                variant="ghost"
                size="sm"
              />
              <Button
                size="sm"
                variant="ghost"
                onclick={openInVSCode}
                title="Open in VSCode"
                class="gap-1"
              >
                <VSCodeIcon size={16} />
                <span>Open in VSCode</span>
              </Button>
            </div>
          {/if}

          {#if contentType === 'diff' && localContent}
            <div class="flex items-center gap-2">
              {#if localContent?.onBack}
                <Button size="sm" variant="ghost" onclick={localContent.onBack} class="px-2">
                  <Fa icon={faChevronLeft} />
                  Back
                </Button>
              {/if}
              <Button
                size="sm"
                variant="default"
                onclick={saveFile}
                disabled={isSaving || editedContent === localContent?.newContent}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
              <FileActionsDropdown
                filePath={localContent?.filePath || ''}
                {workspaceId}
                workspaceFolderPath={workspace?.worktreePath || workspace?.repositoryPath}
                variant="ghost"
                size="sm"
              />
              <Button
                size="sm"
                variant="ghost"
                onclick={openInVSCode}
                title="Open in VSCode"
                class="gap-1"
              >
                <VSCodeIcon size={16} />
                <span>Open in VSCode</span>
              </Button>
              <LineChangesBadge
                additions={localContent.additions}
                deletions={localContent.deletions}
                size="xs"
                showIcons={true}
              />
            </div>
          {/if}

          {#if saveError}
            <div class="text-xs text-red-500">
              {saveError}
            </div>
          {/if}
        </div>

        <div class="flex items-center gap-1">
          {@render actions?.()}

          <!-- {#if contentType === 'agent' && agentId}
            <Button
              onclick={toggleFollow}
              variant="ghost-light"
              size="icon-xs"
              class="transition-all duration-200"
              style={isFollowing && agentColor
                ? `background: ${agentColor.gradient}; color: white; box-shadow: 0 0 0 2px ${agentColor.start}40;`
                : ''}
              title={isFollowing ? 'Stop Following' : 'Follow Agent'}
            >
              <Fa icon={isFollowing ? faEyeSlash : faEye} size="xs" />
            </Button>
          {/if} -->

          {#if (contentType === 'agent' && agentId) || ((contentType === 'agent' || contentType === 'terminal') && onDelete && localContent?.id)}
            <DropdownMenu align="end">
              {#snippet trigger({ toggle }: { toggle: () => void })}
                <Button
                  variant="ghost-light"
                  size="icon-xs"
                  onclick={toggle}
                  title="More actions"
                  class="-mr-1"
                >
                  <Fa icon={faEllipsisVertical} size="sm" />
                </Button>
              {/snippet}
              {#snippet content({ close }: { close: () => void })}
                {#if contentType === 'agent' && agentId}
                  <button
                    class="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-sm hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    onclick={() => {
                      handleCopyConversation();
                    }}
                    disabled={!agentMessages || agentMessages.length === 0}
                  >
                    <Fa icon={faCopy} class="w-3.5 h-3.5 opacity-60" />
                    <span>{isCopied ? 'Copied!' : 'Copy conversation'}</span>
                  </button>
                  <button
                    class="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-sm hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    onclick={async () => {
                      await handleExportAsHtml();
                      close();
                    }}
                    disabled={!agentMessages || agentMessages.length === 0}
                  >
                    <Fa icon={faFileExport} class="w-3.5 h-3.5 opacity-60" />
                    <span>Export as HTML</span>
                  </button>
                {/if}
                {#if (contentType === 'agent' || contentType === 'terminal') && onDelete && localContent?.id}
                  <button
                    class="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-sm hover:bg-muted hover:text-destructive-foreground transition-colors"
                    onclick={() => {
                      logger.info('[ContentDrawer] Delete button clicked for:', {
                        contentType,
                        id: localContent?.id,
                      });
                      close();
                      onDelete();
                    }}
                  >
                    <Fa icon={faTrash} class="w-3.5 h-3.5 opacity-60" />
                    <span>Delete {contentType}</span>
                  </button>
                {/if}
              {/snippet}
            </DropdownMenu>
          {/if}
          <Button variant="ghost-light" size="icon-xs" onclick={handleClose}>
            <Fa icon={faXmark} size="xs" />
          </Button>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Content -->
  <div class="flex-1 overflow-hidden relative mx-2 mt-0 mb-1.5">
    <!-- Content based on type -->
    {#if contentType === 'agent'}
      <div class="flex flex-col h-full {isFullWidth ? 'items-center' : ''}">
        <!-- Agent Chat Content (header moved to main drawer header) -->
        {#if workspace && localContent?.id}
          <div class="{isFullWidth ? 'w-full max-w-4xl' : 'w-full'} h-full">
            {#key stableAgentKey}
              <!-- Chat Panel - only mount when we have a valid agentId -->
              <ChatPanel
                bind:this={chatPanelRef}
                {workspace}
                agentId={agentId ? String(agentId) : ''}
                agentModel={agentModelForChat}
                isNewWorkspace={isNewWorkspaceSession}
                isInitialWorkspaceAgent={localContent?.isFirstWorkspaceAgent ||
                  localContent?.isInitialAgent}
                {initialPrompt}
                {draftPrompt}
                onFocus={() => {
                  logger.debug('[ContentDrawer] Chat panel focused');
                }}
                onChatUpdate={(update) => {
                  // Update navigation state
                  navigationState.userMessageCount = update.messageCount || 0;

                  // Update agent status
                  if (onAgentStatusChange) {
                    onAgentStatusChange(update.isProcessing ? 'thinking' : 'idle');
                  }
                }}
              />
            {/key}
          </div>
        {:else if isNewWorkspaceSession}
          <div class="px-3 py-7 w-full">
            <FirstAgentWelcome agentId={agentId ? String(agentId) : ''} />

            <!-- Show initial prompt optimistically while workspace is loading - no animation for instant display -->
            {#if initialPrompt}
              <DateSeparator label="Just now" />
              <ChatMessage
                message={{
                  id: 'pending-initial-message',
                  role: 'user',
                  timestamp: new Date(),
                  contentBlocks: [{ type: 'text', text: initialPrompt }],
                }}
                showTimestamp={false}
              />

              <!-- Show typing indicator while waiting for workspace/session -->
              <div class="mb-4">
                <StreamingTypingIndicator visible={true} />
              </div>
            {/if}
          </div>
          <!-- {localContent?.id}

              <ChatPanel
                {workspace}
                agentId={localContent?.id ? String(localContent.id) : ""}
                isNewWorkspace
                isInitialWorkspaceAgent
                onFocus={() => {
                  logger.debug("[ContentDrawer] Chat panel focused");
                }}
              /> -->
        {:else}
          <!-- Fallback for when no content is available in non-new spaces -->
          <!-- <div class="flex-1 flex items-center justify-center">
            <div class="text-muted-foreground">No space selected</div>
          </div> -->
        {/if}
      </div>
    {:else if contentType === 'overview'}
      <div class="w-full h-full overflow-hidden">
        <OverviewPanel
          agents={allAgents}
          terminals={terminalsList}
          {workspaceId}
          {onSelectAgent}
          {onSelectTerminal}
          {onCreateAgent}
          {onCreateTerminal}
          class="h-full"
        />
      </div>
    {:else if contentType === 'terminal' && localContent?.id && localContent.id.startsWith('terminal-')}
      <div class="w-full h-full overflow-hidden">
        {#key localContent.id}
          <Terminal terminalId={localContent.id} {workspaceId} class="h-full" />
        {/key}
      </div>
    {:else if contentType === 'file' && (localContent?.content || localContent?.content === '')}
      <div class="h-full overflow-hidden flex flex-col pl-5">
        <!-- Timeline context header (if viewing from timeline) -->
        {#if localContent?.timelineContext}
          <div class="px-6 py-3 border-b border-border bg-muted/20 flex-none">
            <div class="flex items-center gap-3 text-xs text-muted-foreground">
              {#if localContent.timelineContext.terminalName || localContent.timelineContext.sessionId}
                <div class="flex items-center gap-1">
                  <Fa icon={faTerminal} class="text-xs" />
                  <span
                    >{localContent.timelineContext.terminalName ||
                      localContent.timelineContext.sessionId}</span
                  >
                </div>
              {:else if localContent.timelineContext.source}
                <div class="flex items-center gap-1">
                  <span>via {localContent.timelineContext.source}</span>
                </div>
              {/if}
              {#if localContent.timelineContext.actor?.name}
                <span>by {localContent.timelineContext.actor.name}</span>
              {/if}
              {#if localContent.timelineContext.timestamp}
                <span
                  >{// Check if timestamp is already formatted (like "02:21:12 PM") or is a date string
                  localContent.timelineContext.timestamp.includes(':') &&
                  (localContent.timelineContext.timestamp.includes('AM') ||
                    localContent.timelineContext.timestamp.includes('PM'))
                    ? localContent.timelineContext.timestamp
                    : new Date(localContent.timelineContext.timestamp).toLocaleString()}</span
                >
              {/if}
            </div>
            {#if localContent.timelineContext.description}
              <p class="text-sm text-foreground mt-1 mb-0">
                {localContent.timelineContext.description}
              </p>
            {/if}
          </div>
        {/if}

        <div class="flex-1 overflow-hidden">
          {#key localContent?.filePath}
            <CodeEditor
              bind:value={editedContent}
              originalValue={localContent?.oldContent}
              language={localContent?.language || getLanguageFromPath(localContent?.filePath || '')}
              readOnly={false}
              lineNumbers={true}
              diffMode={!!localContent?.oldContent}
            />
          {/key}
        </div>
      </div>
    {:else if contentType === 'diff' && localContent}
      <div class="h-full overflow-hidden flex flex-col pl-5">
        <!-- Timeline context header -->
        {#if localContent?.timelineContext}
          <div class="px-6 py-3 border-b border-border bg-muted/20 flex-none">
            <div class="flex items-center gap-3 text-xs text-muted-foreground">
              {#if localContent.timelineContext.terminalName || localContent.timelineContext.sessionId}
                <div class="flex items-center gap-1">
                  <Fa icon={faTerminal} class="text-xs" />
                  <span
                    >{localContent.timelineContext.terminalName ||
                      localContent.timelineContext.sessionId}</span
                  >
                </div>
              {:else if localContent.timelineContext.source}
                <div class="flex items-center gap-1">
                  <span>via {localContent.timelineContext.source}</span>
                </div>
              {/if}
              {#if localContent.timelineContext.actor?.name}
                <span>by {localContent.timelineContext.actor.name}</span>
              {/if}
              {#if localContent.timelineContext.timestamp}
                <span
                  >{// Check if timestamp is already formatted (like "02:21:12 PM") or is a date string
                  localContent.timelineContext.timestamp.includes(':') &&
                  (localContent.timelineContext.timestamp.includes('AM') ||
                    localContent.timelineContext.timestamp.includes('PM'))
                    ? localContent.timelineContext.timestamp
                    : new Date(localContent.timelineContext.timestamp).toLocaleString()}</span
                >
              {/if}
            </div>
            {#if localContent.timelineContext.description}
              <p class="text-sm text-foreground mt-1 mb-0">
                {localContent.timelineContext.description}
              </p>
            {/if}
          </div>
        {/if}

        <div class="flex-1 overflow-hidden">
          {#if localContent?.timelineContext}
            <!-- Use unified diff viewer for timeline entries to show only specific changes -->
            <UnifiedDiffViewer
              oldContent={localContent?.oldContent || ''}
              newContent={localContent?.newContent || ''}
              fileName={localContent?.fileName || ''}
              height="100%"
            />
            <!-- {:else if localContent?.diffChunks && localContent.diffChunks.length > 0} -->
            <!-- Use provenance-aware diff viewer if we have provenance data -->
            <!-- <DiffViewerWithProvenanceAnnotations
              oldContent={localContent?.oldContent || ""}
              newContent={editedContent}
              fileName={localContent?.fileName || ""}
              filePath={localContent?.filePath || ""}
              diffChunks={localContent.diffChunks}
              {onNavigateToAgent}
            /> -->
          {:else if localContent?.oldContent !== undefined && localContent?.newContent !== undefined}
            <!-- Fallback to regular code editor with diff mode -->
            <CodeEditor
              bind:value={editedContent}
              originalValue={localContent.oldContent}
              language={getLanguageFromPath(localContent?.filePath || '')}
              readOnly={false}
              lineNumbers={true}
              diffMode={true}
            />
          {:else}
            <!-- Show regular editor if we only have one version of the content -->
            <CodeEditor
              bind:value={editedContent}
              language={getLanguageFromPath(localContent?.filePath || '')}
              readOnly={false}
              lineNumbers={true}
            />
          {/if}
        </div>
      </div>
    {:else if contentType === 'notes' && localContent}
      <div class="p-6 space-y-4">
        {#if localContent?.notes && localContent.notes.length > 0}
          {#each localContent.notes as note, noteIndex (`note-${noteIndex}-${note.id || note.timestamp || noteIndex}`)}
            <div class="rounded-lg border border-border bg-muted/30 p-4">
              <div class="text-xs text-muted-foreground mb-2">
                {note.timestamp || new Date().toLocaleString()}
              </div>
              <div class="text-sm whitespace-pre-wrap">
                {note.content}
              </div>
            </div>
          {/each}
        {:else}
          <div class="text-center text-muted-foreground py-8">No notes yet</div>
        {/if}
      </div>
    {:else if contentType === 'note' && localContent}
      <div class="p-6">
        <div class="space-y-4">
          <!-- Note metadata -->
          <div class="flex items-start justify-between">
            <div>
              <h2 class="text-xl font-semibold text-foreground">
                {localContent?.title || 'Untitled Note'}
              </h2>
              <div class="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                {#if localContent?.author}
                  <span class="flex items-center gap-1">
                    <Fa icon={faCommentDots} class="w-3 h-3" />
                    {localContent.author.name || 'Unknown'}
                  </span>
                {/if}
                {#if localContent?.updated_at}
                  <span>
                    Updated: {new Date(localContent.updated_at).toLocaleString()}
                  </span>
                {/if}
              </div>
            </div>
            <div class="flex gap-2">
              {#if localContent?.is_pinned}
                <div class="text-yellow-500">📌</div>
              {/if}
              {#if localContent?.is_archived}
                <div class="text-muted-foreground">📦</div>
              {/if}
            </div>
          </div>

          <!-- Tags -->
          {#if localContent?.tags && localContent.tags.length > 0}
            <div class="flex flex-wrap gap-2">
              {#each localContent.tags as tag, tagIndex (`tag-${tagIndex}-${tag}`)}
                <span class="px-2 py-1 text-xs rounded-full bg-primary/10 text-primary">
                  {tag}
                </span>
              {/each}
            </div>
          {/if}

          <!-- Note content -->
          <div class="prose prose-sm dark:prose-invert max-w-none">
            <div class="whitespace-pre-wrap text-sm text-foreground">
              {localContent?.content || 'No content'}
            </div>
          </div>

          <!-- Note metadata footer -->
          {#if localContent?.metadata}
            <div class="pt-4 border-t border-border text-xs text-muted-foreground">
              {#if localContent.metadata.word_count}
                <span>{localContent.metadata.word_count} words</span>
                <span class="mx-2">•</span>
              {/if}
              {#if localContent.metadata.read_time_minutes}
                <span>{Math.ceil(localContent.metadata.read_time_minutes)} min read</span>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    {:else if contentType === 'code' && localContent}
      <div class="p-6 space-y-6">
        {#if localContent?.blocks && localContent.blocks.length > 0}
          {#each localContent.blocks as block, blockIndex (`code-${blockIndex}-${block.fileName || ''}-${(block.code || '')
            .slice(0, 20)
            .split('')
            .reduce((a: number, c: string) => a + c.charCodeAt(0), 0)}`)}
            <div>
              {#if block.description}
                <div class="text-sm text-muted-foreground mb-2">
                  {block.description}
                </div>
              {/if}
              <CodeBlock
                code={block.code}
                language={block.language || 'plaintext'}
                fileName={block.fileName}
                showLineNumbers={true}
              />
            </div>
          {/each}
        {:else}
          <div class="text-center text-muted-foreground py-8">No code history yet</div>
        {/if}
      </div>
    {:else}
      <div class="p-6 text-center text-muted-foreground">No content available</div>
    {/if}
  </div>
</div>
