/**
 * MCP Tools for Agent-to-Agent Interaction
 *
 * Provides tools for agents to:
 * - Create other agents
 * - Send messages to other agents
 * - Subscribe to workspace events
 * - List and query agents
 * - Wait for agent completion
 *
 * These tools use the ToolCallContext to get agent information at runtime,
 * allowing them to be registered once per workspace and work for any agent.
 *
 * ============================================================================
 * IMPORTANT PATTERNS FOR AGENT INTERACTION TOOLS
 * ============================================================================
 *
 * Any tool that creates, wakes, or messages another agent MUST subscribe the
 * caller to be notified when the target agent finishes. Use the helper function:
 *
 *   subscribeCallerToAgentCompletion(workspaceId, callerId, callerName, targetAgentId)
 *
 * This ensures:
 * 1. Callers are woken when target agents complete (agent:idle)
 * 2. Subscriptions are cleaned up if target fails or is deleted (agent:failed, agent:deleted)
 * 3. Subscriptions auto-unsubscribe after first delivery (oneShot: true)
 * 4. High priority delivery when caller becomes idle
 *
 * DO NOT manually create AgentEventFilter objects for this purpose - always use
 * the helper to ensure consistency.
 * ============================================================================
 */

import { v4 as uuidv4 } from 'uuid';
import {
  BaseMCPTool,
  createInputSchema,
  stringProperty,
  numberProperty,
  arrayProperty,
  booleanProperty,
} from './tool';
import type { ToolCall, ToolResult } from './protocol';
import { Logger } from '$shared/logger';
import type { AgentEventFilter } from '$features/events/main/agent-subscription-ops';
import { stripMarkdownFormatting } from '$shared/utils-client';
import { resolveSpecialistForAgent } from '$features/agent/main/specialists.service';
import {
  TASK_LINK_REGEX,
  TASK_URL_BASE,
  taskNoteUrl,
  noteUrl,
  isDelegatedTaskLink,
} from '$shared/constants/intent-links';
import {
  parseCompoundModelId,
  getDefaultProviderId,
  getDefaultModelForProvider,
  isModelValidForProvider,
  PROVIDER_MODEL_TIERS,
} from '$shared/config/provider-config';

const logger = new Logger('AgentInteractionTools');

/**
 * Maximum delegation depth to prevent unbounded recursive agent creation.
 * Depth 0 = user-created agents, depth 1 = their children, depth 2 = grandchildren (max).
 */
const MAX_DELEGATION_DEPTH = 2;

/**
 * Get the delegation depth of an agent by loading its metadata from persistence.
 * Returns 0 if the agent has no depth metadata or if loading fails (permissive default).
 */
async function getDelegationDepth(workspaceId: string, agentId: string): Promise<number> {
  try {
    const { agentPersistence } = await import('../../../agent/main/agent-persistence');
    const { createAgentId, createWorkspaceId } = await import('$shared/types/branded-ids');
    const loadResult = await agentPersistence.loadAgent(
      createAgentId(agentId),
      createWorkspaceId(workspaceId),
    );
    if (loadResult.success && loadResult.data) {
      return (loadResult.data.metadata?.delegationDepth as number) ?? 0;
    }
    return 0;
  } catch (error) {
    logger.warn('Failed to get delegation depth, defaulting to 0', { agentId, error });
    return 0;
  }
}

/**
 * Helper to get required context from tool call
 */
function getRequiredContext(call: ToolCall): {
  workspaceId: string;
  agentId: string;
  agentName: string;
  model?: string;
  provider?: string;
} {
  const ctx = call.context;
  if (!ctx?.workspaceId) {
    throw new Error('Workspace context not available');
  }
  // Derive the parent agent's ACP provider. Prefer explicit provider metadata (set by
  // agent-context-registry) over parsing the compound model ID, since bare model strings
  // like "default" would incorrectly resolve to the default provider (auggie).
  const parentModel = ctx.metadata?.model;
  const provider = ctx.metadata?.provider || (parentModel ? parseCompoundModelId(parentModel).providerId : undefined);
  return {
    workspaceId: ctx.workspaceId,
    agentId: ctx.agentId || 'unknown-agent',
    agentName: ctx.agentName || 'Agent',
    model: parentModel, // Parent agent's model for delegation inheritance
    provider, // Parent agent's ACP provider for delegation inheritance
  };
}

/**
 * The standard event types for agent completion subscriptions.
 * Includes all lifecycle events to ensure proper cleanup:
 * - agent:idle - Agent finished processing and is waiting
 * - agent:failed - Agent encountered an error
 * - agent:deleted - Agent was deleted (cleanup subscription)
 */
const AGENT_COMPLETION_EVENT_TYPES = [
  'agent:idle',
  'agent:failed',
  'agent:deleted',
] as const;

/**
 * Subscribe a caller agent to be notified when a target agent completes.
 *
 * This is the canonical way to set up agent-to-agent completion notifications.
 * Use this whenever an agent creates, wakes, delegates to, or messages another agent.
 *
 * @param workspaceId - The workspace ID
 * @param callerId - The agent ID that should be notified
 * @param callerName - The agent name (for logging)
 * @param targetAgentId - The agent ID to watch for completion
 * @returns The subscription ID
 */
async function subscribeCallerToAgentCompletion(
  workspaceId: string,
  callerId: string,
  callerName: string,
  targetAgentId: string,
): Promise<string> {
  const { agentSubscribe } =
    await import('../../../events/main/agent-subscription-ops');

  const filter: AgentEventFilter = {
    eventTypes: [...AGENT_COMPLETION_EVENT_TYPES],
    actorIds: [targetAgentId],
    priority: 'high',
    oneShot: true,
  };

  const subscriptionId = agentSubscribe(workspaceId, callerId, callerName, filter);

  logger.info('Subscribed caller to agent completion', {
    callerId,
    callerName,
    targetAgentId,
    subscriptionId,
  });

  return subscriptionId;
}

/**
 * Auto-commit instruction snippets injected based on workspace settings.
 * These are appended to the specialist's behavior prompt when auto-commit is enabled.
 *
 * When auto-commit is enabled:
 * - Implementor changes are committed AUTOMATICALLY when they mark their task complete
 * - The commit message is derived from the task title
 * - Agents only need to manually commit if the user explicitly asks them to
 *
 * The agent_commit_changes tool is for manual commits when the user asks.
 */
const AUTO_COMMIT_INSTRUCTIONS = {
  // For coordinators - brief info about delegated agent behavior
  coordinator: `
## Auto-Commit
Implementer agents' changes are committed automatically when they complete their tasks.`,

  // For implementors - clear, concise guidance
  implementor: `
## Committing Changes
Your changes are committed automatically when you complete your task (using the task title as the commit message).

To commit manually before finishing (e.g., user asks for a checkpoint):
- Use \`agent_commit_changes\` with a descriptive message
- If auto-commit is disabled, set \`userRequested: true\``,
};

/**
 * Instructions injected when auto-commit is DISABLED.
 * Tells agents NOT to auto-commit, but explains how to commit if the user asks.
 */
const NO_AUTO_COMMIT_INSTRUCTIONS = {
  coordinator: `
## Committing Changes
Auto-commit is disabled. Implementer agents will NOT automatically commit their changes.
If the user asks you to commit, use \`agent_commit_changes\` with \`userRequested: true\`.`,

  implementor: `
## Committing Changes
Auto-commit is disabled. Your changes will NOT be committed automatically.
Do not commit unless the user explicitly asks you to.
If the user asks you to commit, use \`agent_commit_changes\` with \`userRequested: true\`.`,
};

/**
 * Helper to resolve specialist configuration
 * Returns model and behaviorPrompt based on specialist ID, with optional overrides
 *
 * IMPORTANT: When no specialist is provided, defaults to "implementor" specialist.
 * This ensures all delegated tasks get the proper implementor behavior prompt,
 * which constrains agents to focus on their assigned task and not expand scope.
 *
 * PROVIDER INHERITANCE: When the parent agent uses a non-default provider (e.g., codex),
 * the specialist model will inherit that provider. This ensures delegated agents use
 * the same provider as their coordinator.
 *
 * @param autoCommitEnabled - If true, appends auto-commit instructions to the behavior prompt
 */
function resolveSpecialistConfig(
  specialistId: string | undefined,
  modelOverride: string | undefined,
  behaviorPromptOverride: string | undefined,
  parentModel: string | undefined,
  parentProvider: string | undefined,
  defaultToImplementor: boolean = true,
  autoCommitEnabled: boolean = true,
): {
  model: string;
  provider: string;
  behaviorPrompt: string | undefined;
  effectiveSpecialistId: string | undefined;
  specialistName: string | undefined;
  roleReminder: string | undefined;
  defaultAgentType: string | undefined;
} {
  const defaultProviderId = getDefaultProviderId();
  const inheritedProvider =
    parentProvider ?? (parentModel ? parseCompoundModelId(parentModel).providerId : undefined);

  const validateModelOverride = (
    candidate: string | undefined,
    targetProvider: string,
  ): string | undefined => {
    if (!candidate) {
      return undefined;
    }
    if (!isModelValidForProvider(candidate, targetProvider)) {
      logger.warn('Model override belongs to a different provider, discarding', {
        modelOverride: candidate,
        targetProvider,
      });
      return undefined;
    }
    return candidate;
  };

  // Resolve specialist ID - default to 'implementor' if not provided and defaultToImplementor is true
  const effectiveSpecialistId = specialistId || (defaultToImplementor ? 'implementor' : undefined);

  // If we have a specialist (explicit or defaulted), use centralized resolver as the base
  if (effectiveSpecialistId) {
    const resolved = resolveSpecialistForAgent(effectiveSpecialistId, inheritedProvider);
    if (!resolved) {
      logger.warn('Unknown specialist ID, falling back to parent model', {
        specialistId: effectiveSpecialistId,
      });
      const fallbackProvider = inheritedProvider || defaultProviderId;
      const validatedModelOverride = validateModelOverride(modelOverride, fallbackProvider);
      // Use provider-aware fallback instead of hardcoded model
      let fallbackModel = validatedModelOverride || parentModel;
      if (!fallbackModel) {
        fallbackModel = getDefaultModelForProvider(fallbackProvider, 'fast');
      }
      return {
        model: fallbackModel,
        provider: fallbackProvider,
        behaviorPrompt: behaviorPromptOverride,
        effectiveSpecialistId: undefined,
        specialistName: undefined,
        roleReminder: undefined,
        defaultAgentType: undefined,
      };
    }

    const targetProvider = resolved.codingAgent || inheritedProvider || defaultProviderId;
    const validatedModelOverride = validateModelOverride(modelOverride, targetProvider);

    // MCP-specific: Build the behavior prompt with auto-commit instructions
    // Always inject commit instructions — either auto-commit or no-auto-commit guidance
    let behaviorPrompt = behaviorPromptOverride || resolved.behaviorPrompt;
    if (behaviorPrompt) {
      const instructions = autoCommitEnabled ? AUTO_COMMIT_INSTRUCTIONS : NO_AUTO_COMMIT_INSTRUCTIONS;
      if (effectiveSpecialistId === 'spec-writer') {
        behaviorPrompt += instructions.coordinator;
      } else if (effectiveSpecialistId === 'implementor') {
        behaviorPrompt += instructions.implementor;
      }
    }

    let finalModel = validatedModelOverride || resolved.model;
    if (!finalModel) {
      if (resolved.modelTier && targetProvider in PROVIDER_MODEL_TIERS) {
        finalModel = getDefaultModelForProvider(targetProvider, resolved.modelTier);
      } else if (targetProvider !== defaultProviderId) {
        // Dynamic-model providers (for example opencode) should choose their own default
        // model instead of receiving an invalid fallback from the default provider.
        finalModel = 'default';
      } else {
        finalModel = getDefaultModelForProvider(targetProvider, 'fast');
      }
    }

    logger.debug('Resolved specialist configuration', {
      specialistId: effectiveSpecialistId,
      wasExplicit: !!specialistId,
      targetProvider,
      specialistModel: resolved.model,
      modelTier: resolved.modelTier,
      parentModel,
      finalModel,
      hasBehaviorPrompt: !!behaviorPrompt,
      hasRoleReminder: !!resolved.roleReminder,
      autoCommitEnabled,
    });

    return {
      model: finalModel,
      provider: targetProvider,
      behaviorPrompt,
      effectiveSpecialistId,
      specialistName: resolved.specialistName,
      roleReminder: resolved.roleReminder,
      defaultAgentType: resolved.defaultAgentType,
    };
  }

  // No specialist and not defaulting - use manual model/behaviorPrompt or inherit from parent
  const fallbackProvider = inheritedProvider || defaultProviderId;
  const validatedModelOverride = validateModelOverride(modelOverride, fallbackProvider);
  let fallbackModel = validatedModelOverride || parentModel;
  if (!fallbackModel) {
    fallbackModel = getDefaultModelForProvider(fallbackProvider, 'fast');
    logger.debug('Using provider-aware fallback model (no specialist, no parent)', {
      fallbackModel,
      defaultProvider: fallbackProvider,
    });
  }
  return {
    model: fallbackModel,
    provider: fallbackProvider,
    behaviorPrompt: behaviorPromptOverride,
    effectiveSpecialistId: undefined,
    specialistName: undefined,
    roleReminder: undefined,
    defaultAgentType: undefined,
  };
}

