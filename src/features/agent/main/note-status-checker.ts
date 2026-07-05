/**
 * Note Status Checker
 *
 * Automatically checks if an agent's linked task note should be marked as complete
 * after the agent finishes responding. Uses a cheap LLM model for classification,
 * with rich context (finishReason, note content, recent messages) for accuracy.
 *
 * This runs in the background and doesn't affect the UI.
 */

import { Logger } from '$shared/logger';
import { makeBackgroundRequest } from './background-request.service';
import { getBackendClient } from '../../backend/main/backend.ipc';
import type { WorkspaceId, NoteId } from '$shared/types/branded-ids';
import type { TaskStatus } from '$shared/types';

const logger = new Logger('NoteStatusChecker');

// Track recently checked agents to avoid duplicate checks
const recentlyChecked = new Map<string, number>();
const CHECK_COOLDOWN_MS = 30_000; // Don't re-check same agent within 30 seconds

export interface NoteStatusCheckContext {
  /** The LLM finish reason (e.g. 'end_turn', 'cancelled', 'error', 'max_tokens') */
  finishReason?: string;
  /** Pre-extracted text from the final assistant message, avoids re-loading from persistence */
  lastMessageText?: string;
  /** Whether the agent has more queued messages to process */
  hasQueuedMessages?: boolean;
}

/**
 * Check if an agent's task note should be marked as complete.
 * This is called after an agent finishes streaming a response.
 *
 * Fire-and-forget - errors are logged but don't propagate.
 */
