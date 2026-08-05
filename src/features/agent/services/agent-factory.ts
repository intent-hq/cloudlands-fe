/**
 * Unified Agent Factory
 *
 * Single, clean agent creation service consolidating all creation methods.
 * Uses Wave 1 foundations: branded IDs, type validation, IPC contracts.
 *
 * WAVE 2 REFACTOR: Consolidates 6+ creation methods into one unified interface.
 */

import { v4 as uuidv4 } from 'uuid';
import { CHIEF_WORKSPACE_ID, createMessageId, createAgentId } from '$shared/types/branded-ids';
import { createAppMessageId } from '$shared/utils/app-message-id';
import { unifiedIdService } from '$shared/services/unified-id.service';
import type { Workspace, AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types';
import { Logger } from '$shared/logger';
import type { WorkspaceId as BrandedWorkspaceId } from '$shared/types/branded-ids';
import { appClient } from '$lib/client';
import { backendRequest } from '$lib/client/live/backend-transport';
import { generateAgentNameFromText } from '$lib/utils/agent-name-generator';
import {
  addMessage,
  setAgentStreaming,
  upsertSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { selectTopLevelContextItems } from '$store/renderer/slices/context/context-selectors';
import {
  selectActiveProviderId,
  selectAvailableEnabledProviderIds,
} from '$store/renderer/slices/provider-settings/provider-settings-selectors';
import { selectHasCheckedOnce } from '$store/renderer/slices/agent-availability/agent-availability-selectors';

import { isModelValidForProvider, splitCompoundModelId } from '$shared/utils/compound-model-id';
import { selectEffectiveDefaultProviderId } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import { store as appStore } from '$store/renderer/store';
import { m } from '$shared/paraglide/messages.js';

const logger = new Logger('UnifiedAgentFactory');

// Detect if we're running in the backend (Node.js) or frontend (browser)
const isBackend = typeof window === 'undefined';

async function getActiveProviderId(): Promise<string | null> {
  if (isBackend) return null;
  try {
    const store = appStore;
    return selectActiveProviderId.select(store.state);
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
 * - If `name` is provided,
  it's used (with sanitization)
 * - If `name` is empty but `initialMessage` is present,
  name is derived from the message
 * - Otherwise,
  a default name is generated based on workspace title
 */

// Re-export from shared for backward compatibility
export type { UnifiedAgentConfig, CreateAgentResult } from '$shared/types/agent.types';
import type { UnifiedAgentConfig, CreateAgentResult } from '$shared/types/agent.types';

/**
 * Normalized agent configuration with guaranteed name
 * This is the result of normalizeConfig() which always provides a name
 */
type NormalizedAgentConfig = Omit<UnifiedAgentConfig, 'name'> & { name: string };

/**
 * Unified Agent Factory - Single, clean agent creation service
 *
 * Consolidates all creation methods (createAgent, createInitialAgent, createContextualAgent)
 * into one unified interface with proper validation and error handling.
 */
const AGENT_FACTORY_HMR_KEY = '__agentFactory_hmr';

export class UnifiedAgentFactory {
  private static instance: UnifiedAgentFactory;

  private constructor() {}

  static getInstance(): UnifiedAgentFactory {
    // Survive HMR: reuse instance stored on window if available
    if (typeof window !== 'undefined' && (window as any)[AGENT_FACTORY_HMR_KEY]) {
      UnifiedAgentFactory.instance = (window as any)[AGENT_FACTORY_HMR_KEY];
      return UnifiedAgentFactory.instance;
    }
    if (!UnifiedAgentFactory.instance) {
      UnifiedAgentFactory.instance = new UnifiedAgentFactory();
      if (typeof window !== 'undefined') {
        (window as any)[AGENT_FACTORY_HMR_KEY] = UnifiedAgentFactory.instance;
      }
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
          error: m.agent_factory_invalidWorkspace_error(),
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
            error: m.agent_factory_creationBlocked_error({ reason: circuitCheck.reason ?? '' }),
          };
        }
        // Record the agent start
        agentCircuitBreaker.recordAgentStart(workspace.id, config.id || 'pending');
      } catch (e) {
        // Circuit breaker failure should not block agent creation
        logger.warn('Circuit breaker check failed, proceeding with agent creation', { error: e });
      }

      // Step 2: Config validation is performed server-side by the daemon on
      // `agent.create` (PROTOCOL §5.5). The renderer create path no longer
      // validates here.

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
              await import('$features/layout/panel-layout-adapter');
            // Only access panel layout if the workspace page has already initialized it
            if (hasPanelLayoutManager(workspace.id)) {
              const layoutManager = getPanelLayoutManager(workspace.id);
              const allTabs = layoutManager.getAllTabs();
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
                // i18n-ignore (log line)
                'Panel layout manager not yet initialized, skipping open panels context',
              );
            }
          } catch (error) {
            logger.debug('Could not load open panels', { error });
          }

          // Get linked references from context store (Redux)
          try {
            const topLevelItems = selectTopLevelContextItems.select(appStore.state, workspace.id);
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

      // Step 4: Normalized config is validated server-side by the daemon on `agent.create`.
      metrics.validationTime = Date.now() - validationStart;

      // Step 5: The agent id is daemon-assigned. `agent.create` (PROTOCOL
      // §5.5) no longer receives a client-minted id — the daemon returns the
      // canonical session id on the response and the FE adopts it (below).
      // `sessionId` remains a local placeholder for `backendSessionId`
      // truthiness (it is never sent on the wire; stream channels key off the
      // agent id).
      const idGenStart = Date.now();
      const sessionId = unifiedIdService.generateAgentId();
      metrics.idGenerationTime = Date.now() - idGenStart;

      if (config.id) {
        // Legacy callers may still pass an optimistic id; it is used only as
        // a local fallback when no daemon round-trip occurs (backend context).
        logger.info('📌 config.id provided; daemon-assigned id will take precedence', {
          providedId: config.id,
        });
      }

      logger.info('📋 Creating agent with configuration', {
        workspaceId: workspace.id,
        name: normalized.name,
        source: normalized.source,
        model: normalized.model,
        agentType: normalized.agentType,
      });

      // Step 6: Get workspace path for rules loading
      // Priority: worktreePath (git working directory) > path (workspace-specific) > repositoryPath (fallback)
      const workspacePath =
        workspace.worktreePath ||
        workspace.path ||
        workspace.repositoryPath ||
        (workspace.id === CHIEF_WORKSPACE_ID ? '/tmp' : undefined);

      // Step 6.5: Determine provider early (needed for model resolution)
      // Determine provider: use explicit config.provider, or get from Redux active-provider slice
      let provider = config.provider;
      if (!provider && !isBackend) {
        const activeId = await getActiveProviderId();
        if (activeId) {
          // D1(B): never silently spawn on an unavailable provider — this is
          // how an implicit (no explicit provider/specialist codingAgent)
          // agent creation ended up targeting an uninstalled Auggie binary.
          // An explicit config.provider is a caller's deliberate choice and
          // is not gated here; only this active-provider fallback is.
          let isActiveProviderAvailable = true;
          try {
            // Only refuse once availability is confirmed known; while the
            // first check hasn't resolved yet, selectAvailableEnabledProviderIds
            // is empty by default and must not be mistaken for "confirmed
            // unavailable" — that would refuse creation during initial load.
            const availabilityKnown = selectHasCheckedOnce.select(appStore.state);
            isActiveProviderAvailable =
              !availabilityKnown ||
              selectAvailableEnabledProviderIds.select(appStore.state).includes(activeId);
          } catch {
            // Availability data not resolvable — don't block on an unknown state.
          }
          if (!isActiveProviderAvailable) {
            logger.error('Active provider is unavailable; refusing to create agent', {
              provider: activeId,
            });
            return {
              success: false,
              error: m.agent_factory_activeProviderUnavailable_error({ provider: activeId }),
            };
          }
          provider = activeId;
          logger.debug('Using active provider from store', { provider });
        }
      }

      // Step 6.6: Model is daemon-resolved (single resolver, PROTOCOL §5.11).
      // Pass the caller's explicit model through untouched; when absent, omit
      // it from `agent.create` so the daemon applies its resolved default
      // (specialist frontmatter > settings chain > provider CLI default). No
      // client-side default-model synthesis.
      let resolvedModel = normalized.model;

      // Step 6.8: Safety-net — reject cross-provider compound model IDs.
      // If the supplied model is a compound ID whose provider prefix doesn't
      // match the target provider (e.g., "codex:opencode/big-pickle"), log a
      // warning and drop it so the daemon resolves the target provider's own
      // default instead of a cross-provider model leaking through.
      if (resolvedModel && provider && resolvedModel.includes(':')) {
        const defaultProviderId = isBackend
          ? ''
          : selectEffectiveDefaultProviderId.select(appStore.state);
        if (!isModelValidForProvider(resolvedModel, provider, defaultProviderId)) {
          const modelProvider = splitCompoundModelId(resolvedModel).providerId;
          logger.warn('Safety net: cross-provider model mismatch in agent creation', {
            resolvedModel,
            modelProvider,
            expectedProvider: provider,
          });
          resolvedModel = undefined;
        }
      }

      // Step 7: Create agent session object (system prompt will be built by backend)
      // The id starts as a provisional local value (config.id or a generated
      // placeholder) and is REPLACED by the daemon-assigned id right after
      // `createInBackend` — before any store dispatch or message send.
      const provisionalAgentId = config.id
        ? createAgentId(config.id)
        : unifiedIdService.generateAgentId();
      const agent: AgentSession = {
        id: provisionalAgentId,
        backendSessionId: sessionId,
        workspaceId: workspace.id as BrandedWorkspaceId,
        name: normalized.name,
        status: AgentStatus.Idle,
        messages: [],
        model: resolvedModel,
        provider, // Top-level ACP provider — immutable after creation
        // systemPrompt is built by backend, not included in frontend agent object
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isStreaming: false,
        isProcessing: false,
        // Propagate isBackground from config or metadata so it persists on the session
        // and is available for lifecycle event filtering (e.g., suppressing coordinator wakes).
        isBackground: normalized.isBackground ?? !!normalized.metadata?.isBackground,
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
          error: m.agent_factory_invalidWorkspacePath_error(),
          sessionId,
        };
      }

      // Step 8: Create agent in backend via IPC (only in frontend). The
      // daemon assigns the session id and returns it; the FE adopts it here —
      // BEFORE the session upsert and the follow-up initial-message send — so
      // every downstream reference (store key, stream channel,
      // `agent.sendMessage`) targets the daemon's id. No client id is sent,
      // so "already exists" collisions (the old retry-with-new-ID path) can
      // no longer occur.
      if (!isBackend) {
        const backendStart = Date.now();

        const backendResult = await this.createInBackend(
          agent,
          workspacePath,
          normalized.behaviorPrompt,
          normalized.workspaceContext,
          provider,
          normalized.skipInitialPrompt,
          normalized.nameExplicitlySet,
        );
        metrics.backendCreationTime = Date.now() - backendStart;

        if (!backendResult.success) {
          logger.error('Backend agent creation failed', {
            error: backendResult.error,
            duration: metrics.backendCreationTime,
          });
          return {
            success: false,
            error: backendResult.error,
            sessionId,
          };
        }

        if (!backendResult.agentId) {
          // The daemon-assigned id IS the contract now: proceeding with the
          // provisional id would upsert/send against a session the daemon
          // doesn't recognize (guaranteed `-32602 not found: agent session`).
          // Fail hard before any store dispatch or message send.
          logger.error('agent.create response carried no agent id; aborting creation', {
            provisionalAgentId,
          });
          return {
            success: false,
            error: 'agent.create response missing daemon-assigned agent id',
            sessionId,
          };
        }
        agent.id = createAgentId(backendResult.agentId);
      }

      logger.debug('Backend agent created', {
        agentId: agent.id,
        backendCreationTime: metrics.backendCreationTime,
      });

      // Step 8: Update frontend state
      const stateUpdateStart = Date.now();
      // Upsert agent session directly into Redux

      // Only update frontend state if we're in the frontend
      if (!isBackend) {
        const store = appStore;
        if (store) {
          store.dispatch(
            upsertSession({
              ...agent,
              workspaceId: agent.workspaceId,
            }),
          );
        }
      }
      metrics.stateUpdateTime = Date.now() - stateUpdateStart;

      // Agent is now registered in state

      // Step 9: Set streaming state BEFORE sending initial message
      // This ensures ChatPanel sees streaming state immediately when it mounts
      if (normalized.initialMessage) {
        if (!isBackend) {
          const store = appStore;

          // Set streaming state directly via Redux dispatch.
          // Streaming state is owned by agent-session and keyed by agent ID.
          if (store) {
            store.dispatch(setAgentStreaming(agent.id, true));
          }

          logger.info('Set streaming state to true BEFORE sending initial message', {
            agentId: agent.id,
            inReduxStore: !!store,
          });
        }
      }

      // Step 10: Add user message to state BEFORE sending to backend
      // This ensures the UI shows the user message immediately
      // Handle both cases: when there's a message, or when there are only context references
      const hasInitialMessage = !!normalized.initialMessage?.trim();
      const hasContextReferences = (normalized.contextReferences?.length ?? 0) > 0;
      const hasImageBlocks = (normalized.imageBlocks?.length ?? 0) > 0;
      // Mint the logical app-message id ONCE so the optimistic user message
      // (Step 10, non-backend agents) and the wire send (Step 11) share the
      // same identity. The daemon echoes it back as `appMessageId` on the
      // user-row agent:message event and on conversation rows (PROTOCOL §5.5),
      // so the echoed canonical message merges with the optimistic one by id
      // (the authoritative path); content-hash dedup remains only as a
      // fallback for rows that lack an appMessageId (e.g. older daemons that
      // do not echo it).
      // Callers may supply their own id (empty/whitespace values are ignored).
      const initialUserAppMessageId =
        hasInitialMessage || hasContextReferences || hasImageBlocks
          ? normalized.appMessageId?.trim() || createAppMessageId()
          : undefined;

      if ((hasInitialMessage || hasContextReferences || hasImageBlocks) && !isBackend) {
        const store = appStore;
        if (store) {
          // If no text message but we have context references, generate a placeholder
          let messageText = normalized.initialMessage?.trim() || '';
          if (!messageText && hasContextReferences) {
            messageText =
              // i18n-ignore (agent prompt content sent on the wire; must stay English)
              'I have linked some context above. Please review it and help me with this task.';
          }

          const userMessage = {
            id: createMessageId(`msg_${uuidv4()}`),
            appMessageId: initialUserAppMessageId,
            role: 'user' as const,
            contentBlocks: [
              ...(messageText ? [{ type: 'text' as const, text: messageText }] : []),
              ...(normalized.imageBlocks || []),
            ],
            timestamp: new Date().toISOString(),
            // Include contextReferences in metadata so they display as pills in ChatMessage
            metadata: hasContextReferences
              ? { contextReferences: normalized.contextReferences }
              : {},
          };
          store.dispatch(addMessage(agent.id, userMessage));
          logger.info('Added user message to state before sending', {
            agentId: agent.id,
            messageId: userMessage.id,
            hasContextReferences,
          });

          // Persistence of the initial user message is owned by the daemon;
          // the follow-up sendInitialMessage(...) call (`agent.sendMessage`,
          // PROTOCOL.md §5.5) drives the daemon-side record.
        }
      }

      // Step 11: Send initial message if provided (or if there are context references)
      if (hasInitialMessage || hasContextReferences || hasImageBlocks) {
        // Build the message to send - use text if provided, otherwise generate placeholder
        let messageToSend = normalized.initialMessage?.trim() || '';
        if (!messageToSend && hasContextReferences) {
          messageToSend =
            // i18n-ignore (agent prompt content sent on the wire; must stay English)
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
        this.sendInitialMessage(
          agent,
          messageToSend,
          normalized.contextReferences,
          normalized.imageBlocks,
          initialUserAppMessageId,
        ).catch((error) => {
          logger.error('Failed to send initial message', error);
        });
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

      return {
        success: true,
        agent,
        agentId: agent.id,
        sessionId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : m.agent_factory_unknown_error();
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
      nameExplicitlySet: config.nameExplicitlySet, // Wire `nameExplicitlySet` — false marks a generated placeholder name
      workspaceId: config.workspaceId || (workspace.id as BrandedWorkspaceId),
      model: config.model, // Don't set default here - createAgent handles provider-aware defaults
      provider: config.provider, // Preserve provider for propagation to session
      initialMessage: config.initialMessage,
      appMessageId: config.appMessageId,
      contextReferences: config.contextReferences || [],
      imageBlocks: config.imageBlocks || [],
      metadata: config.metadata || {},
      source: config.source || 'api',
      agentType: config.agentType,
      behaviorPrompt: config.behaviorPrompt, // Preserve behavior prompt from specialist
      isBackground: config.isBackground, // Preserve background flag for lifecycle event filtering
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
   * Create the agent session on the daemon via the widened `agent.create` seam
   * (PROTOCOL §5.5, widened in AUDIT-P2-12a). Routes directly through
   * `appClient.agents.create` — the daemon owns provider spawn/session
   * lifecycle, so the FE no longer round-trips through `AGENT_CHANNELS.CREATE`
   * and the main-process `ConsolidatedBackendService` + `ACPProvider` spawn
   * chain (deleted in AUDIT-P2-12b). `skipInitialPrompt` is a legacy
   * main-process flag that is unused by the daemon and intentionally dropped.
   *
   * No `agentId` is sent: the daemon assigns the session id and returns it on
   * the response's `agent.id`, which is surfaced back to `createAgent` so the
   * FE adopts it before any follow-up `agent.sendMessage` (fixes the
   * create→send race at its root; a follow-up intentd change rejects
   * client-supplied agent ids outright).
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
    _skipInitialPrompt?: boolean,
    nameExplicitlySet?: boolean,
  ): Promise<{ success: boolean; agentId?: string; error?: string }> {
    try {
      const request = {
        workspaceId: String(agent.workspaceId),
        workspacePath,
        name: agent.name,
        // Wire `nameExplicitlySet` (PROTOCOL §5.5): false marks a generated
        // placeholder name so the created agent stays self-renameable. Only
        // include the key when the caller supplied it so the daemon default
        // (name-present ⇒ explicitly set) is preserved for legacy callers.
        ...(nameExplicitlySet !== undefined ? { nameExplicitlySet } : {}),
        model: agent.model ?? undefined, // Coerce null to undefined for wire format
        provider, // Provider ID (e.g., 'auggie', 'claude-code', 'codex') from activeProviderStore
        agentType: agent.metadata?.agentType, // Daemon builds system prompt from this
        prompt: behaviorPrompt, // Maps to wire `behaviorPrompt` (AgentCreateRequest.prompt)
        // Maps to wire `specialistId` (PROTOCOL §5.5) — the daemon persists the
        // session specialist from the top-level param only; `metadata.specialist`
        // is NOT harvested, so it must be lifted onto the request here.
        specialist: agent.metadata?.specialist,
        metadata: agent.metadata,
        workspaceContext: workspaceContext as Record<string, unknown> | undefined,
      };

      logger.info('📤 Creating agent via daemon (agent.create)', {
        model: request.model,
        provider: request.provider,
        hasBehaviorPrompt: !!request.prompt,
        behaviorPromptLength: request.prompt?.length || 0,
        agentType: request.agentType,
        openPanelsCount: workspaceContext?.openPanels.length || 0,
        linkedReferencesCount: workspaceContext?.linkedReferences.length || 0,
      });

      const created = await appClient.agents.create(request);

      return { success: true, agentId: created.id ? String(created.id) : undefined };
    } catch (error) {
      logger.error('Daemon agent.create failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : m.agent_factory_daemon_error(),
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
    imageBlocks?: Array<{ type: 'image'; data: string; mimeType: string }>,
    userAppMessageId?: string,
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

    if ((!message || message.trim().length === 0) && !imageBlocks?.length) {
      logger.warn('Empty initial message, skipping', { agentId: agent.id });
      return;
    }

    try {
      // Note: User message is already added in createAgent() before sendInitialMessage() is called
      // This ensures the UI shows the user message immediately when the agent is created

      logger.info('Sending initial message to backend', {
        agentId: agent.id,
        messageLength: message.trim().length,
      });

      // Note: Streaming state is already set in createAgent before this method is called
      // This ensures ChatPanel sees the streaming state immediately when it mounts

      // Send message via the BackendTransport seam (only in frontend)
      if (!isBackend) {
        // PROTOCOL.md §5.5 `agent.sendMessage` — one direct daemon call over
        // the BackendTransport seam. Streaming/terminal state arrives via the
        // daemon events bridge (events.subscribe → Redux); legacy-only fields
        // the daemon ignores (sessionId, agentName, systemPrompt) are no
        // longer sent. The daemon only resolves `{ success: true, queued,
        // messageId? }` bodies — failures surface as JSON-RPC errors that
        // backendRequest throws (handled by the catch below).
        await backendRequest('agent.sendMessage', {
          agentId: agent.id,
          workspaceId: agent.workspaceId,
          content: message.trim(),
          contextReferences: contextReferences || [],
          imageBlocks,
          userAppMessageId,
        });
      }
    } catch (error) {
      logger.error('Failed to send initial message', {
        error: error instanceof Error ? error.message : String(error),
        agentId: agent.id,
        messageLength: message?.length,
      });
      // Mark streaming as failed (only in frontend)
      if (!isBackend) {
        const store = appStore;
        if (store) {
          store.dispatch(setAgentStreaming(agent.id, false));
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