// ============================================================================
// Create Agent Tool
// ============================================================================

/**
 * Tool for creating a new agent.
 * Uses ToolCallContext to get the creator agent's information.
 */
export class CreateAgentTool extends BaseMCPTool {
  constructor(
    private workspaceId: string,
    private workspacePath: string,
  ) {
    super(
      'create_agent',
      `Create a new agent to work on a task. The new agent runs independently.

When you create an agent:
1. The agent starts working immediately
2. You are automatically subscribed to its completion events
3. End your turn and you will be woken up when the agent completes

This allows you to create multiple agents in parallel and be notified as each finishes.

**Specialists:** Use the specialist parameter to automatically configure the agent with the right model and behavior:
- specialist="implementor" for implementation tasks (uses haiku4.5, focused on executing specific tasks)
- specialist="verifier" for verification/review tasks (uses opus4.5, focused on thorough checking)

**Linked Notes:** Set createLinkedNote=true and provide noteContent with context. The note will be nested under parentNoteId if provided.

**Background Agents:** Delegated agents are background agents by default. Set isBackground=false if you need the agent to be visible in the foreground.

**Advanced:** You can override the specialist's model or behaviorPrompt by providing those parameters explicitly.`,
      createInputSchema(
        {
          name: stringProperty('Name for the new agent (e.g., "Bug Fixer", "Test Writer")'),
          taskNoteId: stringProperty(
            'Optional: ID of an existing task note to assign to the agent',
          ),
          initialMessage: stringProperty('Message to send to the agent to start its work'),
          specialist: stringProperty(
            'Optional: Specialist type to use (e.g., "implementor", "verifier"). Automatically sets model and behaviorPrompt.',
          ),
          model: stringProperty(
            'Optional: Model to use. Overrides specialist model if both are provided.',
          ),
          behaviorPrompt: stringProperty(
            'Optional: Custom behavior prompt. Overrides specialist behaviorPrompt if both are provided.',
          ),
          createLinkedNote: booleanProperty(
            'Create a note linked to this agent for tracking work. Defaults to true if no taskNoteId is provided. Set to false to skip note creation.',
          ),
          noteContent: stringProperty(
            'Content for the linked note (only used if createLinkedNote=true). Include context, background, and any relevant information.',
          ),
          parentNoteId: stringProperty(
            'Optional: ID of a parent note to nest the linked note under',
          ),
          isBackground: booleanProperty(
            'Mark the agent as a background agent. Background agents are for work the user does not need to immediately see or interact with (default: true)',
          ),
        },
        ['name', 'initialMessage'],
      ),
    );
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const ctx = getRequiredContext(call);

      // Check delegation depth limit to prevent unbounded recursive agent creation
      const parentDepth = await getDelegationDepth(this.workspaceId, ctx.agentId);
      if (parentDepth >= MAX_DELEGATION_DEPTH) {
        return this.error(
          `Cannot create sub-agent: maximum delegation depth (${MAX_DELEGATION_DEPTH}) reached. ` +
            `You are at depth ${parentDepth}. Please complete this task directly instead of delegating further.`,
        );
      }

      const {
        name,
        taskNoteId,
        initialMessage,
        specialist,
        model,
        noteContent,
        parentNoteId,
        isBackground,
        behaviorPrompt,
      } = call.arguments;
      // Default createLinkedNote to false - agents only create linked notes when explicitly requested
      // Use delegate_task for task delegation (which handles task notes properly)
      const createLinkedNote = call.arguments.createLinkedNote ?? false;

      // Check workspace auto-commit setting for behavior prompt injection
      const { isAutoCommitEnabled } =
        await import('../../../workspace/main/workspace-settings.service');
      const autoCommitEnabled = isAutoCommitEnabled(this.workspaceId);

      // Resolve specialist configuration (model and behaviorPrompt)
      // Pass autoCommitEnabled so auto-commit instructions are conditionally injected
      const config = resolveSpecialistConfig(
        specialist,
        model,
        behaviorPrompt,
        ctx.model,
        ctx.provider,
        true, // defaultToImplementor
        autoCommitEnabled,
      );

      logger.info('Creating agent via MCP tool', {
        name,
        taskNoteId,
        creatorAgentId: ctx.agentId,
        createLinkedNote,
        createLinkedNoteExplicit: call.arguments.createLinkedNote,
        parentNoteId,
        isBackground,
        specialist,
        resolvedModel: config.model,
        hasBehaviorPrompt: !!config.behaviorPrompt,
      });

      // Import the backend handler dynamically - use relative paths for runtime compatibility
      const { AgentBackendHandler } =
        await import('../../../agent/main/agent-backend-handler.service');
      const handler = AgentBackendHandler.getInstance();

      let linkedNoteId = taskNoteId;
      let linkedNoteTitle: string | undefined;

      // Create a linked note if requested
      // Note: We need to create the agent first to get the agentId, then mark the note
      // as a task and assign the agent to it (this is different from createPrerequisiteNote
      // which handles this atomically)
      let needsTaskAssignment = false;
      if (createLinkedNote && !taskNoteId) {
        const { protocolAdapter } = await import('../../../protocol/main/protocol-adapter');

        const noteTitle = name; // Use agent name as note title
        const noteResult = await protocolAdapter.createNote({
          workspaceId: this.workspaceId,
          title: noteTitle,
          content:
            noteContent ||
            `# ${noteTitle}\n\nLinked to agent: ${name}\n\n## Context\n\n(Add context here)`,
          parentId: parentNoteId,
        });

        if (noteResult.ok) {
          linkedNoteId = noteResult.data.id;
          linkedNoteTitle = noteResult.data.title;
          needsTaskAssignment = true;
          logger.info('Created linked note for agent', {
            noteId: linkedNoteId,
            noteTitle: linkedNoteTitle,
            parentNoteId,
          });
        } else {
          logger.warn('Failed to create linked note, continuing without it', {
            error: noteResult.error,
          });
        }
      }

      // Build enhanced initial message that tells the agent about their linked note
      let enhancedInitialMessage = initialMessage;
      if (linkedNoteId) {
        const noteContext = linkedNoteTitle
          ? `\n\n---\n**Your Linked Note:** "${linkedNoteTitle}" (ID: ${linkedNoteId})\nThis note is your workspace for this task. Read it for context and update it with your progress, findings, and deliverables. Use \`read_note_workspace-mcp(noteId="${linkedNoteId}")\` to read it.\n\n**SCOPE: Complete THIS task only.** When done, mark it complete and end your session. Do not pick up other tasks.`
          : `\n\n---\n**Your Linked Note ID:** ${linkedNoteId}\nThis note is your workspace for this task. Read it for context and update it with your progress. Use \`read_note_workspace-mcp(noteId="${linkedNoteId}")\` to read it.\n\n**SCOPE: Complete THIS task only.** When done, mark it complete and end your session. Do not pick up other tasks.`;
        enhancedInitialMessage = initialMessage + noteContext;
      }

      // Create the agent via the backend
      // isBackground defaults to true for delegated agents - they work in the background
      // Truncate agent name to 100 characters to pass validation
      const agentName = name.length > 100 ? `${name.substring(0, 97)}...` : name;

      // Pre-register subscription via onBeforeStart to prevent the race condition
      // where a fast-completing child agent emits agent:idle before the parent subscribes.
      let subscriptionId = '';
      const agent = await handler.createAgent(this.workspaceId, agentName, {
        workspacePath: this.workspacePath,
        model: config.model,
        provider: config.provider,
        initialMessage: enhancedInitialMessage,
        agentType: config.defaultAgentType || 'task-loop',
        behaviorPrompt: config.behaviorPrompt,
        specialistName: config.specialistName,
        roleReminder: config.roleReminder,
        metadata: {
          createdByAgentId: ctx.agentId,
          delegationDepth: parentDepth + 1,
          taskNoteId: linkedNoteId,
          ...(config.effectiveSpecialistId && { specialist: config.effectiveSpecialistId }),
          isBackground: isBackground !== false, // Default to true for delegated agents
          ...(!autoCommitEnabled && { skipAutoCommit: true }),
        },
        onBeforeStart: async (agentId: string) => {
          subscriptionId = await subscribeCallerToAgentCompletion(
            this.workspaceId,
            ctx.agentId,
            ctx.agentName,
            agentId,
          );
        },
      });

      if (!agent) {
        return this.error('Failed to create agent');
      }

      // Assign the agent to the task note
      // This handles both newly created notes and existing task notes (via taskNoteId)
      if (linkedNoteId) {
        const { protocolAdapter } = await import('../../../protocol/main/protocol-adapter');

        if (needsTaskAssignment) {
          // Step 1: Mark the newly created note as a task
          const markResult = await protocolAdapter.markAsTask({
            workspaceId: this.workspaceId,
            noteId: linkedNoteId,
            taskMetadata: {
              status: 'not_started',
              assignedAgentIds: [],
            },
          });

          if (!markResult.ok) {
            logger.warn('Failed to mark linked note as task', {
              noteId: linkedNoteId,
              error: markResult.error,
            });
          }
          // Note: Task orchestration now uses parentId (sidebar hierarchy) as the dependency graph
          // The parentId is already set on the child note, so no separate dependency tracking needed
        }

        // Step 2: Assign the agent to the task (for both new and existing task notes)
        const assignResult = await protocolAdapter.assignAgentToTask({
          workspaceId: this.workspaceId,
          noteId: linkedNoteId,
          agentId: agent.id,
        });

        if (!assignResult.ok) {
          logger.warn('Failed to assign agent to task note', {
            noteId: linkedNoteId,
            agentId: agent.id,
            error: assignResult.error,
            isExistingTaskNote: !!taskNoteId,
          });
        } else {
          logger.info('Successfully assigned agent to task note', {
            noteId: linkedNoteId,
            agentId: agent.id,
            isExistingTaskNote: !!taskNoteId,
            assignedAgentIds: assignResult.data?.metadata?.task?.assignedAgentIds,
          });
        }
      }

      // NOTE: agent:created event is emitted by agent-backend-handler.service.ts during agent creation.
      // We don't emit it here to avoid duplicate events in the Activity panel.
      // The event from the backend includes the agentId and agentName which is sufficient for display.

      // Subscription was already registered via onBeforeStart callback above.

      let successMessage = `Agent "${name}" created and started.\nAgent ID: ${agent.id}`;
      if (linkedNoteId) {
        successMessage += `\nLinked Note: ${linkedNoteId}`;
        if (createLinkedNote) {
          successMessage += ' (newly created)';
        }
      }
      successMessage +=
        '\nThe agent is now working independently. End your turn and you will be notified when it completes.';

      return this.success(successMessage, {
        agentId: agent.id,
        name: agent.name,
        status: 'started',
        linkedNoteId,
        linkedNoteCreated: createLinkedNote && linkedNoteId !== taskNoteId,
        subscriptionId,
      });
    } catch (error) {
      logger.error('Error creating agent', error as Error);
      return this.error(`Failed to create agent: ${(error as Error).message}`);
    }
  }
}