export async function checkAndUpdateNoteStatus(
  agentId: string,
  workspaceId: string,
  workspacePath?: string,
  context?: NoteStatusCheckContext,
): Promise<void> {
  void workspacePath;
  try {
    const finishReason = context?.finishReason;
    logger.info('Starting note status check', { agentId, workspaceId, finishReason });

    // Don't check if the agent has more messages queued — it's not done yet
    if (context?.hasQueuedMessages) {
      logger.info('Agent has queued messages, skipping status check', { agentId });
      return;
    }

    // Check cooldown to avoid redundant checks
    const key = `${workspaceId}:${agentId}`;
    const lastChecked = recentlyChecked.get(key);
    if (lastChecked && Date.now() - lastChecked < CHECK_COOLDOWN_MS) {
      logger.info('Skipping note status check (cooldown)', { agentId });
      return;
    }
    recentlyChecked.set(key, Date.now());

    // Load the AgentLite projection from the daemon (PROTOCOL.md §5.5 agent.get).
    // AgentLite strips `messages`, so we lazily fetch the transcript via
    // `agent.getConversation` below only if the caller did not supply
    // `context.lastMessageText`.
    let agent: {
      name?: string;
      metadata?: { taskNoteId?: string } & Record<string, unknown>;
    };
    try {
      const getResult = (await getBackendClient().request('agent.get', {
        agentId,
        workspaceId,
      })) as { agent: typeof agent };
      agent = getResult.agent;
    } catch (error) {
      logger.info('Could not load agent for status check', {
        agentId,
        error: (error as Error).message,
      });
      return;
    }
    const taskNoteId = agent.metadata?.taskNoteId;

    logger.info('Agent metadata check', {
      agentId,
      hasMetadata: !!agent.metadata,
      taskNoteId: taskNoteId || 'none',
      metadataKeys: agent.metadata ? Object.keys(agent.metadata) : [],
    });

    if (!taskNoteId) {
      logger.info('Agent has no linked task note - skipping', { agentId });
      return;
    }

    // Get the note to check current status and content
    const { notesService } = await import('../../notes/main/notes.service');
    const noteResult = await notesService.getNote(workspaceId as WorkspaceId, taskNoteId as NoteId);

    if (!noteResult.ok) {
      logger.debug('Could not load task note', { agentId, taskNoteId, error: noteResult.error });
      return;
    }

    if (!noteResult.data) {
      logger.debug('Task note not found', { agentId, taskNoteId });
      return;
    }

    const note = noteResult.data;
    const currentStatus = note.metadata?.task?.status;

    // Skip if already complete or cancelled
    if (currentStatus === 'complete' || currentStatus === 'cancelled') {
      logger.debug('Task note already in terminal status', { agentId, taskNoteId, currentStatus });
      return;
    }

    // Use pre-extracted message text from context, or fall back to loading from
    // persistence via `agent.getConversation` (PROTOCOL.md §5.5).
    let messageText = context?.lastMessageText;
    let recentAssistantMessages: any[] | undefined;
    if (!messageText) {
      try {
        const convo = (await getBackendClient().request('agent.getConversation', {
          agentId,
          workspaceId,
        })) as { messages?: any[] };
        recentAssistantMessages = convo.messages;
      } catch (error) {
        logger.debug('Could not load conversation for status check', {
          agentId,
          error: (error as Error).message,
        });
        return;
      }
      const lastMessage = recentAssistantMessages
        ?.filter((m) => m.role === 'assistant')
        ?.pop();
      if (!lastMessage) {
        logger.debug('No assistant messages to analyze', { agentId });
        return;
      }
      messageText = extractMessageText(lastMessage);
    }

    if (!messageText || messageText.length < 20) {
      logger.debug('Message too short to analyze', { agentId, length: messageText?.length });
      return;
    }

    // Gather recent message context (last few assistant messages for better
    // classification). If we already fetched the conversation for the fallback
    // above, reuse it; otherwise fetch it now (best-effort).
    if (!recentAssistantMessages) {
      try {
        const convo = (await getBackendClient().request('agent.getConversation', {
          agentId,
          workspaceId,
        })) as { messages?: any[] };
        recentAssistantMessages = convo.messages;
      } catch {
        recentAssistantMessages = undefined;
      }
    }
    const recentMessages = gatherRecentMessages(recentAssistantMessages, 3);

    // Extract the note body for task context
    const noteContent = note.content || '';

    // Make background request to check if task is complete
    // Pass agentName for provenance context so auto-commit can work
    const agentName = agent.name || 'Agent';
    await checkTaskCompletion({
      agentId,
      agentName,
      workspaceId,
      taskNoteId,
      taskTitle: note.title,
      lastResponse: messageText,
      finishReason,
      noteContent,
      recentMessages,
    });
  } catch (error) {
    logger.warn('Error in note status check', { agentId, error: (error as Error).message });
  }
}

/**
 * Extract text content from an agent message
 */
function extractMessageText(message: any): string {
  if (!message) return '';

  // Handle contentBlocks format
  if (message.contentBlocks && Array.isArray(message.contentBlocks)) {
    return message.contentBlocks
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text || '')
      .join('\n');
  }

  // Handle simple content string
  if (typeof message.content === 'string') {
    return message.content;
  }

  return '';
}

/**
 * Gather text from the last N assistant messages for richer classification context.
 */
function gatherRecentMessages(messages: any[] | undefined, count: number): string {
  if (!messages || messages.length === 0) return '';

  const assistantMessages = messages.filter((m) => m.role === 'assistant');
  const recent = assistantMessages.slice(-count);
  return recent.map((m) => extractMessageText(m)).filter(Boolean).join('\n---\n');
}

// All valid TaskStatus values
const ALL_STATUSES: TaskStatus[] = [
  'not_started',
  'waiting',
  'discussion_needed',
  'in_progress',
  'review_required',
  'complete',
  'cancelled',
];

interface CheckTaskCompletionArgs {
  agentId: string;
  agentName: string;
  workspaceId: string;
  taskNoteId: string;
  taskTitle: string;
  lastResponse: string;
  finishReason?: string;
  noteContent?: string;
  recentMessages?: string;
}

/**
 * Check task completion using LLM classification with rich context.
 */
