/**
 * MCP Tools for Task Management
 * Phase 1C - Task management tools for agents
 */

import { BaseMCPTool, createInputSchema, stringProperty } from './tool';
import type { ToolCall, ToolResult } from './protocol';
import type { ProtocolAdapter } from '$features/protocol/main/protocol-adapter';
import { Logger } from '$shared/logger';

const logger = new Logger('TaskTools');

/**
 * Tool to get the current agent's task
 */
export class GetMyTaskTool extends BaseMCPTool {
  private protocolAdapter: ProtocolAdapter;
  private workspaceId: string;

  constructor(protocolAdapter: ProtocolAdapter, workspaceId: string) {
    super(
      'get_my_task',
      'Get the task note assigned to the current agent. Returns the full note with task metadata including status, acceptance criteria, dependencies, and assigned agents.',
      createInputSchema(
        {
          taskNoteId: stringProperty('The ID of the task note to retrieve'),
        },
        ['taskNoteId'],
      ),
    );
    this.protocolAdapter = protocolAdapter;
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { taskNoteId } = call.arguments;

      const result = await this.protocolAdapter.getNote({
        noteId: taskNoteId,
        workspaceId: this.workspaceId,
      });

      if (!result || !result.ok) {
        return this.error(result?.error || 'Task note not found');
      }

      // Verify it's a task
      if (!result.data.metadata?.task) {
        return this.error('Note is not a task');
      }

      const note = result.data;
      const task = note.metadata.task;

      // Build response text
      let responseText = `Task: ${note.title}\n\nStatus: ${task.status}\n\nContent:\n${note.content || '(no content)'}`;

      // Get child tasks (subtasks) by filtering notes with parentId === this note's id
      const allNotes = await this.protocolAdapter.listNotes(this.workspaceId);
      const childTasks = allNotes.filter(
        (n: { parentId?: string; metadata?: { task?: unknown } }) =>
          n.parentId === note.id && n.metadata?.task,
      );

      if (childTasks.length > 0) {
        responseText += `\n\nSubtasks (${childTasks.length}):\n`;
        childTasks.forEach(
          (child: { id: string; title: string; metadata?: { task?: { status?: string } } }) => {
            const status = child.metadata?.task?.status || 'unknown';
            responseText += `  - [${status}] ${child.title} (${child.id})\n`;
          },
        );
      }

      // Add task metadata
      responseText += `\n\nTask Metadata:\n${JSON.stringify(task, null, 2)}`;

      return this.success(responseText, {
        noteId: note.id,
        title: note.title,
        status: task.status,
        parentId: note.parentId || null,
        subtaskIds: childTasks.map((c: { id: string }) => c.id),
        assignedAgents: task.assignedAgentIds || [],
      });
    } catch (error) {
      logger.error('Error getting task', error as Error);
      return this.error(`Failed to get task: ${(error as Error).message}`);
    }
  }
}

/**
 * Tool to mark a note as a task
 */
export class MarkAsTaskTool extends BaseMCPTool {
  private protocolAdapter: ProtocolAdapter;
  private workspaceId: string;