// ============================================================================
// Delegate Task Tool
// ============================================================================

/**
 * Tool for delegating an existing task checkbox to a new agent.
 * This is the programmatic equivalent of clicking "play" on a task in the UI.
 * It finds an existing task checkbox in a note and assigns a new agent to it.
 */
export class DelegateTaskTool extends BaseMCPTool {
  constructor(
    private workspaceId: string,
    private workspacePath: string,
  ) {
    super(
      'delegate_task',
      `Delegate an existing task to a new agent. You can specify the task either by:
1. **taskNoteId** (preferred): Direct ID of an existing linked task note (e.g., from "intent://local/task/{id}")
2. **taskText + noteId**: Text to match against checkboxes in a parent note

When you delegate a task:
1. The agent starts working immediately
2. You are automatically subscribed to its completion events
3. End your turn and you will be woken up when the agent completes

**Specialists:** Use the specialist parameter to automatically configure the agent:
- specialist="implementor" for implementation tasks (uses haiku4.5, focused on executing specific tasks)
- specialist="verifier" for verification/review tasks (uses opus4.5, focused on thorough checking)

**wait_mode options:**
- "immediate" (default): You'll be woken up when EACH delegated agent completes
- "after_all": You'll only be woken up when ALL agents in the same group complete

Use wait_mode="after_all" when delegating multiple related tasks and you want to review all results at once.
Tasks delegated with wait_mode="after_all" in the same turn are automatically grouped together.

**Advanced:** You can override the specialist's model or behaviorPrompt by providing those parameters explicitly.

Example with taskNoteId: If you see "[Task](intent://local/task/abc-123)", use taskNoteId="abc-123"
Example with taskText: If you see "- [ ] Create login page" in the spec, use noteId="spec" and taskText="Create login page"`,
      createInputSchema(
        {
          taskNoteId: stringProperty(
            'Direct ID of an existing linked task note (preferred). Extract from intent://local/task/{id} links.',
          ),
          noteId: stringProperty(
            'ID of the parent note containing the task checkbox (only needed with taskText)',
          ),
          taskText: stringProperty(
            'Text of the task checkbox to match (only needed without taskNoteId)',
          ),
          agentInstructions: stringProperty(
            'Additional instructions for the agent beyond the task text',
          ),
          specialist: stringProperty(
            'Optional: Specialist type to use (e.g., "implementor", "verifier"). Automatically sets model and behaviorPrompt.',
          ),
          model: stringProperty(
            'Optional: Model to use. Overrides specialist model if both are provided.',
          ),
          behaviorPrompt: stringProperty(
            'Optional: Custom behavior prompt. Overrides specialist behaviorPrompt if both are provided.',
          ),
          wait_mode: stringProperty(
            'When to wake up: "immediate" (wake after each agent) or "after_all" (wake when all grouped agents complete). Default: "immediate"',
          ),
          skipAutoCommit: {
            type: 'boolean',
            description:
              'If true, the agent will NOT automatically commit its changes when the task completes. Default: false (auto-commit is enabled).',
          },
        },
        [], // No required fields - we validate in execute based on which approach is used
      ),
    );
  }

  // Track delegation groups per agent turn (reset when agent goes idle)
  // FIXED: Now workspace-scoped to prevent conflicts between workspaces
  // Key format: `${workspaceId}:${agentId}` -> groupId
  private static delegationGroups: Map<string, string> = new Map();

  /**
   * Get or create a delegation group ID for an agent.
   * All delegations with wait_mode="after_all" in the same turn share a group.
   * @param workspaceId - The workspace ID (required for proper isolation)
   * @param agentId - The agent ID
   */
  private static getOrCreateGroupId(workspaceId: string, agentId: string): string {
    const key = `${workspaceId}:${agentId}`;
    let groupId = DelegateTaskTool.delegationGroups.get(key);
    if (!groupId) {
      groupId = `delegation-group-${uuidv4()}`;
      DelegateTaskTool.delegationGroups.set(key, groupId);
      logger.debug('Created new delegation group', { workspaceId, agentId, groupId });
    }
    return groupId;
  }

