/**
 * Unified Agent Factory
 *
 * Single, clean agent creation service consolidating all creation methods.
 * Uses Wave 1 foundations: branded IDs, type validation, IPC contracts.
 *
 * WAVE 2 REFACTOR: Consolidates 6+ creation methods into one unified interface.
 */

import { v4 as uuidv4 } from 'uuid';
import { createMessageId, createAgentId } from '$shared/types/branded-ids';
import { unifiedIdService } from '$shared/services/unified-id.service';
import type { Workspace, AgentSession, ContentBlock } from '$shared/types';
import { AgentStatus } from '$shared/types';
import { Logger } from '$shared/logger';
import type { AgentId, WorkspaceId as BrandedWorkspaceId } from '$shared/types/branded-ids';
import { typedInvoke } from '$shared/ipc/typed-invoke';
import { agentValidator } from './agent-validator';
import type { AgentIpc } from '$shared/ipc/contracts';
import { AGENT_CHANNELS, AGENT_BACKEND_CHANNELS } from '$shared/ipc/channels';
import { generateAgentNameFromText } from '$lib/utils/agent-name-generator';
import { DEFAULT_AGENT_MODEL } from '$shared/constants/agent-services';
import { track } from '$lib/services/analytics';
import {
  getDefaultModelForProvider,
  getDefaultProviderId,
  isModelValidForProvider,
  parseCompoundModelId,
  PROVIDER_MODEL_TIERS,
} from '$shared/config/provider-config';

const logger = new Logger('UnifiedAgentFactory');

// Detect if we're running in the backend (Node.js) or frontend (browser)
const isBackend = typeof window === 'undefined';

// Lazy-loaded frontend modules
let agentStateModule: any = null;
let sessionStoreModule: any = null;
let sessionStoreDataModule: any = null;
let invokeFunction: any = null;
let persistenceServiceModule: any = null;


// Lazy-load frontend modules only when needed
async function getUnifiedStateStore() {
  if (!agentStateModule && !isBackend) {
    const module = await import('$features/agent/services/unified-state-store');
    agentStateModule = module.unifiedStateStore;
  }
  return agentStateModule;
}

async function getSessionStore() {
  if (!sessionStoreModule && !isBackend) {
    const module = await import('$features/agent/browser');
    sessionStoreModule = module.sessionStore;
  }
  return sessionStoreModule;
}

async function getSessionStoreData() {
  if (!sessionStoreDataModule && !isBackend) {
    const module = await import('$features/agent/browser');
    sessionStoreDataModule = module.sessionStoreData;
  }
  return sessionStoreDataModule;
}

async function getInvoke() {
  if (!invokeFunction && !isBackend) {
    const module = await import('$lib/electron-bridge');
    invokeFunction = module.invoke;
  }
  return invokeFunction;
}

async function getPersistenceService() {
  if (!persistenceServiceModule && !isBackend) {
    const module = await import('../browser');
    persistenceServiceModule = module.persistenceService;
  }
  return persistenceServiceModule;
}

async function getActiveProviderId(): Promise<string | null> {
  if (isBackend) return null;
  try {
    const { getReduxStore } = await import('$lib/store/redux-dispatch-bridge');
    const { selectActiveProviderId } = await import('$lib/store/slices/active-provider/active-provider-selectors');
    const store = getReduxStore();
    return selectActiveProviderId.select(store.getState());
  } catch {
    return null;
  }
}

// Note: Rules loading is handled differently in main vs renderer process
// Main process: Uses config-cache.service directly
// Renderer process: Uses IPC to get rules from main process

/**
 * Unified agent configuration
 * Consolidates all creation method parameters into one interface
 *
 * IMPORTANT: Use agentType (branded AgentTypeId) to let backend build system prompt.
 * Import createAgentTypeId from '$shared/types/agent.types' and use it to create the branded type.
 *
 * DO NOT pass systemPrompt or rules - these are DEPRECATED and ignored.
 * The backend builds the complete system prompt from agentType via InstructionService.
 *
 * Agent naming follows the VS Code webview pattern:
 * - If `name` is provided, it's used (with sanitization)
 * - If `name` is empty but `initialMessage` is present, name is derived from the message
 * - Otherwise, a default name is generated based on workspace title
 */