  constructor(protocolAdapter: ProtocolAdapter, workspaceId: string) {
    super(
      'mark_as_task',
      'Convert a note into a task by adding task metadata (status, acceptance criteria, etc.)',
      createInputSchema(
        {
          noteId: stringProperty('The ID of the note to mark as a task'),
          status: stringProperty('Task status', {
            enum: [
              'not_started',
              'waiting',
              'discussion_needed',
              'in_progress',
              'review_required',
              'complete',
              'cancelled',
            ],
          }),
          acceptanceCriteria: stringProperty(
            'JSON array of acceptance criteria strings (optional)',
          ),
          estimatedEffort: stringProperty('Estimated effort (optional)'),
          blockedReason: stringProperty(
            'Reason for being waiting (optional, only if status is waiting)',
          ),
        },
        ['noteId', 'status'],
      ),
    );
    this.protocolAdapter = protocolAdapter;
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { noteId, status, acceptanceCriteria, estimatedEffort, blockedReason } = call.arguments;

      const taskMetadata: any = { status };
      if (acceptanceCriteria) {
        try {
          taskMetadata.acceptanceCriteria = JSON.parse(acceptanceCriteria);
        } catch {
          taskMetadata.acceptanceCriteria = [acceptanceCriteria];
        }
      }
      if (estimatedEffort) taskMetadata.estimatedEffort = estimatedEffort;
      if (blockedReason) taskMetadata.blockedReason = blockedReason;

      const result = await this.protocolAdapter.markAsTask({
        workspaceId: this.workspaceId,
        noteId,
        taskMetadata,
      });

      if (!result || !result.ok) {
        return this.error(result?.error || 'Failed to mark as task');
      }

      return this.success(`Note marked as task with status: ${status}`, {
        noteId,
        status,
      });
    } catch (error) {
      return this.error(`Failed to mark as task: ${(error as Error).message}`);
    }
  }
}

/**
 * Tool to convert all ```task``` blocks in a note into real Task Notes.
 *
 * Note: Task blocks are now auto-converted when notes are updated via agent tools,
 * including the spec. This tool can still be used for manual conversion or re-conversion.
 */
export class ConvertTaskBlocksTool extends BaseMCPTool {
  private protocolAdapter: ProtocolAdapter;
  private workspaceId: string;

  constructor(protocolAdapter: ProtocolAdapter, workspaceId: string) {
    super(
      'convert_task_blocks',
      'Convert all ```task``` blocks in a note into linked Task Notes. Task blocks are auto-converted on note updates, but this tool can be used for manual re-conversion.',
      createInputSchema(
        {
          noteId: stringProperty(
            'The ID of the note to convert (use "spec" for the workspace specification)',
          ),
        },
        ['noteId'],
      ),
    );
    this.protocolAdapter = protocolAdapter;
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { noteId } = call.arguments;

      const result = await this.protocolAdapter.convertTaskBlocks({
        workspaceId: this.workspaceId,
        noteId,
      });

      if (!result || !result.ok) {
        return this.error(result?.error || 'Failed to convert task blocks');
      }

      return this.success(
        `Converted ${result.data.convertedCount} task block(s) into Task Notes. Created: ${result.data.createdNoteIds.join(', ')}`,
        {
          noteId,
          convertedCount: result.data.convertedCount,
          createdNoteIds: result.data.createdNoteIds,
        },
      );
    } catch (error) {
      return this.error(`Failed to convert task blocks: ${(error as Error).message}`);
    }
  }
}

/**
 * Tool to create a prerequisite task
 * Phase 1C: Enhanced with optional agent creation
 */
export class CreatePrerequisiteTool extends BaseMCPTool {
  private protocolAdapter: ProtocolAdapter;
  private workspaceId: string;