  /**
   * Clear the delegation group for an agent (called when agent goes idle)
   * @param workspaceId - The workspace ID (required for proper isolation)
   * @param agentId - The agent ID
   */
  static clearDelegationGroup(workspaceId: string, agentId: string): void {
    const key = `${workspaceId}:${agentId}`;
    const hadGroup = DelegateTaskTool.delegationGroups.has(key);
    DelegateTaskTool.delegationGroups.delete(key);
    if (hadGroup) {
      logger.debug('Cleared delegation group', { workspaceId, agentId });
    }
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const ctx = getRequiredContext(call);

      // Check delegation depth limit to prevent unbounded recursive agent creation
      const parentDepth = await getDelegationDepth(this.workspaceId, ctx.agentId);
      if (parentDepth >= MAX_DELEGATION_DEPTH) {
        return this.error(
          `Cannot delegate task: maximum delegation depth (${MAX_DELEGATION_DEPTH}) reached. ` +
            `You are at depth ${parentDepth}. Please complete this task directly instead of delegating further.`,
        );
      }

      const {
        taskNoteId,
        noteId,
        taskText,
        agentInstructions,
        specialist,
        model,
        wait_mode,
        behaviorPrompt,
        skipAutoCommit: explicitSkipAutoCommit,
      } = call.arguments;
      const waitMode = wait_mode === 'after_all' ? 'after_all' : 'immediate';

      // Check workspace auto-commit setting if not explicitly specified
      let skipAutoCommit = explicitSkipAutoCommit;
      let autoCommitEnabled = true;
      if (skipAutoCommit === undefined) {
        const { isAutoCommitEnabled } =
          await import('../../../workspace/main/workspace-settings.service');
        autoCommitEnabled = isAutoCommitEnabled(this.workspaceId);
        // If auto-commit is disabled in workspace settings, skip auto-commit
        skipAutoCommit = !autoCommitEnabled;
      } else {
        autoCommitEnabled = !skipAutoCommit;
      }

      // Resolve specialist configuration (model and behaviorPrompt)
      // Pass autoCommitEnabled so auto-commit instructions are conditionally injected
      const config = resolveSpecialistConfig(
        specialist,
        model,
        behaviorPrompt,
        ctx.model,
        ctx.provider,
        true, // defaultToImplementor
        autoCommitEnabled,
      );

      // Validate input: need either taskNoteId OR (noteId + taskText)
      if (!taskNoteId && (!noteId || !taskText)) {
        return this.error(
          'Either taskNoteId (preferred) or both noteId and taskText are required. ' +
            'Use taskNoteId when you have a linked task like [Task](intent://local/task/{id}).',
        );
      }

      const { protocolAdapter } = await import('../../../protocol/main/protocol-adapter');

      // APPROACH 1: Direct task note ID - skip text matching entirely
      if (taskNoteId) {
        logger.info('Delegating task by direct note ID', {
          taskNoteId,
          creatorAgentId: ctx.agentId,
          waitMode,
        });

        // Verify the task note exists
        const taskNoteResult = await protocolAdapter.getNote({
          workspaceId: this.workspaceId,
          noteId: taskNoteId,
        });

        if (!taskNoteResult.ok || !taskNoteResult.data) {
          return this.error(`Task note "${taskNoteId}" not found`);
        }

        const taskNote = taskNoteResult.data;
        const taskTitle = taskNote.title || taskNoteId;

        // Use the note's content or title as the initial message
        const initialMessage = agentInstructions
          ? `${taskTitle}\n\n${agentInstructions}`
          : taskNote.content || taskTitle;

        return this.delegateToExistingTaskNote(
          ctx,
          taskNoteId,
          taskTitle,
          initialMessage,
          config.model,
          config.provider,
          waitMode,
          protocolAdapter,
          parentDepth,
          config.behaviorPrompt,
          skipAutoCommit,
          config.effectiveSpecialistId,
          config.specialistName,
          config.roleReminder,
          config.defaultAgentType,
        );
      }

      // APPROACH 2: Text matching - find task in parent note
      logger.info('Delegating task by text matching', {
        noteId,
        taskText,
        creatorAgentId: ctx.agentId,
        waitMode,
      });

      // Get the parent note to find the task
      const noteResult = await protocolAdapter.getNote({
        workspaceId: this.workspaceId,
        noteId,
      });

      if (!noteResult.ok || !noteResult.data) {
        return this.error(`Note "${noteId}" not found`);
      }

      const noteContent = noteResult.data.content || '';

      // Check if the task text looks like an already-delegated task
      // Already-delegated tasks have format: [delegated](intent://local/task/{noteId})
      if (isDelegatedTaskLink(taskText)) {
        return this.error(
          `Task is already delegated. The task text "${taskText.substring(0, 50)}..." is a link to an existing task note. ` +
            'To check on this task, use read_note with the linked note ID.',
        );
      }

      // Normalize text for comparison: trim, collapse whitespace, normalize unicode
      const normalizeText = (text: string): string =>
        text
          .trim()
          .replace(/\s+/g, ' ') // Collapse whitespace
          .normalize('NFC'); // Normalize unicode
      // Extract just the task name (before em-dash/en-dash separator with description)
      // This helps match "Create Theme Store" with "**Create Theme Store** — Build a Svelte store..."
      const extractTaskName = (text: string): string => {
        // Split on common separators: em-dash, en-dash, or double hyphen with surrounding spaces
        const parts = text.split(/\s*[—–]\s*|\s+--\s+/);
        // Strip markdown bold/italic formatting and normalize
        return normalizeText(stripMarkdownFormatting(parts[0]));
      };

      const normalizedTaskText = normalizeText(taskText);
      const taskNameOnly = extractTaskName(taskText);

      // Check if the task exists in the note
      // First, try to match exact task text: - [ ] task text
      // Note: Allow trailing content after the task text (e.g., agent anchors)
      const taskRegex = new RegExp(
        `^(\\s*[-*]\\s*\\[[ xX\\/]\\]\\s*)${taskText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
        'm',
      );

      // Also try to match linked task format: - [ ] [Task Title](intent://local/task/{noteId})
      // This handles cases where task blocks have been auto-converted to linked tasks
      // Note: Allow trailing content after the link (e.g., agent anchors like <!--agent:id-->)
      const escapedTaskText = taskText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Escape the URL base for use in regex (escapes :, /, etc.)
      const escapedTaskUrlBase = TASK_URL_BASE.replace(/[.*+?^${}()|[\]\\/:]/g, '\\$&');
      const linkedTaskRegex = new RegExp(
        `^(\\s*[-*]\\s*\\[[ xX\\/]\\]\\s*)\\[${escapedTaskText}\\]\\(${escapedTaskUrlBase}([a-f0-9-]+)\\)`,
        'm',
      );

      const exactMatch = taskRegex.test(noteContent);
      let linkedMatch = noteContent.match(linkedTaskRegex);

      // If exact regex match fails, try fuzzy matching against all linked tasks
      // This handles cases where there are subtle text differences (whitespace, unicode, etc.)
      if (!exactMatch && !linkedMatch) {
        // Use fresh regex instance to avoid issues with lastIndex state
        const fuzzyTaskLinkRegex = new RegExp(TASK_LINK_REGEX.source, 'g');
        let match;
        let bestMatch: { match: RegExpExecArray; matchType: string } | null = null;

        while ((match = fuzzyTaskLinkRegex.exec(noteContent)) !== null) {
          const linkedTaskText = match[1];
          const linkedNoteId = match[2];
          const normalizedLinkedText = normalizeText(linkedTaskText);
          const linkedTaskNameOnly = extractTaskName(linkedTaskText);

          // Check if normalized texts match exactly
          if (normalizedLinkedText === normalizedTaskText) {
            logger.info('Found linked task via normalized matching', {
              taskText: taskText.substring(0, 80),
              linkedTaskText: linkedTaskText.substring(0, 80),
              linkedNoteId,
            });
            bestMatch = { match, matchType: 'exact' };
            break; // Exact match, use it
          }

          // Check if task names match (ignoring description after em-dash)
          // This handles "Create Theme Store" matching "**Create Theme Store** — Build a Svelte store..."
          if (taskNameOnly && linkedTaskNameOnly && linkedTaskNameOnly === taskNameOnly) {
            logger.info('Found linked task via task name matching', {
              taskNameOnly,
              linkedTaskNameOnly,
              linkedNoteId,
            });
            // Keep looking for a better match, but remember this one
            if (!bestMatch) {
              bestMatch = { match, matchType: 'name' };
            }
            continue;
          }

          // Check if one text starts with the other (prefix match)
          // This handles partial matches where the link title is truncated
          if (
            normalizedLinkedText.startsWith(taskNameOnly) ||
            taskNameOnly.startsWith(normalizedLinkedText)
          ) {
            logger.info('Found linked task via prefix matching', {
              taskNameOnly,
              normalizedLinkedText: normalizedLinkedText.substring(0, 80),
              linkedNoteId,
            });
            if (!bestMatch) {
              bestMatch = { match, matchType: 'prefix' };
            }
            continue;
          }
        }

        if (bestMatch) {
          // Create a fake match array with the same structure as the regex match
          linkedMatch = [bestMatch.match[0], '', bestMatch.match[2], ''] as RegExpMatchArray;
        }
      }

      // Debug logging to understand matching failures
      logger.info('Task matching debug', {
        taskText: taskText.substring(0, 100),
        taskNameOnly,
        taskTextLength: taskText.length,
        noteContentLength: noteContent.length,
        exactMatch,
        linkedMatch: !!linkedMatch,
        linkedMatchDetails: linkedMatch
          ? { fullMatch: linkedMatch[0].substring(0, 100), noteId: linkedMatch[2] }
          : null,
      });

      if (!exactMatch && !linkedMatch) {
        // Additional debug: show available linked tasks for troubleshooting
        const debugTaskLinkRegex = new RegExp(TASK_LINK_REGEX.source, 'g');
        const allLinkedTasks: { title: string; name: string }[] = [];
        let match;
        while ((match = debugTaskLinkRegex.exec(noteContent)) !== null) {
          allLinkedTasks.push({
            title: match[1].substring(0, 80),
            name: extractTaskName(match[1]),
          });
        }
        logger.info('Available linked tasks in note', {
          noteId,
          linkedTaskCount: allLinkedTasks.length,
          linkedTasks: allLinkedTasks,
          searchedFor: normalizedTaskText.substring(0, 80),
          searchedForName: taskNameOnly,
        });

        return this.error(
          `Task "${taskText}" not found in note "${noteId}". Make sure the task text matches exactly.`,
        );
      }

      // Build the initial message for the agent
      const parentNoteTitle = noteResult.data.title || noteId;
      let initialMessage = taskText;
      if (agentInstructions) {
        initialMessage += `\n\n${agentInstructions}`;
      }

      let resolvedTaskNoteId: string;
      let existingTaskNote = false;

      if (linkedMatch) {
        // Task has already been converted to a linked task note - use the existing note
        resolvedTaskNoteId = linkedMatch[2];
        existingTaskNote = true;
        logger.info('Found existing linked task note for delegation', {
          taskNoteId: resolvedTaskNoteId,
          taskText,
        });
      } else {
        // Create a new task note for this task
        const taskNoteContent = this.buildTaskNoteContent(taskText, noteId, parentNoteTitle);

        const createNoteResult = await protocolAdapter.createNote({
          workspaceId: this.workspaceId,
          title: stripMarkdownFormatting(taskText),
          content: taskNoteContent,
          parentId: noteId,
        });

        if (!createNoteResult.ok || !createNoteResult.data) {
          return this.error('Failed to create task note');
        }

        resolvedTaskNoteId = createNoteResult.data.id;
        logger.info('Created task note for delegation', {
          taskNoteId: resolvedTaskNoteId,
          taskText,
        });

        // Mark the note as a task with 'not_started' status
        // assignAgentToTask will update it to 'in_progress' when we assign the agent
        const markResult = await protocolAdapter.markAsTask({
          workspaceId: this.workspaceId,
          noteId: resolvedTaskNoteId,
          taskMetadata: {
            status: 'not_started',
            assignedAgentIds: [],
          },
        });

        if (!markResult.ok) {
          logger.error('Failed to mark note as task', {
            taskNoteId: resolvedTaskNoteId,
            error: markResult.error,
          });
          return this.error(`Failed to mark note as task: ${markResult.error}`);
        }

        logger.info('Marked note as task', { taskNoteId: resolvedTaskNoteId });
      }

      // Create the agent
      const { AgentBackendHandler } =
        await import('../../../agent/main/agent-backend-handler.service');
      const handler = AgentBackendHandler.getInstance();

      // Build enhanced initial message that tells the agent about their linked note
      const commitInstruction = skipAutoCommit
        ? '\n\n**Auto-commit is OFF.** Do not commit unless the user explicitly asks. If asked, use `agent_commit_changes` with `userRequested: true`.'
        : '';
      const enhancedInitialMessage = `${
        initialMessage
      }\n\n---\n**Your Task Note:** "${taskText}" (ID: ${resolvedTaskNoteId})\nThis note is your workspace for this task. Update it with your progress, findings, and deliverables.\n\n**SCOPE: Complete THIS task only.** When done, mark it complete and end your session. Do not pick up other tasks.${commitInstruction}`;

      // Mark as background agent since it was delegated by another agent
      // Truncate agent name to 100 characters to pass validation
      const agentName = taskText.length > 100 ? `${taskText.substring(0, 97)}...` : taskText;

      // Pre-register subscription via onBeforeStart to prevent the race condition
      // where a fast-completing child agent emits agent:idle before the parent subscribes.
      let subscriptionId = '';
      let groupId: string | undefined;
      const agent = await handler.createAgent(
        this.workspaceId,
        agentName, // Use truncated task text as agent name
        {
          workspacePath: this.workspacePath,
          model: config.model,
          provider: config.provider,
          initialMessage: enhancedInitialMessage,
          agentType: config.defaultAgentType || 'task-loop',
          behaviorPrompt: config.behaviorPrompt,
          specialistName: config.specialistName,
          roleReminder: config.roleReminder,
          metadata: {
            createdByAgentId: ctx.agentId,
            delegationDepth: parentDepth + 1,
            taskNoteId: resolvedTaskNoteId,
            ...(config.effectiveSpecialistId && { specialist: config.effectiveSpecialistId }),
            isBackground: true, // Delegated agents are background agents
            ...(skipAutoCommit && { skipAutoCommit: true }),
          },
          onBeforeStart: async (agentId: string) => {
            if (waitMode === 'after_all') {
              // Use group subscription - only wake when ALL agents in the group complete
              const { agentSubscribeToGroup } =
                await import('../../../events/main/agent-subscription-ops');

              groupId = DelegateTaskTool.getOrCreateGroupId(this.workspaceId, ctx.agentId);
              subscriptionId = agentSubscribeToGroup(
                this.workspaceId,
                ctx.agentId,
                ctx.agentName,
                groupId,
                agentId,
              );

              logger.info('Added delegated agent to wait-for-all group (via onBeforeStart)', {
                parentAgentId: ctx.agentId,
                delegatedAgentId: agentId,
                groupId,
                subscriptionId,
              });
            } else {
              // Immediate mode - wake when this agent completes, fails, or is deleted
              subscriptionId = await subscribeCallerToAgentCompletion(
                this.workspaceId,
                ctx.agentId,
                ctx.agentName,
                agentId,
              );
            }
          },
        },
      );

      if (!agent) {
        return this.error('Failed to create agent');
      }

      // Assign the agent to the task note
      const assignResult = await protocolAdapter.assignAgentToTask({
        workspaceId: this.workspaceId,
        noteId: resolvedTaskNoteId,
        agentId: agent.id,
      });

      if (!assignResult.ok) {
        logger.error('Failed to assign agent to task note', {
          taskNoteId: resolvedTaskNoteId,
          agentId: agent.id,
          error: assignResult.error,
        });
      } else {
        logger.info('Assigned agent to task note', {
          taskNoteId: resolvedTaskNoteId,
          agentId: agent.id,
          assignedAgentIds: assignResult.data?.metadata?.task?.assignedAgentIds,
        });
      }

      // Note: Task orchestration now uses parentId (sidebar hierarchy) as the dependency graph
      // The parentId is already set on the task note via createPrerequisiteNote, so no separate tracking needed

      // Only update the original note if we created a new task note (not if we're using an existing linked task)
      if (!existingTaskNote) {
        // Re-fetch the note to get the latest content (in case other delegations updated it)
        const freshNoteResult = await protocolAdapter.getNote({
          workspaceId: this.workspaceId,
          noteId,
        });
        const freshContent =
          freshNoteResult.ok && freshNoteResult.data
            ? freshNoteResult.data.content || ''
            : noteContent;

        // Update the original note to convert the checkbox to a linked task
        // Use the same format as the UI: [delegated](link) - not [taskText](link)
        // This matches the format used in NoteWithComments.svelte convertToLinkedTask
        const linkedTaskText = `[delegated](${taskNoteUrl(resolvedTaskNoteId)})`;
        const updatedContent = freshContent.replace(taskRegex, `$1${linkedTaskText}$2`);

        await protocolAdapter.updateNote(this.workspaceId, noteId, { content: updatedContent });
      }

      logger.info('Successfully delegated task', {
        taskText,
        taskNoteId: resolvedTaskNoteId,
        agentId: agent.id,
        originalNoteId: noteId,
      });

      // NOTE: agent:created event is emitted by agent-backend-handler.service.ts during agent creation.
      // We don't emit it here to avoid duplicate events in the Activity panel.
      // The event from the backend includes the agentId and agentName which is sufficient for display.

      // Subscription was already registered via onBeforeStart callback above.

      const waitModeMessage =
        waitMode === 'after_all'
          ? 'You will be notified when ALL agents in this delegation group complete.'
          : 'You will be notified when this agent completes or fails.';

      return this.success(
        `Task "${taskText}" delegated to new agent.\nAgent ID: ${agent.id}\nTask Note ID: ${resolvedTaskNoteId}\n${waitModeMessage}`,
        {
          agentId: agent.id,
          taskNoteId: resolvedTaskNoteId,
          taskText,
          originalNoteId: noteId,
          subscriptionId,
          waitMode,
          groupId,
        },
      );
    } catch (error) {
      logger.error('Error delegating task', error as Error);
      return this.error(`Failed to delegate task: ${(error as Error).message}`);
    }
  }

  /**
   * Helper method to delegate to an existing task note by ID (skips text matching)
   */
  private async delegateToExistingTaskNote(
    ctx: { agentId: string; agentName: string; provider?: string },
    taskNoteId: string,
    taskTitle: string,
    initialMessage: string,
    model: string | undefined,
    provider: string | undefined,
    waitMode: 'immediate' | 'after_all',
    protocolAdapter: any,
    parentDepth: number,
    behaviorPrompt?: string,
    skipAutoCommit?: boolean,
    specialist?: string,
    specialistName?: string,
    roleReminder?: string,
    defaultAgentType?: string,
  ): Promise<ToolResult> {
    // Create the agent
    const { AgentBackendHandler } =
      await import('../../../agent/main/agent-backend-handler.service');
    const handler = AgentBackendHandler.getInstance();

    // Build enhanced initial message that tells the agent about their linked note
    const commitInstruction = skipAutoCommit
      ? '\n\n**Auto-commit is OFF.** Do not commit unless the user explicitly asks. If asked, use `agent_commit_changes` with `userRequested: true`.'
      : '';
    const enhancedInitialMessage = `${
      initialMessage
    }\n\n---\n**Your Task Note:** "${taskTitle}" (ID: ${taskNoteId})\nThis note is your workspace for this task. Update it with your progress, findings, and deliverables.\n\n**SCOPE: Complete THIS task only.** When done, mark it complete and end your session. Do not pick up other tasks.${commitInstruction}`;

    // Mark as background agent since it was delegated by another agent
    const agentName = taskTitle.length > 100 ? `${taskTitle.substring(0, 97)}...` : taskTitle;

    // Pre-register subscription via onBeforeStart to prevent the race condition
    // where a fast-completing child agent emits agent:idle before the parent subscribes.
    let subscriptionId = '';
    let groupId: string | undefined;

    const agent = await handler.createAgent(this.workspaceId, agentName, {
      workspacePath: this.workspacePath,
      model,
      provider: provider || ctx.provider,
      initialMessage: enhancedInitialMessage,
      agentType: defaultAgentType || 'task-loop',
      behaviorPrompt,
      specialistName,
      roleReminder,
      metadata: {
        createdByAgentId: ctx.agentId,
        delegationDepth: parentDepth + 1,
        taskNoteId,
        isBackground: true,
        ...(skipAutoCommit && { skipAutoCommit: true }),
        ...(specialist && { specialist }),
      },
      onBeforeStart: async (agentId: string) => {
        if (waitMode === 'after_all') {
          const { agentSubscribeToGroup } =
            await import('../../../events/main/agent-subscription-ops');

          groupId = DelegateTaskTool.getOrCreateGroupId(this.workspaceId, ctx.agentId);
          subscriptionId = agentSubscribeToGroup(
            this.workspaceId,
            ctx.agentId,
            ctx.agentName,
            groupId,
            agentId,
          );

          logger.info('Added delegated agent to wait-for-all group (via onBeforeStart)', {
            parentAgentId: ctx.agentId,
            delegatedAgentId: agentId,
            groupId,
            subscriptionId,
          });
        } else {
          subscriptionId = await subscribeCallerToAgentCompletion(
            this.workspaceId,
            ctx.agentId,
            ctx.agentName,
            agentId,
          );
        }
      },
    });

    if (!agent) {
      return this.error('Failed to create agent');
    }

    // Assign the agent to the task note
    const assignResult = await protocolAdapter.assignAgentToTask({
      workspaceId: this.workspaceId,
      noteId: taskNoteId,
      agentId: agent.id,
    });

    if (!assignResult.ok) {
      logger.error('Failed to assign agent to task note', {
        taskNoteId,
        agentId: agent.id,
        error: assignResult.error,
      });
    } else {
      logger.info('Assigned agent to task note', {
        taskNoteId,
        agentId: agent.id,
        assignedAgentIds: assignResult.data?.metadata?.task?.assignedAgentIds,
      });
    }

    logger.info('Successfully delegated task by note ID', {
      taskTitle,
      taskNoteId,
      agentId: agent.id,
    });

    // NOTE: agent:created event is emitted by agent-backend-handler.service.ts during agent creation.
    // We don't emit it here to avoid duplicate events in the Activity panel.
    // The event from the backend includes the agentId and agentName which is sufficient for display.

    // Subscription was already registered via onBeforeStart callback above.

    const waitModeMessage =
      waitMode === 'after_all'
        ? 'You will be notified when ALL agents in this delegation group complete.'
        : 'You will be notified when this agent completes or fails.';

    return this.success(
      `Task "${taskTitle}" delegated to new agent.\nAgent ID: ${agent.id}\nTask Note ID: ${taskNoteId}\n${waitModeMessage}`,
      {
        agentId: agent.id,
        taskNoteId,
        taskText: taskTitle,
        subscriptionId,
        waitMode,
        groupId,
      },
    );
  }

  private buildTaskNoteContent(
    taskText: string,
    parentNoteId: string,
    parentNoteTitle: string,
  ): string {
    return [
      '## Initial Prompt',
      '',
      taskText,
      '',
      '## Hypothesized Acceptance Criteria',
      '',
      '(to be filled by agent)',
      '',
      '## References',
      '',
      `- Originated from checklist in [${parentNoteTitle}](${noteUrl(parentNoteId)})`,
      '',
      '## Learnings',
      '',
      '(empty)',
      '',
      '## Changes',
      '',
      '(empty)',
    ].join('\n');
  }
}

// ============================================================================
// Send Message Tool
// ============================================================================

/**
 * Tool for sending a message to another agent.
 * Uses ToolCallContext to get the sender agent's information.
 */
export class SendMessageToAgentTool extends BaseMCPTool {
  constructor(private workspaceId: string) {
    super(
      'send_message_to_agent',
      `Send a message to another agent. The message will be queued and delivered when the target agent becomes idle. Use priority "interrupt" to stop the agent's current response and deliver the message immediately.
Use this for coordination, sharing information, or requesting help from other agents.`,
      createInputSchema(
        {
          agentId: stringProperty('ID of the target agent'),
          message: stringProperty('Message content to send'),
          priority: stringProperty(
            'Message priority: "normal" for delivery when idle, "high" for immediate delivery when idle, "interrupt" to stop the agent mid-response and deliver immediately',
            {
              enum: ['high', 'normal', 'interrupt'],
              default: 'normal',
            },
          ),
        },
        ['agentId', 'message'],
      ),
    );
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const ctx = getRequiredContext(call);
      const { agentId, message, priority } = call.arguments;

      logger.info('Sending message to agent', {
        fromAgentId: ctx.agentId,
        toAgentId: agentId,
        priority: priority || 'normal',
      });

      // Emit via Redux (which handles persistence and broadcast via sagas)
      const { createWorkspaceEvent } = await import('../../../events/types');
      const { mainDispatch } = await import('../../../../store/main/redux-store-bridge');
      const { emitWorkspaceEvent: reduxEmitWorkspaceEvent } = await import('../../../../store/main/slices/workspace-events/workspace-events-slice');

      const event = createWorkspaceEvent(
        'agent:message:sent',
        this.workspaceId,
        { type: 'agent', id: ctx.agentId, name: ctx.agentName },
        {
          fromAgentId: ctx.agentId,
          fromAgentName: ctx.agentName,
          toAgentId: agentId,
          message,
          priority: priority || 'normal',
        },
      );
      mainDispatch(reduxEmitWorkspaceEvent(event));

      // Subscribe the sender to receive a notification when the target agent responds
      const subscriptionId = await subscribeCallerToAgentCompletion(
        this.workspaceId,
        ctx.agentId,
        ctx.agentName,
        agentId,
      );

      const deliveryMessage = priority === 'interrupt'
        ? `Message sent to agent ${agentId}. If the agent is currently streaming, this will attempt to interrupt and deliver immediately. Otherwise, the message will be delivered normally when the agent is idle. If interruption fails, the message will be queued.\nYou will be notified when the agent responds.`
        : `Message sent to agent ${agentId}. The message will be delivered when the agent becomes idle.\nYou will be notified when the agent responds.`;

      return this.success(
        deliveryMessage,
        { sent: true, toAgentId: agentId, subscriptionId },
      );
    } catch (error) {
      logger.error('Error sending message to agent', error as Error);
      return this.error(`Failed to send message: ${(error as Error).message}`);
    }
  }
}

// ============================================================================
// Send Message to Task Agent Tool
// ============================================================================

/**
 * Tool for sending a message to the agent assigned to a task note.
 * This is a higher-level convenience tool that looks up the agent from the task.
 */
export class SendMessageToTaskAgentTool extends BaseMCPTool {
  constructor(private workspaceId: string) {
    super(
      'send_message_to_task_agent',
      `Send a follow-up message to the agent working on a specific task.
Use this when you want to ask a task agent to make corrections, provide additional context,
or request changes to their work. Use priority "interrupt" to stop the agent's current response and deliver the message immediately.

This is more convenient than send_message_to_agent because you only need the task note ID,
not the agent ID. The tool automatically finds which agent is assigned to the task.`,
      createInputSchema(
        {
          taskNoteId: stringProperty('ID of the task note (from "intent://local/task/{id}" links)'),
          message: stringProperty(
            'Message content to send. Be specific about what changes or corrections you need.',
          ),
          priority: stringProperty(
            'Message priority: "normal" for delivery when idle, "high" for immediate delivery when idle, "interrupt" to stop the agent mid-response and deliver immediately',
            {
              enum: ['high', 'normal', 'interrupt'],
              default: 'normal',
            },
          ),
        },
        ['taskNoteId', 'message'],
      ),
    );
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const ctx = getRequiredContext(call);
      const { taskNoteId, message, priority } = call.arguments;

      logger.info('Looking up agent for task note', {
        fromAgentId: ctx.agentId,
        taskNoteId,
      });

      // Get the task note to find assigned agent
      const { protocolAdapter } = await import('../../../protocol/main/protocol-adapter');
      const noteResult = await protocolAdapter.getNote({
        workspaceId: this.workspaceId,
        noteId: taskNoteId,
      });

      if (!noteResult.ok || !noteResult.data) {
        return this.error(`Task note "${taskNoteId}" not found`);
      }

      const note = noteResult.data;

      // Check if it's a task with assigned agents
      if (!note.metadata?.task) {
        return this.error(`Note "${taskNoteId}" is not a task note`);
      }

      const assignedAgentIds = note.metadata.task.assignedAgentIds || [];
      if (assignedAgentIds.length === 0) {
        return this.error(
          `Task "${note.title || taskNoteId}" has no agents assigned. ` +
            'Use delegate_task to assign an agent first.',
        );
      }

      // Send message to the most recently assigned agent (last in array)
      const targetAgentId = assignedAgentIds[assignedAgentIds.length - 1];

      logger.info('Sending message to task agent', {
        fromAgentId: ctx.agentId,
        toAgentId: targetAgentId,
        taskNoteId,
        priority: priority || 'normal',
      });

      // Emit via Redux (which handles persistence and broadcast via sagas)
      const { createWorkspaceEvent } = await import('../../../events/types');
      const { mainDispatch } = await import('../../../../store/main/redux-store-bridge');
      const { emitWorkspaceEvent: reduxEmitWorkspaceEvent } = await import('../../../../store/main/slices/workspace-events/workspace-events-slice');

      const event = createWorkspaceEvent(
        'agent:message:sent',
        this.workspaceId,
        { type: 'agent', id: ctx.agentId, name: ctx.agentName },
        {
          fromAgentId: ctx.agentId,
          fromAgentName: ctx.agentName,
          toAgentId: targetAgentId,
          message,
          priority: priority || 'normal',
          taskNoteId, // Include task context
        },
      );
      mainDispatch(reduxEmitWorkspaceEvent(event));

      // Subscribe the sender to receive a notification when the target agent responds
      const subscriptionId = await subscribeCallerToAgentCompletion(
        this.workspaceId,
        ctx.agentId,
        ctx.agentName,
        targetAgentId,
      );

      const taskDeliveryMessage = priority === 'interrupt'
        ? `Message sent to agent ${targetAgentId} (working on "${note.title || taskNoteId}"). ` +
          'If the agent is currently streaming, this will attempt to interrupt and deliver immediately. Otherwise, the message will be delivered normally when the agent is idle. If interruption fails, the message will be queued.\nYou will be notified when the agent responds.'
        : `Message sent to agent ${targetAgentId} (working on "${note.title || taskNoteId}"). ` +
          'The message will be delivered when the agent becomes idle.\nYou will be notified when the agent responds.';

      return this.success(
        taskDeliveryMessage,
        {
          sent: true,
          toAgentId: targetAgentId,
          taskNoteId,
          taskTitle: note.title,
          totalAssignedAgents: assignedAgentIds.length,
          subscriptionId,
        },
      );
    } catch (error) {
      logger.error('Error sending message to task agent', error as Error);
      return this.error(`Failed to send message: ${(error as Error).message}`);
    }
  }
}

// ============================================================================
// Subscribe to Events Tool
// ============================================================================

/**
 * Tool for subscribing to workspace events.
 * Uses ToolCallContext to get the subscribing agent's information.
 */
export class SubscribeToEventsTool extends BaseMCPTool {
  constructor(private workspaceId: string) {
    super(
      'subscribe_to_events',
      `Subscribe to workspace events. You will be notified when matching events occur.
Events are batched and delivered when you become idle (finish responding).
Use this to monitor other agents, file changes, task completions, etc.

Event types you can subscribe to:
- "agent:*" - All agent events (created, idle, completed, messages)
- "agent:created" - When a new agent is created
- "agent:idle" - When an agent finishes responding
- "agent:message:sent" - When an agent sends a message
- "file:*" - All file events (changed, created, deleted, renamed)
- "task:*" - All task events (status changes, ready tasks)
- "git:*" - All git events (commit, push, pull, branch, merge)
- "note:*" - All note events (created, updated, deleted)
- "terminal:*" - Terminal command events
- "test:*" - Test events (started, completed)
- "build:*" - Build events (started, completed)

You must specify at least one category. Use category wildcards like "agent:*" or specific types like "agent:idle".`,
      createInputSchema(
        {
          eventTypes: arrayProperty(
            'Event types to subscribe to. Use category wildcards like "agent:*" or specific types like "file:changed". Bare "*" is not allowed — specify the categories you need.',
            'string',
          ),
          excludeSelf: booleanProperty('Exclude events caused by yourself (default: true)', {
            default: true,
          }),
          batchWindow: numberProperty(
            'Milliseconds to batch events before delivery (default: 500)',
            {
              default: 500,
            },
          ),
        },
        ['eventTypes'],
      ),
    );
  }

  /**
   * Valid category wildcards that agents can subscribe to.
   * Bare '*' is not allowed — agents must specify which categories they need.
   */
  private static readonly VALID_CATEGORY_WILDCARDS = [
    'agent:*', 'file:*', 'task:*', 'git:*', 'note:*',
    'terminal:*', 'test:*', 'build:*', 'workspace:*',
    'spec:*', 'goal:*', 'comment:*',
  ];

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const ctx = getRequiredContext(call);
      const { eventTypes, excludeSelf, batchWindow } = call.arguments;

      if (!eventTypes || eventTypes.length === 0) {
        return this.error(
          'eventTypes is required. Specify category wildcards like "agent:*", "file:*" or specific types like "agent:idle".',
        );
      }

      // Reject bare '*' — force agents to be explicit about what they need
      const resolvedTypes: string[] = [];
      for (const t of eventTypes) {
        if (t === '*') {
          logger.warn('Agent attempted to subscribe to bare "*", expanding to category wildcards', {
            agentId: ctx.agentId,
          });
          resolvedTypes.push(...SubscribeToEventsTool.VALID_CATEGORY_WILDCARDS);
        } else {
          resolvedTypes.push(t);
        }
      }

      const { agentSubscribe } =
        await import('../../../events/main/agent-subscription-ops');

      const filter: AgentEventFilter = {
        eventTypes: resolvedTypes,
        excludeActorIds: excludeSelf !== false ? [ctx.agentId] : undefined,
        batchWindow: batchWindow || 500,
      };

      const subscriptionId = agentSubscribe(this.workspaceId, ctx.agentId, ctx.agentName, filter);

      logger.info('Agent subscribed to events', {
        agentId: ctx.agentId,
        subscriptionId,
        eventTypes: resolvedTypes,
      });

      return this.success(
        `Subscribed to events: ${resolvedTypes.join(', ')}\nSubscription ID: ${subscriptionId}\nYou will receive notifications when matching events occur.`,
        { subscriptionId, eventTypes: resolvedTypes },
      );
    } catch (error) {
      logger.error('Error subscribing to events', error as Error);
      return this.error(`Failed to subscribe: ${(error as Error).message}`);
    }
  }
}

// ============================================================================
// Unsubscribe from Events Tool
// ============================================================================

/**
 * Tool for unsubscribing from events.
 */
export class UnsubscribeFromEventsTool extends BaseMCPTool {
  constructor(private workspaceId: string) {
    super(
      'unsubscribe_from_events',
      'Unsubscribe from workspace events. Use the subscription ID returned from subscribe_to_events.',
      createInputSchema(
        {
          subscriptionId: stringProperty('The subscription ID to cancel'),
        },
        ['subscriptionId'],
      ),
    );
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { subscriptionId } = call.arguments;

      const { agentUnsubscribe } =
        await import('../../../events/main/agent-subscription-ops');

      const success = agentUnsubscribe(this.workspaceId, subscriptionId);

      if (!success) {
        return this.error('Subscription not found');
      }

      return this.success(`Unsubscribed from events. Subscription ${subscriptionId} cancelled.`);
    } catch (error) {
      logger.error('Error unsubscribing from events', error as Error);
      return this.error(`Failed to unsubscribe: ${(error as Error).message}`);
    }
  }
}

// ============================================================================
// List Agents Tool
// ============================================================================

/**
 * Tool for listing agents in the workspace.
 */
export class ListAgentsTool extends BaseMCPTool {
  constructor(private workspaceId: string) {
    super(
      'list_agents',
      'List all agents in the workspace. Use this to see what other agents are working on.',
      createInputSchema(
        {
          status: arrayProperty(
            'Filter by status: "idle", "responding", "completed", "failed" (default: all)',
            'string',
          ),
          includeCompleted: booleanProperty('Include completed agents (default: false)', {
            default: false,
          }),
        },
        [],
      ),
    );
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { status, includeCompleted } = call.arguments;

      const { AgentBackendHandler } =
        await import('../../../agent/main/agent-backend-handler.service');
      const { selectAgentStatus } =
        await import('../../../../store/main/slices/agent-subscriptions/agent-subscriptions-selectors');
      const { getMainState } =
        await import('../../../../store/main/redux-store-bridge');
      const handler = AgentBackendHandler.getInstance();

      // Get all agents for the workspace (in-memory + disk-persisted)
      // This ensures agents are visible across app restarts even if not loaded into memory
      const agents = await handler.listAllAgents(this.workspaceId);

      // Enhance agents with real-time status from Redux store
      const enhancedAgents = agents.map((a: any) => {
        // Get real-time status from Redux store
        const realtimeStatus = selectAgentStatus.select(getMainState(), this.workspaceId, a.id);
        return {
          ...a,
          // Use real-time status if available, otherwise fall back to session status
          status: realtimeStatus || a.status,
          sessionStatus: a.status, // Keep original session status for reference
        };
      });

      // Filter by status if specified (now using real-time status)
      let filteredAgents = enhancedAgents;
      if (status && status.length > 0) {
        filteredAgents = enhancedAgents.filter((a: any) => status.includes(a.status));
      }

      // Filter out completed unless requested
      if (!includeCompleted) {
        filteredAgents = filteredAgents.filter(
          (a: any) => a.status !== 'completed' && a.status !== 'failed',
        );
      }

      if (filteredAgents.length === 0) {
        return this.success('No agents found in workspace.', { agents: [] });
      }

      const lines = ['Agents in workspace:', ''];
      for (const agent of filteredAgents) {
        lines.push(`- ${agent.name} (${agent.id})`);
        lines.push(`  Status: ${agent.status}`);
        if (agent.metadata?.taskNoteId) {
          lines.push(`  Task: ${agent.metadata.taskNoteId}`);
        }
        lines.push('');
      }

      const agentInfos = filteredAgents.map((a: any) => ({
        id: a.id,
        name: a.name,
        status: a.status,
        messageCount: a.messages?.length || 0,
        taskNoteId: a.metadata?.taskNoteId,
      }));

      return this.success(lines.join('\n'), { agents: agentInfos });
    } catch (error) {
      logger.error('Error listing agents', error as Error);
      return this.error(`Failed to list agents: ${(error as Error).message}`);
    }
  }
}

// ============================================================================
// Get Agent Status Tool
// ============================================================================

/**
 * Tool for getting detailed status of an agent.
 */
export class GetAgentStatusTool extends BaseMCPTool {
  constructor(private workspaceId: string) {
    super(
      'get_agent_status',
      'Get detailed status of a specific agent including its current activity and message count.',
      createInputSchema(
        {
          agentId: stringProperty('ID of the agent to check'),
        },
        ['agentId'],
      ),
    );
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { agentId } = call.arguments;

      const { AgentBackendHandler } =
        await import('../../../agent/main/agent-backend-handler.service');
      const { selectAgentStatus } =
        await import('../../../../store/main/slices/agent-subscriptions/agent-subscriptions-selectors');
      const { getMainState } =
        await import('../../../../store/main/redux-store-bridge');
      const handler = AgentBackendHandler.getInstance();

      const agent = await handler.getAgent(agentId);

      if (!agent) {
        return this.error(`Agent ${agentId} not found`);
      }

      // Get real-time status from Redux store
      const realtimeStatus = selectAgentStatus.select(getMainState(), this.workspaceId, agentId);
      const effectiveStatus = realtimeStatus || agent.status;

      const lines = [
        `Agent: ${agent.name}`,
        `ID: ${agent.id}`,
        `Status: ${effectiveStatus}`,
        `Messages: ${agent.messages?.length || 0}`,
      ];

      if (agent.metadata?.taskNoteId) {
        lines.push(`Task: ${agent.metadata.taskNoteId}`);
      }
      if (agent.createdAt) {
        lines.push(`Created: ${agent.createdAt}`);
      }
      if (agent.lastActivity) {
        lines.push(`Last Active: ${agent.lastActivity}`);
      }

      return this.success(lines.join('\n'), {
        agent: {
          id: agent.id,
          name: agent.name,
          status: effectiveStatus,
          messageCount: agent.messages?.length || 0,
          taskNoteId: agent.metadata?.taskNoteId,
          createdAt: agent.createdAt,
          lastActivity: agent.lastActivity,
        },
      });
    } catch (error) {
      logger.error('Error getting agent status', error as Error);
      return this.error(`Failed to get agent status: ${(error as Error).message}`);
    }
  }
}

// ============================================================================
// Wake or Create Task Agent Tool
// ============================================================================

/**
 * Tool for waking an existing agent or creating a new one for a task.
 * This is the core primitive for the task orchestration system.
 *
 * Resolution strategy:
 * 1. Get task's assignedAgentIds
 * 2. Check each agent's resumability (most recent first)
 * 3. If resumable agent found: wake it with contextMessage
 * 4. If no resumable agent: create new task-loop agent and assign to task
 */
export class WakeOrCreateTaskAgentTool extends BaseMCPTool {
  constructor(
    private workspaceId: string,
    private workspacePath: string,
  ) {
    super(
      'wake_or_create_task_agent',
      `Wake an existing agent or create a new one for a task.

This tool handles the complexity of agent resolution for tasks:
1. Checks if the task has assigned agents
2. Finds a resumable agent (running or can be restored from disk)
3. If found, wakes it with your context message
4. If not found, creates a new agent assigned to the task

Use this when task dependencies become ready and you need to ensure
an agent is working on the task.`,
      createInputSchema(
        {
          taskNoteId: stringProperty('ID of the task note'),
          contextMessage: stringProperty(
            'Message to send to the agent. Include synthesized context from completed dependencies, any relevant decisions or warnings, and what the agent should do next.',
          ),
          model: stringProperty(
            'Optional: Model to use for new agents (defaults to workspace default)',
          ),
        },
        ['taskNoteId', 'contextMessage'],
      ),
    );
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const ctx = getRequiredContext(call);

      // Check delegation depth limit to prevent unbounded recursive agent creation
      const parentDepth = await getDelegationDepth(this.workspaceId, ctx.agentId);
      if (parentDepth >= MAX_DELEGATION_DEPTH) {
        return this.error(
          `Cannot create task agent: maximum delegation depth (${MAX_DELEGATION_DEPTH}) reached. ` +
            `You are at depth ${parentDepth}. Please complete this task directly instead of delegating further.`,
        );
      }

      const { taskNoteId, contextMessage, model: rawModel } = call.arguments;

      // Validate the model argument against the parent's provider.
      // If the LLM specified a model from a different provider, discard it and
      // let the child agent inherit the parent's default model instead.
      let model = rawModel;
      if (model && ctx.provider) {
        if (!isModelValidForProvider(model, ctx.provider)) {
          logger.warn('wake_or_create_task_agent: model belongs to different provider, discarding', {
            model,
            parentProvider: ctx.provider,
          });
          model = undefined;
        }
      }

      // Check workspace auto-commit setting
      const { isAutoCommitEnabled } =
        await import('../../../workspace/main/workspace-settings.service');
      const autoCommitEnabled = isAutoCommitEnabled(this.workspaceId);

      logger.info('Wake or create task agent', {
        taskNoteId,
        callerAgentId: ctx.agentId,
        workspaceId: this.workspaceId,
        autoCommitEnabled,
      });

      // Get the task note to find assigned agents
      const { notesService } = await import('../../../notes/main/notes.service');
      const { NoteId, WorkspaceId } = await import('$shared/types/branded-ids');

      const noteResult = await notesService.getNote(
        WorkspaceId(this.workspaceId),
        NoteId(taskNoteId),
      );

      if (!noteResult.ok || !noteResult.data) {
        return this.error(`Task note "${taskNoteId}" not found`);
      }

      const note = noteResult.data;

      // Verify it's a task
      if (!note.metadata?.task) {
        return this.error(`Note "${taskNoteId}" is not a task`);
      }

      const assignedAgentIds = note.metadata.task.assignedAgentIds || [];

      // Try to find a resumable agent (check most recent first)
      const { AgentBackendHandler } =
        await import('../../../agent/main/agent-backend-handler.service');
      const handler = AgentBackendHandler.getInstance();

      let agentToWake: { id: string; status: string } | null = null;
      let previousSpecialist: string | undefined;

      for (let i = assignedAgentIds.length - 1; i >= 0; i--) {
        const agentId = assignedAgentIds[i];
        const resumability = await handler.getAgentResumability(agentId, this.workspaceId);

        logger.debug('Checking agent resumability', {
          agentId,
          status: resumability.status,
          canWake: resumability.canWake,
        });

        // Extract specialist from the most recent agent's metadata for new agent creation
        if (!previousSpecialist && resumability.agentData?.metadata?.specialist) {
          previousSpecialist = resumability.agentData.metadata.specialist as string;
        }

        if (resumability.canWake) {
          agentToWake = { id: agentId, status: resumability.status };
          break;
        }
      }

      if (agentToWake) {
        // Wake the existing agent
        logger.info('Waking existing agent for task', {
          agentId: agentToWake.id,
          taskNoteId,
          status: agentToWake.status,
        });

        const wakeResult = await handler.sendBackendInitiatedMessage({
          sessionId: agentToWake.id,
          workspaceId: this.workspaceId,
          message: contextMessage,
          messageMetadata: {
            type: 'task_wake',
            source: 'wake_or_create_task_agent',
            taskNoteId,
            callerAgentId: ctx.agentId,
          },
        });

        if (!wakeResult.success) {
          // Check if the failure is because the agent is already streaming/responding.
          // This happens when another tool (e.g., send_message_to_task_agent) already
          // woke the agent. In this case, DON'T create a new agent — queue the message.
          const isAlreadyStreaming = wakeResult.errorCode === 'ALREADY_STREAMING';

          if (isAlreadyStreaming) {
            logger.info(
              'Agent is already actively streaming, queueing context message instead of creating duplicate',
              {
                agentId: agentToWake.id,
                taskNoteId,
                error: wakeResult.error,
              },
            );

            // Queue the context message for delivery when agent finishes its current turn
            const queueResult = await handler.handleQueueMessage(null, {
              agentId: agentToWake.id,
              content: contextMessage,
            });

            if (!queueResult.success) {
              logger.error('Failed to queue context message for streaming agent', {
                agentId: agentToWake.id,
                taskNoteId,
                error: queueResult.error,
              });
              return this.error(
                `Agent is already streaming but failed to queue context message: ${queueResult.error}`,
              );
            }

            // For queued messages, DON'T use oneShot since agent:idle will fire
            // for the current turn before our queued message is processed.
            // The subscription needs to survive the current turn's completion.
            const { agentSubscribe, agentUnsubscribe } =
              await import('../../../events/main/agent-subscription-ops');

            const subscriptionId = agentSubscribe(this.workspaceId, ctx.agentId, ctx.agentName, {
              eventTypes: [...AGENT_COMPLETION_EVENT_TYPES],
              actorIds: [agentToWake.id],
              priority: 'high',
              oneShot: false, // NOT oneShot — needs to survive current turn's agent:idle
            });

            // Auto-cleanup: unsubscribe after 5 minutes to prevent notification leak.
            // The queued message should be processed well within this window.
            setTimeout(() => {
              const didUnsubscribe = agentUnsubscribe(this.workspaceId, subscriptionId);
              if (didUnsubscribe) {
                logger.info('Auto-cleaned up queued message subscription after timeout', {
                  subscriptionId,
                  callerId: ctx.agentId,
                  targetAgentId: agentToWake.id,
                });
              }
            }, 5 * 60 * 1000);

            logger.info('Subscribed caller to agent completion (non-oneShot for queued message)', {
              callerId: ctx.agentId,
              callerName: ctx.agentName,
              targetAgentId: agentToWake.id,
              subscriptionId,
            });

            return this.success(
              `Agent "${agentToWake.id}" is already actively working on task "${note.title || taskNoteId}".\n` +
                'Context message has been queued and will be delivered when the agent finishes its current response.\n' +
                'You will be notified when the agent responds.',
              {
                action: 'message_queued_to_active_agent',
                agentId: agentToWake.id,
                taskNoteId,
                taskTitle: note.title,
                subscriptionId,
              },
            );
          }

          logger.warn('Failed to wake agent, falling back to create', {
            agentId: agentToWake.id,
            error: wakeResult.error,
          });
          // Fall through to create a new agent
        } else {
          // Subscribe the caller to receive a notification when the woken agent responds
          const subscriptionId = await subscribeCallerToAgentCompletion(
            this.workspaceId,
            ctx.agentId,
            ctx.agentName,
            agentToWake.id,
          );

          return this.success(
            `Woke existing agent "${agentToWake.id}" for task "${note.title || taskNoteId}".\n` +
              `Agent status: ${agentToWake.status}\n` +
              'Context message delivered.\nYou will be notified when the agent responds.',
            {
              action: 'woke_existing',
              agentId: agentToWake.id,
              taskNoteId,
              taskTitle: note.title,
              subscriptionId,
            },
          );
        }
      }

      // No resumable agent found (or wake failed), create a new one
      logger.info('Creating new agent for task', {
        taskNoteId,
        noteTitle: note.title,
        previousAgentCount: assignedAgentIds.length,
      });

      // Pre-register subscription via onBeforeStart to prevent the race condition
      // where a fast-completing child agent emits agent:idle before the parent subscribes.
      const agentName = `Task: ${note.title || taskNoteId}`.substring(0, 100);
      let subscriptionId = '';
      // Extract parent provider so child agents inherit the correct provider
      const parentProvider = ctx.model ? parseCompoundModelId(ctx.model).providerId : undefined;

      // Resolve defaultAgentType from previous agent's specialist (if any)
      const previousSpecialistConfig = previousSpecialist
        ? resolveSpecialistForAgent(previousSpecialist, parentProvider)
        : null;

      const wakeProvider = previousSpecialistConfig?.codingAgent || ctx.provider;
      const wakeModel = model || previousSpecialistConfig?.model;

      const newAgent = await handler.createAgent(this.workspaceId, agentName, {
        workspacePath: this.workspacePath,
        model: wakeModel,
        provider: wakeProvider,
        initialMessage: contextMessage,
        agentType: previousSpecialistConfig?.defaultAgentType || 'task-loop',
        contextReferences: [
          {
            type: 'note',
            id: taskNoteId,
            name: note.title || taskNoteId,
          },
        ],
        metadata: {
          createdByAgentId: ctx.agentId,
          delegationDepth: parentDepth + 1,
          taskNoteId,
          isBackground: true, // Task agents run in background
          source: 'wake_or_create_task_agent',
          ...(!autoCommitEnabled && { skipAutoCommit: true }),
        },
        onBeforeStart: async (agentId: string) => {
          subscriptionId = await subscribeCallerToAgentCompletion(
            this.workspaceId,
            ctx.agentId,
            ctx.agentName,
            agentId,
          );
        },
      });

      if (!newAgent) {
        return this.error('Failed to create new agent for task');
      }

      // Assign the new agent to the task
      const { AgentId } = await import('$shared/types/branded-ids');
      const assignResult = await notesService.assignAgentToTask(
        WorkspaceId(this.workspaceId),
        NoteId(taskNoteId),
        AgentId(newAgent.id),
      );

      if (!assignResult.ok) {
        logger.warn('Failed to assign agent to task', {
          agentId: newAgent.id,
          taskNoteId,
          error: assignResult.error,
        });
        // Don't fail - agent is created and working, assignment is just metadata
      }

      return this.success(
        `Created new agent "${newAgent.name}" for task "${note.title || taskNoteId}".\n` +
          `Agent ID: ${newAgent.id}\n` +
          'Agent is now working on the task with provided context.\nYou will be notified when the agent completes.',
        {
          action: 'created_new',
          agentId: newAgent.id,
          agentName: newAgent.name,
          taskNoteId,
          taskTitle: note.title,
          subscriptionId,
        },
      );
    } catch (error: any) {
      logger.error('Error in wake_or_create_task_agent', error);
      return this.error(`Failed to wake or create agent: ${error.message}`);
    }
  }
}

// ============================================================================
// Read Agent Conversation Tool
// ============================================================================

/**
 * Tool for reading another agent's conversation history.
 * This allows parent agents to review what their delegated agents did.
 */
export class ReadAgentConversationTool extends BaseMCPTool {
  constructor(private workspaceId: string) {
    super(
      'read_agent_conversation',
      `Read another agent's conversation history.

Use this to review what a delegated agent did, see their tool calls, and understand their progress.

You can:
- Read the full conversation
- Read only the last N messages
- Read a specific range of turns

This is useful when:
- A delegated agent has completed and you want to see what they did
- You need to understand an agent's reasoning or decisions
- You want to review tool calls and their results`,
      createInputSchema(
        {
          agentId: stringProperty('ID of the agent whose conversation to read'),
          lastN: numberProperty(
            'Optional: Only return the last N messages (default: all messages)',
          ),
          startTurn: numberProperty('Optional: Start from this turn number (1-indexed)'),
          endTurn: numberProperty('Optional: End at this turn number (1-indexed, inclusive)'),
          includeToolCalls: booleanProperty('Include tool calls in the output (default: true)'),
        },
        ['agentId'],
      ),
    );
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const ctx = getRequiredContext(call);
      const { agentId, lastN, startTurn, endTurn, includeToolCalls } = call.arguments;
      const showToolCalls = includeToolCalls !== false;

      logger.info('Reading agent conversation', {
        agentId,
        requestedBy: ctx.agentId,
        lastN,
        startTurn,
        endTurn,
      });

      // Load the agent's conversation from persistence
      const { agentPersistence } = await import('../../../agent/main/agent-persistence');
      const { AgentId, WorkspaceId } = await import('$shared/types/branded-ids');

      const loadResult = await agentPersistence.loadAgent(
        AgentId(agentId),
        WorkspaceId(this.workspaceId),
      );

      if (!loadResult.success || !loadResult.data) {
        return this.error(`Agent "${agentId}" not found or could not be loaded`);
      }

      const agent = loadResult.data;
      let messages = agent.messages || [];

      // Apply filtering
      if (startTurn !== undefined || endTurn !== undefined) {
        const start = (startTurn || 1) - 1; // Convert to 0-indexed
        const end = endTurn || messages.length;
        messages = messages.slice(start, end);
      } else if (lastN !== undefined && lastN > 0) {
        messages = messages.slice(-lastN);
      }

      // Format messages for output
      const lines: string[] = [
        `## Conversation History for Agent "${agent.name}"`,
        `Agent ID: ${agentId}`,
        `Total messages: ${agent.messages?.length || 0}`,
        `Showing: ${messages.length} messages`,
        '',
      ];

      if (agent.metadata?.taskNoteId) {
        lines.push(`Task Note: ${agent.metadata.taskNoteId}`);
        lines.push('');
      }

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const turnNum = startTurn ? startTurn + i : i + 1;

        lines.push(`### Turn ${turnNum} (${msg.role})`);
        lines.push(`_${new Date(msg.timestamp).toLocaleString()}_`);
        lines.push('');

        // Extract text content
        if (msg.contentBlocks && Array.isArray(msg.contentBlocks)) {
          for (const block of msg.contentBlocks) {
            if (block.type === 'text') {
              lines.push((block as any).text || '');
            } else if (block.type === 'tool_use' && showToolCalls) {
              const toolBlock = block as any;
              lines.push(`**Tool Call: ${toolBlock.name || 'unknown'}**`);
              if (toolBlock.input) {
                lines.push('```json');
                lines.push(JSON.stringify(toolBlock.input, null, 2).substring(0, 500));
                lines.push('```');
              }
            } else if (block.type === 'tool_result' && showToolCalls) {
              const resultBlock = block as any;
              lines.push(`**Tool Result:**`);
              const content =
                typeof resultBlock.content === 'string'
                  ? resultBlock.content.substring(0, 500)
                  : JSON.stringify(resultBlock.content, null, 2).substring(0, 500);
              lines.push('```');
              lines.push(content);
              lines.push('```');
            }
          }
        }

        lines.push('');
        lines.push('---');
        lines.push('');
      }