async function checkTaskCompletion(args: CheckTaskCompletionArgs): Promise<void> {
  const {
    agentId, agentName, workspaceId, taskNoteId, taskTitle,
    lastResponse, finishReason, noteContent, recentMessages,
  } = args;

  logger.info('Checking task completion', {
    agentId,
    taskNoteId,
    taskTitle,
    finishReason,
  });

  // LLM classification with rich context
  // Truncate the response to avoid huge prompts
  const truncatedResponse =
    lastResponse.length > 2000 ? `${lastResponse.substring(0, 2000)}...[truncated]` : lastResponse;

  // Include note content (task description) for better classification
  const truncatedNoteContent = noteContent
    ? noteContent.length > 1000
      ? `${noteContent.substring(0, 1000)}...[truncated]`
      : noteContent
    : '';

  // Include recent message context (before the final one) for multi-turn awareness
  const truncatedRecentContext = recentMessages
    ? recentMessages.length > 1000
      ? `...${recentMessages.substring(recentMessages.length - 1000)}`
      : recentMessages
    : '';

  // Build a richer prompt with all available signals
  let prompt = `TASK TITLE: ${taskTitle}\n`;

  if (truncatedNoteContent) {
    prompt += `\nTASK DESCRIPTION/CONTENT:\n${truncatedNoteContent}\n`;
  }

  if (finishReason) {
    prompt += `\nAGENT FINISH REASON: ${finishReason}`;
    if (finishReason === 'end_turn') {
      prompt += ` (agent chose to stop on its own)`;
    } else if (finishReason === 'max_tokens') {
      prompt += ` (agent hit token limit, likely not finished)`;
    }
    prompt += '\n';
  }

  if (truncatedRecentContext && truncatedRecentContext !== truncatedResponse) {
    prompt += `\nRECENT AGENT MESSAGES (for context):\n${truncatedRecentContext}\n`;
  }

  prompt += `\nAGENT'S FINAL MESSAGE:\n${truncatedResponse}\n`;
  prompt += `\nWhat is the task status? Reply with ONE word only.`;

  // System prompt with guidance on how to interpret signals
  const systemPrompt = `You are a task status classifier. Output ONLY one of these exact words, nothing else:
- complete (task is done, agent finished the work)
- in_progress (still actively working, not finished)
- waiting (blocked/waiting for external input)
- discussion_needed (stuck, needs human help)
- review_required (work done but explicitly needs review)

IMPORTANT GUIDELINES:
- If the finish reason is "end_turn" and the agent's message summarizes completed work or wraps up, the task is almost certainly COMPLETE.
- If the finish reason is "end_turn" and the message describes what was done without asking for further input, it is COMPLETE.
- If the finish reason is "max_tokens", the agent was cut off and is likely still IN_PROGRESS.
- If the agent says it needs input, approval, or is waiting, use WAITING or DISCUSSION_NEEDED.
- When in doubt and finish reason is "end_turn", lean toward COMPLETE — agents that finish naturally are usually done.

DO NOT explain. DO NOT add punctuation. Just output the single status word.`;

  const result = await makeBackgroundRequest({
    prompt,
    systemPrompt,
  });

  if (!result.success || !result.content) {
    logger.info('Background request failed', { agentId, error: result.error });

    // Fallback: if the LLM call fails but finishReason is end_turn,
    // still lean toward complete since the agent chose to stop
    if (finishReason === 'end_turn') {
      logger.info('LLM classification failed but finishReason=end_turn, marking complete as fallback', {
        agentId, taskNoteId,
      });
      await updateTaskStatus(workspaceId, taskNoteId, 'complete', agentId, agentName);
    }
    return;
  }

  const response = result.content.trim().toLowerCase();
  logger.info('Task status check result', {
    agentId,
    taskNoteId,
    response,
    rawContent: result.content,
    finishReason,
  });

  // Extract the status from the response
  const status = parseStatus(response);
  if (status) {
    await updateTaskStatus(workspaceId, taskNoteId, status, agentId, agentName);
  } else {
    // If we can't parse a status and the agent finished naturally, default to complete
    if (finishReason === 'end_turn') {
      logger.info('Could not parse status but finishReason=end_turn, defaulting to complete', {
        agentId, taskNoteId, response,
      });
      await updateTaskStatus(workspaceId, taskNoteId, 'complete', agentId, agentName);
    } else {
      logger.info('Could not parse valid status from response - skipping update', {
        agentId,
        taskNoteId,
        response,
      });
    }
  }
}