  constructor(protocolAdapter: ProtocolAdapter, workspaceId: string) {
    super(
      'create_prerequisite',
      'Create a new prerequisite task note and link it as a dependency to an existing task. The dependent task will be blocked until the prerequisite is completed. Optionally, create and assign an agent to work on the prerequisite.',
      createInputSchema(
        {
          dependentNoteId: stringProperty('The ID of the task that depends on this prerequisite'),
          title: stringProperty('Title for the new prerequisite task'),
          content: stringProperty('Content/description for the prerequisite task (optional)'),
          status: stringProperty('Initial status for the prerequisite', {
            enum: [
              'not_started',
              'waiting',
              'discussion_needed',
              'in_progress',
              'review_required',
              'complete',
              'cancelled',
            ],
            default: 'not_started',
          }),
          launchAgent: {
            type: 'boolean',
            description:
              'Whether to create and assign an agent to work on this prerequisite (default: false)',
          },
          agentInstruction: stringProperty(
            'Additional instruction for the agent (optional, only used if launchAgent is true)',
          ),
          agentModel: stringProperty(
            'Model to use for the agent (optional, only used if launchAgent is true)',
          ),
        },
        ['dependentNoteId', 'title'],
      ),
    );
    this.protocolAdapter = protocolAdapter;
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { dependentNoteId, title, content, status, launchAgent, agentInstruction, agentModel } =
        call.arguments;

      const prerequisite: any = {
        title,
        content: content || '',
        taskMetadata: {
          status: status || 'not_started',
        },
      };

      // Add agent config if requested
      if (launchAgent) {
        prerequisite.agentConfig = {
          instruction: agentInstruction,
          model: agentModel,
          autoStart: false, // Don't auto-start agents created via MCP
        };
      }

      const result = await this.protocolAdapter.createPrerequisiteNote({
        workspaceId: this.workspaceId,
        dependentNoteId,
        prerequisite,
      });

      if (!result || !result.ok) {
        return this.error(result?.error || 'Failed to create prerequisite');
      }

      const prereqNote = result.data.prerequisiteNote;
      const agent = result.data.agent;

      let message = `Created prerequisite task: ${prereqNote.title}\nPrerequisite ID: ${prereqNote.id}\nThe dependent task is now blocked until this prerequisite is completed.`;

      if (agent) {
        message += `\n\nAgent created and assigned:\n- Agent ID: ${agent.id}\n- Agent Name: ${agent.name}\n- Status: ${agent.status}`;
      }

      return this.success(message, {
        prerequisiteNoteId: prereqNote.id,
        dependentNoteId,
        title: prereqNote.title,
        agentId: agent?.id,
        agentName: agent?.name,
      });
    } catch (error) {
      logger.error('Error creating prerequisite', error as Error);
      return this.error(`Failed to create prerequisite: ${(error as Error).message}`);
    }
  }
}

/**
 * Tool to assign an agent to a task
 */
export class AssignAgentTool extends BaseMCPTool {
  private protocolAdapter: ProtocolAdapter;
  private workspaceId: string;

  constructor(protocolAdapter: ProtocolAdapter, workspaceId: string) {
    super(
      'assign_agent',
      `Assign an existing agent to a task note. Multiple agents can be assigned to the same task.

IMPORTANT: The agentId must be a valid agent ID (format: "agent-{uuid}").
To create a new agent AND assign it to a task in one step, use create_agent with the taskNoteId parameter instead.`,
      createInputSchema(
        {
          noteId: stringProperty('The ID of the task note'),
          agentId: stringProperty(
            'The ID of an existing agent to assign (format: "agent-{uuid}"). Use create_agent with taskNoteId to create and assign in one step.',
          ),
        },
        ['noteId', 'agentId'],
      ),
    );
    this.protocolAdapter = protocolAdapter;
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { noteId, agentId } = call.arguments;

      // Validate agentId format - must be "agent-{uuid}"
      // This catches placeholder names like "theme-toggle-agent" that aren't real agent IDs
      const agentIdPattern =
        /^agent-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!agentIdPattern.test(agentId)) {
        logger.warn('Invalid agentId format', { agentId, noteId });
        return this.error(
          `Invalid agentId format: "${agentId}". Agent IDs must be in format "agent-{uuid}" (e.g., "agent-b0a8044a-5eac-4b52-8456-15d3b784decb"). ` +
            `To create a new agent and assign it to this task, use create_agent with taskNoteId="${noteId}" instead.`,
        );
      }

      const result = await this.protocolAdapter.assignAgentToTask({
        workspaceId: this.workspaceId,
        noteId,
        agentId,
      });

      if (!result || !result.ok) {
        return this.error(result?.error || 'Failed to assign agent');
      }

      return this.success(`Agent ${agentId} assigned to task`, {
        noteId,
        agentId,
      });
    } catch (error) {
      logger.error('Error assigning agent', error as Error);
      return this.error(`Failed to assign agent: ${(error as Error).message}`);
    }
  }
}

// Note: The ```task block syntax is the supported way to propose tasks.
// Task blocks are auto-converted to Task Notes when notes are updated via agent tools.