      return this.success(lines.join('\n'), {
        agentId,
        agentName: agent.name,
        totalMessages: agent.messages?.length || 0,
        returnedMessages: messages.length,
        taskNoteId: agent.metadata?.taskNoteId,
      });
    } catch (error) {
      logger.error('Error reading agent conversation', error as Error);
      return this.error(`Failed to read conversation: ${(error as Error).message}`);
    }
  }
}

// ============================================================================
// Get Agent Summary Tool
// ============================================================================

/**
 * Tool for getting a summary of what another agent did.
 * This provides a quick overview without reading the full conversation.
 */
export class GetAgentSummaryTool extends BaseMCPTool {
  constructor(private workspaceId: string) {
    super(
      'get_agent_summary',
      `Get a summary of what another agent did.

Returns:
- Agent status and basic info
- Last response from the agent
- Key tool calls made
- Task note (if any)

Use this for a quick overview before deciding whether to read the full conversation.`,
      createInputSchema(
        {
          agentId: stringProperty('ID of the agent to summarize'),
        },
        ['agentId'],
      ),
    );
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const ctx = getRequiredContext(call);
      const { agentId } = call.arguments;

      logger.info('Getting agent summary', {
        agentId,
        requestedBy: ctx.agentId,
      });

      // Load the agent from persistence
      const { agentPersistence } = await import('../../../agent/main/agent-persistence');
      const { AgentId, WorkspaceId } = await import('$shared/types/branded-ids');

      const loadResult = await agentPersistence.loadAgent(
        AgentId(agentId),
        WorkspaceId(this.workspaceId),
      );

      if (!loadResult.success || !loadResult.data) {
        return this.error(`Agent "${agentId}" not found or could not be loaded`);
      }

      const agent = loadResult.data;
      const messages = agent.messages || [];

      // Find last assistant message
      let lastResponse = '';
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role === 'assistant') {
          if (msg.contentBlocks && Array.isArray(msg.contentBlocks)) {
            lastResponse = msg.contentBlocks
              .filter((block: any) => block.type === 'text')
              .map((block: any) => block.text || '')
              .join(' ');
          }
          break;
        }
      }

      // Count tool calls
      const toolCallCounts: Record<string, number> = {};
      for (const msg of messages) {
        if (msg.contentBlocks && Array.isArray(msg.contentBlocks)) {
          for (const block of msg.contentBlocks) {
            if (block.type === 'tool_use') {
              const toolName = (block as any).name || 'unknown';
              toolCallCounts[toolName] = (toolCallCounts[toolName] || 0) + 1;
            }
          }
        }
      }

      // Build summary
      const lines: string[] = [
        `## Agent Summary: "${agent.name}"`,
        '',
        `- **Agent ID:** ${agentId}`,
        `- **Status:** ${agent.status}`,
        `- **Messages:** ${messages.length}`,
      ];

      if (agent.metadata?.taskNoteId) {
        lines.push(`- **Task Note:** ${agent.metadata.taskNoteId}`);
      }

      if (agent.createdAt) {
        lines.push(`- **Created:** ${new Date(agent.createdAt).toLocaleString()}`);
      }

      if (agent.updatedAt) {
        lines.push(`- **Last Updated:** ${new Date(agent.updatedAt).toLocaleString()}`);
      }

      // Tool call summary
      if (Object.keys(toolCallCounts).length > 0) {
        lines.push('');
        lines.push('### Tool Calls');
        for (const [toolName, count] of Object.entries(toolCallCounts)) {
          lines.push(`- ${toolName}: ${count} calls`);
        }
      }

      // Last response
      if (lastResponse) {
        lines.push('');
        lines.push('### Last Response');
        // Truncate if too long
        const truncatedResponse =
          lastResponse.length > 1000 ? lastResponse.substring(0, 1000) + '...' : lastResponse;
        lines.push(truncatedResponse);
      }

      lines.push('');
      lines.push(
        `_Use \`read_agent_conversation(agentId="${agentId}")\` to see the full conversation._`,
      );

      return this.success(lines.join('\n'), {
        agentId,
        agentName: agent.name,
        status: agent.status,
        messageCount: messages.length,
        toolCallCounts,
        taskNoteId: agent.metadata?.taskNoteId,
        hasLastResponse: !!lastResponse,
      });
    } catch (error) {
      logger.error('Error getting agent summary', error as Error);
      return this.error(`Failed to get agent summary: ${(error as Error).message}`);
    }
  }
}