export interface UnifiedAgentConfig {
  // Required
  workspaceId: BrandedWorkspaceId;

  // Optional - name is derived from initialMessage if not provided
  name?: string;

  // Optional
  id?: string; // Allow passing in a pre-generated agent ID
  model?: string;
  provider?: string; // Provider ID (e.g., 'auggie', 'claude-code', 'codex') - from activeProviderStore.activeProviderId
  systemPrompt?: string; // System prompt for the agent (built from agentType)
  initialMessage?: string;
  contextReferences?: any[];
  metadata?: Record<string, any>;
  messages?: any[]; // For resuming existing sessions with message history

  // Behavior configuration
  behaviorPrompt?: string; // Custom behavior instructions for the agent (from specialist)

  // Workspace context (open panels + linked references)
  workspaceContext?: {
    openPanels: Array<{ type: string; title: string; id?: string; path?: string }>;
    linkedReferences: Array<{
      type: string;
      title: string;
      identifier?: string;
      url?: string;
    }>;
  };

  // Source tracking
  source?:
    | 'workspace-initializer'
    | 'contextual-menu'
    | 'chat-panel'
    | 'api'
    | 'background-agent-trigger'
    | 'workspace-page'
    | 'workspace-sidebar'
    | 'error-console'
    | 'error-notification'
    | 'agent-launch-menu'
    | 'bubble-menu'
    | 'specialist-picker'
    | string; // Allow any string for flexibility
  agentType?: import('$shared/types/agent.types').AgentTypeId; // Must be branded type
}

/**
 * Normalized agent configuration with guaranteed name
 * This is the result of normalizeConfig() which always provides a name
 */
type NormalizedAgentConfig = Omit<UnifiedAgentConfig, 'name'> & { name: string };

/**
 * Result of agent creation
 * Note: streamId is no longer included - agentId is the canonical key for streams
 */
export interface CreateAgentResult {
  success: boolean;
  agent?: AgentSession;
  error?: string;
  agentId?: AgentId;
  sessionId?: AgentId;
}

/**
 * Unified Agent Factory - Single, clean agent creation service
 *
 * Consolidates all creation methods (createAgent, createInitialAgent, createContextualAgent)
 * into one unified interface with proper validation and error handling.
 */
export class UnifiedAgentFactory {
  private static instance: UnifiedAgentFactory;

  private constructor() {}

  static getInstance(): UnifiedAgentFactory {
    if (!UnifiedAgentFactory.instance) {
      UnifiedAgentFactory.instance = new UnifiedAgentFactory();
    }
    return UnifiedAgentFactory.instance;
  }

  /**
   * Clear the rules cache (call when workspace changes)
   * Clears rules cache in the appropriate context
   */
  clearCache(): void {
    // Rules are now cached in CachedRulesService (backend)
    // Cache invalidation is handled automatically via file watching
    // No manual cache clearing needed
    logger.debug('Rules cache is managed by CachedRulesService with automatic invalidation');
  }