/**
 * Parse the model's response into a valid status.
 * Only returns a status if we're confident about the response.
 * Returns null for garbage/unclear responses to avoid incorrect updates.
 */
function parseStatus(response: string): TaskStatus | null {
  const normalized = response.toLowerCase().trim();

  // Check for exact matches first (most reliable)
  if (ALL_STATUSES.includes(normalized as TaskStatus)) {
    return normalized as TaskStatus;
  }

  // Handle underscore vs space variations
  const withUnderscores = normalized.replace(/ /g, '_');
  if (ALL_STATUSES.includes(withUnderscores as TaskStatus)) {
    return withUnderscores as TaskStatus;
  }

  // Only parse if the response is short (a few words max)
  // Long responses like "I'm ready to help!" are garbage and should be ignored
  if (normalized.length > 30) {
    return null;
  }

  // Check for status words in short responses
  if (
    normalized.includes('complete') &&
    !normalized.includes('not complete') &&
    !normalized.includes('incomplete')
  ) {
    return 'complete';
  }
  if (normalized.includes('waiting') || normalized.includes('wait')) {
    return 'waiting';
  }
  if (normalized.includes('review')) {
    return 'review_required';
  }
  if (
    normalized.includes('discussion') ||
    normalized.includes('stuck') ||
    normalized.includes('blocked')
  ) {
    return 'discussion_needed';
  }
  if (
    normalized.includes('in_progress') ||
    normalized.includes('in progress') ||
    normalized.includes('progress')
  ) {
    return 'in_progress';
  }

  return null;
}

/**
 * Update the task note status
 *
 * IMPORTANT: Sets up provenance context with agent info so that the
 * task:status-changed event includes agentId, which is required for auto-commit.
 */
async function updateTaskStatus(
  workspaceId: string,
  taskNoteId: string,
  status: TaskStatus,
  agentId: string,
  agentName: string,
): Promise<void> {
  try {
    const { notesService } = await import('../../notes/main/notes.service');
    const { NoteId, WorkspaceId } = await import('$shared/types/branded-ids');
    const { getProvenanceContextManager } = await import(
      '../../workspace/main/provenance/provenance-context-manager'
    );

    logger.info('Background check: updating task status', {
      workspaceId,
      taskNoteId,
      status,
      agentId,
    });

    // Set up provenance context so that the task:status-changed event
    // includes the agentId, which is required for auto-commit to trigger
    const provenanceManager = getProvenanceContextManager();
    provenanceManager.createAgentContext({
      agentId,
      agentName,
      messageId: `note-status-check-${Date.now()}`,
    });

    try {
      const result = await notesService.updateTaskStatus(
        WorkspaceId(workspaceId),
        NoteId(taskNoteId),
        status,
      );

      if (result.ok) {
        logger.info('Background check: task status updated', {
          workspaceId,
          taskNoteId,
          status,
          agentId,
        });
      } else {
        logger.warn('Background check: failed to update task status', {
          workspaceId,
          taskNoteId,
          status,
          error: result.error,
        });
      }
    } finally {
      // Always clean up the provenance context
      provenanceManager.popContext();
    }
  } catch (error) {
    logger.warn('Background check: error updating task status', {
      workspaceId,
      taskNoteId,
      status,
      error: (error as Error).message,
    });
  }
}