// ============================================================================
// Report To Parent Tool
// ============================================================================

/**
 * Tool for sending a completion report to the parent agent.
 * Only available for delegated agents (those created by another agent).
 * The report is stored in agent metadata and included in the agent:idle event.
 */
export class ReportToParentTool extends BaseMCPTool {
  constructor(private workspaceId: string) {
    super(
      'report_to_parent',
      `Send a completion report to your parent agent.

This tool is for delegated agents to report their results back to the agent that created them.
The report will be prominently displayed to your parent agent when you finish responding.

Use this when:
- You've completed your assigned task and want to summarize the outcome
- You have important findings or results to communicate
- You encountered an issue that needs the parent's attention
- You want to provide status before going idle

The report should be concise but informative - typically 1-3 sentences summarizing:
- What you did
- What the outcome was
- Any important details or next steps

NOTE: This tool only works for delegated agents (agents created by another agent).
If you were created directly by a user, this tool will return an error.`,
      createInputSchema(
        {
          report: stringProperty(
            'The completion report to send to your parent agent. Should be concise but informative.',
          ),
        },
        ['report'],
      ),
    );
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const ctx = getRequiredContext(call);
      const { report } = call.arguments;

      if (!report || typeof report !== 'string' || report.trim().length === 0) {
        return this.error('Report cannot be empty. Please provide a meaningful completion report.');
      }

      logger.info('Setting completion report for parent agent', {
        agentId: ctx.agentId,
        reportLength: report.length,
      });

      // Load the agent from persistence to check if it's a delegated agent
      const { agentPersistence } = await import('../../../agent/main/agent-persistence');
      const { AgentId, WorkspaceId } = await import('$shared/types/branded-ids');

      const loadResult = await agentPersistence.loadAgent(
        AgentId(ctx.agentId),
        WorkspaceId(this.workspaceId),
      );

      if (!loadResult.success || !loadResult.data) {
        return this.error('Could not load agent data. Please try again.');
      }

      const agent = loadResult.data;

      // Check if this agent was created by another agent
      const parentAgentId = agent.metadata?.createdByAgentId as string | undefined;
      if (!parentAgentId) {
        return this.error(
          'This tool is only available for delegated agents (agents created by another agent). ' +
            'You appear to have been created directly by a user, not by another agent.',
        );
      }

      // Update the agent's metadata with the completion report
      const updatedAgent = {
        ...agent,
        metadata: {
          ...agent.metadata,
          completionReport: report.trim(),
          completionReportTimestamp: new Date().toISOString(),
        },
        updatedAt: new Date().toISOString(),
      };

      // Save the updated agent
      const saveResult = await agentPersistence.saveAgent(updatedAgent);
      if (!saveResult.success) {
        logger.error('Failed to save completion report', {
          agentId: ctx.agentId,
          error: saveResult.error,
        });
        return this.error('Failed to save completion report. Please try again.');
      }

      logger.info('Completion report saved successfully', {
        agentId: ctx.agentId,
        parentAgentId,
        reportLength: report.length,
      });

      return this.success(
        `Completion report saved. Your parent agent "${parentAgentId}" will see this report when you finish responding:\n\n"${report}"`,
        {
          parentAgentId,
          reportLength: report.length,
          savedAt: updatedAgent.metadata.completionReportTimestamp,
        },
      );
    } catch (error) {
      logger.error('Error setting completion report', error as Error);
      return this.error(`Failed to set completion report: ${(error as Error).message}`);
    }
  }
}

// ============================================================================
// Agent Info Type
// ============================================================================

/**
 * Agent info returned by tools
 */
export interface AgentInfo {
  id: string;
  name: string;
  status: string;
  messageCount?: number;
  taskNoteId?: string;
  createdAt?: string;
  lastActivity?: string;
}