  /**
   * Create a new agent with clean, predictable flow
   *
   * This is the ONLY public creation method. All creation paths go through here.
   * Consolidates: createAgent, createInitialAgent, createContextualAgent
   */
  async createAgent(workspace: Workspace, config: UnifiedAgentConfig): Promise<CreateAgentResult> {
    const startTime = Date.now();
    const metrics = {
      validationTime: 0,
      idGenerationTime: 0,
      backendCreationTime: 0,
      stateUpdateTime: 0,
      totalTime: 0,
    };

    // Log incoming request
    logger.debug('Agent creation request received', {
      source: config.source || 'unknown',
      agentType: config.agentType,
      workspaceId: workspace?.id,
      hasInitialMessage: !!config.initialMessage,
      hasContextReferences: !!config.contextReferences?.length,
    });

    try {
      // Step 1: Validate workspace
      const validationStart = Date.now();
      if (!workspace?.id) {
        logger.error('Invalid workspace: missing ID');
        return {
          success: false,
          error: 'Invalid workspace: missing ID',
        };
      }

      // Step 1.5: Circuit breaker check - prevent runaway agent spawn loops
      try {
        const { agentCircuitBreaker } = await import('$shared/services/agent-circuit-breaker');
        const circuitCheck = agentCircuitBreaker.canProceed(workspace.id);
        if (!circuitCheck.allowed) {
          logger.error('Agent creation blocked by circuit breaker', {
            workspaceId: workspace.id,
            reason: circuitCheck.reason,
            status: circuitCheck.status,
          });
          return {
            success: false,
            error: `Agent creation blocked: ${circuitCheck.reason}`,
          };
        }
        // Record the agent start
        agentCircuitBreaker.recordAgentStart(workspace.id, config.id || 'pending');
      } catch (e) {
        // Circuit breaker failure should not block agent creation
        logger.warn('Circuit breaker check failed, proceeding with agent creation', { error: e });
      }

      // Step 2: Validate configuration BEFORE normalization to catch invalid characters
      // First validate the raw config to check for invalid characters
      const preValidation = agentValidator.validateConfig(config);
      if (!preValidation.valid) {
        // Check if the error is specifically about invalid characters in the name
        const invalidCharError = preValidation.errors?.find((err) =>
          err.includes('invalid characters'),
        );
        if (invalidCharError) {
          logger.error('Configuration validation failed', {
            errors: preValidation.errors,
            config,
          });
          return {
            success: false,
            error: preValidation.errors?.join(', ') || 'Invalid configuration',
          };
        }
      }

      // Step 3: Normalize configuration (sanitizes names, etc.)
      // If no name provided, normalizeConfig will generate one from the initial message.
      // The agent can update its own name later if needed.
      const normalized = this.normalizeConfig(workspace, config);

      // Step 3.5: Fetch workspace context (open panels + linked references)
      // This ensures agents are aware of what the user is looking at and what's linked
      if (!normalized.workspaceContext && !isBackend) {
        try {
          const workspaceContext: {
            openPanels: Array<{ type: string; title: string; id?: string; path?: string }>;
            linkedReferences: Array<{
              type: string;
              title: string;
              identifier?: string;
              url?: string;
            }>;
          } = {
            openPanels: [],
            linkedReferences: [],
          };

          // Get open panels from panel layout manager
          // IMPORTANT: Only access the panel layout manager if it already exists in cache.
          // This prevents prematurely initializing the layout when creating an agent from
          // the home page (before the workspace page is loaded). If we initialize the layout
          // here, it may load stale data from localStorage, causing duplicate tabs.
          try {
            const { getPanelLayoutManager, hasPanelLayoutManager } =
              await import('$features/layout/panel-layout-manager.svelte');
            // Only access panel layout if the workspace page has already initialized it
            if (hasPanelLayoutManager(workspace.id)) {
              const layoutManager = getPanelLayoutManager(workspace.id);
              const allTabs = layoutManager.allOpenTabs;
              workspaceContext.openPanels = allTabs
                .filter((tab) => tab.type !== 'agent') // Don't include agent tabs
                .map((tab) => ({
                  type: tab.type,
                  title: tab.title,
                  id: tab.noteId || tab.terminalId || tab.agentId,
                  path: tab.filePath || tab.browserUrl,
                }));
            } else {
              logger.debug(
                'Panel layout manager not yet initialized, skipping open panels context',
              );
            }
          } catch (error) {
            logger.debug('Could not load open panels', { error });
          }

          // Get linked references from context store
          try {
            const { contextStore } = await import('$features/context/context.store.svelte');
            contextStore.setWorkspace(workspace.id);
            const topLevelItems = contextStore.getTopLevelItems();
            workspaceContext.linkedReferences = topLevelItems.map((item) => {
              let identifier: string | undefined;
              if (item.type === 'linear-issue') {
                identifier = (item as import('$features/context/types').LinearIssueContextItem)
                  .identifier;
              } else if (item.type === 'github-issue') {
                const ghItem = item as import('$features/context/types').GitHubIssueContextItem;
                identifier = `${ghItem.repo}#${ghItem.number}`;
              } else if (item.type === 'sentry-issue') {
                identifier = (item as import('$features/context/types').SentryIssueContextItem)
                  .shortId;
              }
              return {
                type: item.type,
                title: item.title,
                identifier,
                url: item.url,
              };
            });
          } catch (error) {
            logger.debug('Could not load linked references', { error });
          }

          // Only set if we have any context
          if (
            workspaceContext.openPanels.length > 0 ||
            workspaceContext.linkedReferences.length > 0
          ) {
            normalized.workspaceContext = workspaceContext;
            logger.debug('Workspace context loaded', {
              workspaceId: workspace.id,
              openPanelsCount: workspaceContext.openPanels.length,
              linkedReferencesCount: workspaceContext.linkedReferences.length,
            });
          }
        } catch (error) {
          logger.debug('Could not load workspace context', { error });
        }
      }

      // Step 4: Validate normalized configuration for other requirements
      const validation = agentValidator.validateConfig(normalized);
      if (!validation.valid) {
        logger.error('Configuration validation failed', {
          errors: validation.errors,
          config: normalized,
        });
        return {
          success: false,
          error: validation.errors?.join(', ') || 'Invalid configuration',
        };
      }
      metrics.validationTime = Date.now() - validationStart;

      // Step 5: Generate IDs using unified service (or use provided ID)
      // Note: streamId is no longer generated - agentId is the canonical key for streams
      // Note: sessionId is typed as AgentId in the codebase (not SessionId), so we use generateAgentId()
      const idGenStart = Date.now();
      const agentId = config.id ? createAgentId(config.id) : unifiedIdService.generateAgentId();
      const sessionId = unifiedIdService.generateAgentId();
      metrics.idGenerationTime = Date.now() - idGenStart;

      // Debug logging to track ID usage
      if (config.id) {
        logger.info('📌 Using provided agent ID', { providedId: config.id, agentId });
      } else {
        logger.info('🆕 Generated new agent ID', { agentId });
      }

      logger.info('📋 Creating agent with configuration', {
        agentId,
        sessionId,
        workspaceId: workspace.id,
        name: normalized.name,
        source: normalized.source,
        model: normalized.model,
        agentType: normalized.agentType,
      });

      // Step 6: Get workspace path for rules loading
      // Priority: worktreePath (git working directory) > path (workspace-specific) > repositoryPath (fallback)
      const workspacePath = workspace.worktreePath || workspace.path || workspace.repositoryPath;

      // Step 6.5: Determine provider early (needed for model resolution)
      // Determine provider: use explicit config.provider, or get from Redux active-provider slice
      let provider = config.provider;
      if (!provider && !isBackend) {
        const activeId = await getActiveProviderId();
        if (activeId) {
          provider = activeId;
          logger.debug('Using active provider from store', { provider });
        }
      }

      // Step 6.6: Resolve model with provider-aware default
      // If no model provided, use the provider's default 'balanced' tier model.
      // Only resolve for providers with known tier mappings — providers with dynamic
      // model lists (e.g. opencode) would produce invalid compound IDs.
      let resolvedModel = normalized.model;
      if (!resolvedModel && provider && provider in PROVIDER_MODEL_TIERS) {
        const baseModel = getDefaultModelForProvider(provider, 'balanced');
        const defaultProviderId = getDefaultProviderId();
        // Prefix with provider ID for non-default providers (matches model store behavior)
        resolvedModel = provider !== defaultProviderId ? `${provider}:${baseModel}` : baseModel;
        logger.debug('Using provider-aware default model', {
          provider,
          baseModel,
          resolvedModel,
        });
      }
      // Final fallback to DEFAULT_AGENT_MODEL (only for backend or when no provider)
      if (!resolvedModel) {
        resolvedModel = DEFAULT_AGENT_MODEL;
      }

      // Step 6.8: Safety-net — reject cross-provider compound model IDs.
      // If the resolved model is a compound ID whose provider prefix doesn't match
      // the target provider, log a warning and re-resolve to the provider's default.
      // This catches edge cases where an LLM-supplied or inherited model slips through
      // earlier validation (e.g., "codex:opencode/big-pickle").
      if (resolvedModel && provider && resolvedModel.includes(':')) {
        if (!isModelValidForProvider(resolvedModel, provider)) {
          const { providerId: modelProvider } = parseCompoundModelId(resolvedModel);
          logger.warn('Safety net: cross-provider model mismatch in agent creation', {
            resolvedModel,
            modelProvider,
            expectedProvider: provider,
          });
          if (provider in PROVIDER_MODEL_TIERS) {
            const baseModel = getDefaultModelForProvider(provider, 'balanced');
            const defaultProviderId = getDefaultProviderId();
            resolvedModel = provider !== defaultProviderId ? `${provider}:${baseModel}` : baseModel;
            logger.debug('Re-resolved model to provider default', { resolvedModel });
          }
          // If provider has no tier mappings (e.g., opencode), keep resolvedModel as-is.
          // We cannot safely guess a model for dynamic-model providers.
        }
      }

      // Step 7: Create agent session object (system prompt will be built by backend)
      const agent: AgentSession = {
        id: agentId,
        backendSessionId: sessionId,
        workspaceId: workspace.id as BrandedWorkspaceId,
        name: normalized.name,
        status: AgentStatus.Active,
        messages: [],
        model: resolvedModel,
        provider, // Top-level ACP provider — immutable after creation
        // systemPrompt is built by backend, not included in frontend agent object
        createdAt: new Date(),
        updatedAt: new Date(),
        isStreaming: false,
        isProcessing: false,
        metadata: {
          agentType: normalized.agentType,
          ...(normalized.metadata || {}),
          // Only set source if it's not already in metadata
          ...(normalized.source && !normalized.metadata?.source
            ? { source: normalized.source }
            : {}),
        },
      };

      // Step 7: Validate workspace path for backend operations
      if (!workspacePath) {
        return {
          success: false,
          error: 'Workspace does not have a valid path',
          agentId,
          sessionId,
        };
      }

      // Step 8: Create agent in backend via IPC (only in frontend)
      if (!isBackend) {
        const backendStart = Date.now();

        const backendResult = await this.createInBackend(
          agent,
          workspacePath,
          normalized.behaviorPrompt,
          normalized.workspaceContext,
          provider,
        );
        metrics.backendCreationTime = Date.now() - backendStart;

        if (!backendResult.success) {
          // Special handling for task-focused agents when agent already exists
          const isTaskAgent =
            normalized.metadata?.agentType === 'task-focused' ||
            normalized.metadata?.source === 'task-menu' ||
            normalized.metadata?.source === 'bubble-menu';

          if (isTaskAgent && backendResult.error?.includes('already exists')) {
            logger.info('Task-focused agent collision detected, retrying with new ID', {
              originalAgentId: agentId,
              error: backendResult.error,
            });

            // Generate a new ID with timestamp to ensure uniqueness
            const newAgentId = `agent-task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

            // Retry with the new ID
            const retryConfig = {
              ...config,
              id: newAgentId,
              metadata: {
                ...config.metadata,
                __originalId: agentId,
                __retryAttempt: true,
              },
            };

            // Recursive call with new ID
            return this.createAgent(workspace, retryConfig);
          }

          logger.error('Backend agent creation failed', {
            error: backendResult.error,
            agentId,
            duration: metrics.backendCreationTime,
          });
          return {
            success: false,
            error: backendResult.error,
            agentId,
            sessionId,
          };
        }
      }

      logger.debug('Backend agent created', {
        agentId,
        backendCreationTime: metrics.backendCreationTime,
      });

      // Step 8: Update frontend state
      const stateUpdateStart = Date.now();
      // Note: AgentState wrapper is created internally by sessionStore.addSession()
      // which calls unifiedStateStore.setAgent with the proper structure

      // Only update frontend state if we're in the frontend
      if (!isBackend) {
        const sessionStore = await getSessionStore();
        // Only use sessionStore.addSession - it internally calls unifiedStateStore.setAgent
        // and also notifies subscribers. Calling both would cause duplicate updates.
        if (sessionStore) {
          sessionStore.addSession(agent);
        }
      }
      metrics.stateUpdateTime = Date.now() - stateUpdateStart;

      // Agent is now registered in state

      // Step 9: Set streaming state BEFORE sending initial message
      // This ensures ChatPanel sees streaming state immediately when it mounts
      if (normalized.initialMessage) {
        if (!isBackend) {
          const sessionStore = await getSessionStore();

          // Set streaming state using sessionStore.setStreamingForWorkspace which properly updates
          // the streaming state. We use the explicit workspaceId variant to avoid relying on
          // currentWorkspace which may be null in certain timing scenarios.
          if (sessionStore) {
            sessionStore.setStreamingForWorkspace(agent.workspaceId, agent.id, true);
          }

          logger.info('Set streaming state to true BEFORE sending initial message', {
            agentId: agent.id,
            inSessionStore: !!sessionStore,
          });
        }
      }

      // Step 10: Add user message to state BEFORE sending to backend
      // This ensures the UI shows the user message immediately
      // Handle both cases: when there's a message, or when there are only context references
      const hasInitialMessage = !!normalized.initialMessage?.trim();
      const hasContextReferences = (normalized.contextReferences?.length ?? 0) > 0;

      if ((hasInitialMessage || hasContextReferences) && !isBackend) {
        const sessionStore = await getSessionStore();
        if (sessionStore) {
          // If no text message but we have context references, generate a placeholder
          let messageText = normalized.initialMessage?.trim() || '';
          if (!messageText && hasContextReferences) {
            messageText =
              'I have linked some context above. Please review it and help me with this task.';
          }

          const userMessage = {
            id: createMessageId(`msg_${uuidv4()}`),
            role: 'user' as const,
            contentBlocks: [{ type: 'text' as const, text: messageText }],
            timestamp: new Date().toISOString(),
            // Include contextReferences in metadata so they display as pills in ChatMessage
            metadata: hasContextReferences
              ? { contextReferences: normalized.contextReferences }
              : {},
          };
          sessionStore.addMessage(agent.id, userMessage);
          logger.info('Added user message to state before sending', {
            agentId: agent.id,
            messageId: userMessage.id,
            hasContextReferences,
          });

          // Save the session immediately after adding the user message
          // This ensures the message persists even if the app crashes or refreshes
          try {
            const session = sessionStore.getSession(agent.id);
            if (session) {
              const persistenceService = await getPersistenceService();
              if (persistenceService) {
                await persistenceService.saveSession(session, agent.workspaceId, {
                  immediate: true,
                });
                logger.info('Saved initial user message to disk', {
                  agentId: agent.id,
                  messageId: userMessage.id,
                });
              }
            }
          } catch (error) {
            logger.warn('Failed to save initial user message to disk', {
              agentId: agent.id,
              error: error instanceof Error ? error.message : String(error),
            });
            // Don't fail the whole operation if persistence fails
          }
        }
      }

      // Step 11: Send initial message if provided (or if there are context references)
      if (hasInitialMessage || hasContextReferences) {
        // Build the message to send - use text if provided, otherwise generate placeholder
        let messageToSend = normalized.initialMessage?.trim() || '';
        if (!messageToSend && hasContextReferences) {
          messageToSend =
            'I have linked some context above. Please review it and help me with this task.';
        }

        logger.info('📨 Sending initial message', {
          agentId: agent.id,
          messageLength: messageToSend.length,
          contextReferencesCount: normalized.contextReferences?.length || 0,
        });
        // Send initial message asynchronously so drawer can open immediately
        // Don't await - let it run in the background
        // The ChatPanel will set up streaming handlers immediately on mount
        this.sendInitialMessage(agent, messageToSend, normalized.contextReferences).catch(
          (error) => {
            logger.error('Failed to send initial message', error);
          },
        );
      }

      // Calculate total metrics
      metrics.totalTime = Date.now() - startTime;

      // Log comprehensive success metrics
      logger.info('🎉 Agent created successfully', {
        agentId: agent.id,
        sessionId,
        source: normalized.source,
        agentType: normalized.agentType,
        metrics: {
          ...metrics,
          hasInitialMessage: !!normalized.initialMessage,
          contextReferencesCount: normalized.contextReferences?.length || 0,
        },
      });

      // Performance warning if creation took too long
      if (metrics.totalTime > 500) {
        logger.warn('Agent creation exceeded performance threshold', {
          agentId: agent.id,
          totalTime: metrics.totalTime,
          threshold: 500,
          breakdown: metrics,
        });
      }

      // Success - agent created

      // Track agent creation
      track('Created Agent', {
        agent_id: agent.id,
        workspace_id: agent.workspaceId,
        agent_name: agent.name,
        agent_model: agent.model,
        source: normalized.source,
      });

      return {
        success: true,
        agent,
        agentId,
        sessionId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to create agent', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        config,
        duration: Date.now() - startTime,
      });

      // Failure - log error

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Normalize configuration to ensure all required fields are present
   *
   * Note: All agent creation now goes through createAgent() method.
   * Use appropriate source parameter: "workspace-initializer", "contextual-menu", etc.
   */
  private normalizeConfig(workspace: Workspace, config: UnifiedAgentConfig): NormalizedAgentConfig {
    // Normalize name: provide default if empty, derive from initialMessage if possible
    let normalizedName = config.name?.trim() || '';

    if (normalizedName.length === 0) {
      // Try to derive name from initialMessage (like VS Code webview does)
      if (config.initialMessage && config.initialMessage.trim().length > 0) {
        normalizedName = generateAgentNameFromText(config.initialMessage);
      } else {
        // Fallback to generic "Agent" name (callers should provide specialist-based names)
        normalizedName = 'Agent';
      }
    } else {
      // Sanitize the provided name using the same utility
      normalizedName = generateAgentNameFromText(normalizedName);
    }

    return {
      name: normalizedName,
      workspaceId: config.workspaceId || (workspace.id as BrandedWorkspaceId),
      model: config.model, // Don't set default here - createAgent handles provider-aware defaults
      provider: config.provider, // Preserve provider for propagation to session
      initialMessage: config.initialMessage,
      contextReferences: config.contextReferences || [],
      metadata: config.metadata || {},
      source: config.source || 'api',
      agentType: config.agentType,
      behaviorPrompt: config.behaviorPrompt, // Preserve behavior prompt from specialist
    };
  }

  /**
   * REMOVED: buildSystemPromptWithRules(), loadBaseSystemPrompt(), loadDefaultRulesForAgentType()
   *
   * These methods were dead code - never called in production.
   *
   * System prompts are now ONLY built by the backend via InstructionService.buildSystemPrompt()
   * which is called in agent-backend-handler.service.ts when creating agents.
   *
   * InstructionService provides:
   * - 3-tier fallback: user customizations → workspace files → bundled defaults
   * - Proper caching and file watching
   * - Consistent behavior across all agent types
   *
   * See AGENT_LAUNCHING_ANALYSIS.md for details.
   */

  /**
   * Create agent in backend via IPC
   * Uses Wave 1 IPC contracts for type safety
   * Backend will build system prompt from agentType via InstructionService
   */
  private async createInBackend(
    agent: AgentSession,
    workspacePath: string,
    behaviorPrompt?: string,
    workspaceContext?: {
      openPanels: Array<{ type: string; title: string; id?: string; path?: string }>;
      linkedReferences: Array<{
        type: string;
        title: string;
        identifier?: string;
        url?: string;
      }>;
    },
    provider?: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Build IPC request using Wave 1 contracts
      const request: AgentIpc.CreateRequest = {
        workspaceId: agent.workspaceId,
        workspacePath,
        name: agent.name,
        agentId: agent.id, // Pass the frontend-generated agent ID to backend
        model: agent.model,
        provider, // Provider ID (e.g., 'auggie', 'claude-code', 'codex') from activeProviderStore
        agentType: agent.metadata?.agentType, // Backend builds system prompt from this
        behaviorPrompt, // Custom behavior instructions from specialist
        metadata: agent.metadata,
        workspaceContext, // Open panels + linked references for agent context
      };

      logger.info('📤 Sending to backend via IPC', {
        agentId: agent.id,
        model: request.model,
        provider: request.provider,
        hasBehaviorPrompt: !!request.behaviorPrompt,
        behaviorPromptLength: request.behaviorPrompt?.length || 0,
        agentType: request.agentType,
        openPanelsCount: workspaceContext?.openPanels.length || 0,
        linkedReferencesCount: workspaceContext?.linkedReferences.length || 0,
      });

      const result = await typedInvoke(AGENT_CHANNELS.CREATE, request);

      if (!result.success) {
        return {
          success: false,
          error: result.error?.message || 'Failed to create agent in backend',
        };
      }

      return { success: true };
    } catch (error) {
      logger.error('Backend creation failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Backend error',
      };
    }
  }

  /**
   * Send initial message to agent
   */
  private async sendInitialMessage(
    agent: AgentSession,
    message: string,
    contextReferences?: any[],
  ): Promise<void> {
    logger.info('sendInitialMessage called', {
      agentId: agent?.id,
      messageLength: message?.length,
      hasContextReferences: !!contextReferences,
      contextReferencesCount: contextReferences?.length || 0,
    });

    // Validate inputs
    if (!agent?.id || !agent?.backendSessionId) {
      logger.error('Invalid agent for sending initial message', {
        hasAgent: !!agent,
        hasId: !!agent?.id,
        hasBackendSessionId: !!agent?.backendSessionId,
      });
      return;
    }

    if (!message || message.trim().length === 0) {
      logger.warn('Empty initial message, skipping', { agentId: agent.id });
      return;
    }

    // CRITICAL: Use the agentId for the stream channel
    // The backend sends to agent:stream:${agentId}, not agent:stream:${sessionId}
    // We must listen on the same channel the backend sends to
    const streamChannel = `agent:stream:${agent.id}`;

    try {
      // Note: User message is already added in createAgent() before sendInitialMessage() is called
      // This ensures the UI shows the user message immediately when the agent is created

      // NOTE: Stream handler is NOT registered here anymore.
      // AgentService.setupEventListeners() listens for 'agent:created' events from the backend
      // and calls registerStreamHandlerForSession() which handles all stream processing.
      // Previously, this factory also registered a handler, causing duplicate chunk processing
      // and doubled text output like "I'll helpI'll help you fix you fix".
      //
      // The stream handler logic that was here has been removed since it's redundant with
      // AgentService.registerStreamHandlerForSession().

      if (!window.electronAPI) {
        logger.error('ElectronAPI not available, cannot send message', {
          agentId: agent.id,
          streamChannel,
        });

        // Clean up the user message we added since we can't proceed
        if (!isBackend) {
          const sessionStore = await getSessionStore();
          if (sessionStore) {
            const session = sessionStore.getSession(agent.id);
            if (session && session.messages) {
              // Remove the last message (the user message we just added)
              session.messages.pop();
              sessionStore.updateMessages(agent.id, session.messages);
            }
          }
        }

        throw new Error('Cannot send message: ElectronAPI not available');
      }

      logger.debug('Stream handler will be registered by AgentService via agent:created event', {
        agentId: agent.id,
        streamChannel,
      });

      // Send to backend for processing using the new stream message channel
      const streamMessageRequest = {
        agentId: agent.id,
        sessionId: agent.id,
        content: message.trim(),
        workspaceId: agent.workspaceId,
        agentName: agent.name,
        systemPrompt: agent.systemPrompt || '',
        contextReferences: contextReferences || [],
      };

      logger.info('Sending initial message to backend', {
        agentId: agent.id,
        channel: AGENT_BACKEND_CHANNELS.STREAM_MESSAGE,
        messageLength: message.trim().length,
      });

      // Note: Streaming state is already set in createAgent before this method is called
      // This ensures ChatPanel sees the streaming state immediately when it mounts

      // Send message via invoke (only in frontend)
      if (!isBackend) {
        const invoke = await getInvoke();
        if (invoke) {
          logger.info('About to invoke backend with stream message', {
            agentId: agent.id,
            channel: AGENT_BACKEND_CHANNELS.STREAM_MESSAGE,
            streamChannel,
          });

          const response = await invoke(
            AGENT_BACKEND_CHANNELS.STREAM_MESSAGE,
            streamMessageRequest,
          );

          logger.info('Backend invoke response received', {
            agentId: agent.id,
            hasResponse: !!response,
            responseType: typeof response,
            responseKeys: response ? Object.keys(response) : [],
            success: response?.success,
          });

          // Check if the response is in IpcResponse format
          if (response && typeof response === 'object' && 'success' in response) {
            if (!response.success) {
              throw new Error(response.error?.message || 'Failed to send message to backend');
            }
          }
          // If no IpcResponse format, assume success (backward compatibility)
        } else {
          logger.error('Failed to get invoke function', { agentId: agent.id });
        }
      }
    } catch (error) {
      logger.error('Failed to send initial message', {
        error: error instanceof Error ? error.message : String(error),
        agentId: agent.id,
        messageLength: message?.length,
      });
      // Mark streaming as failed (only in frontend)
      // Note: Stream handler cleanup is handled by AgentService, not here
      if (!isBackend) {
        const sessionStore = await getSessionStore();
        if (sessionStore) {
          sessionStore.setStreamingForWorkspace(agent.workspaceId, agent.id, false);
        }
      }
      // Don't fail agent creation if initial message fails
    }
  }
}

// Export singleton instance
export const agentFactory = UnifiedAgentFactory.getInstance();

// For backward compatibility
export const unifiedAgentFactory = agentFactory;
