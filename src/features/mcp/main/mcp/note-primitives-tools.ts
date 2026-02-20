/**
 * MCP Tools for Note Primitives
 *
 * Provides tools for agents to create and manage note primitives
 * (reference blocks, CLI commands, agent actions, patches)
 */

import { BaseMCPTool, createInputSchema, stringProperty } from './tool';
import { Logger } from '../../../../shared/logger';
import { v4 as uuidv4 } from 'uuid';
import type {
  NotePrimitive,
  ReferencePrimitive,
  CliPrimitive,
  AgentActionPrimitive,
  PatchPrimitive,
  ReferenceTarget,
  ReferenceSnapshot,
} from '../../../../shared/types/notes-primitives';
import { ToolCall, ToolResult } from './protocol';

const logger = new Logger('NotePrimitivesTools');

/**
 * Tool to add a reference primitive to a note
 */
export class AddReferencePrimitiveTool extends BaseMCPTool {
  private workspaceManager: any;
  private workspaceId: string;

  constructor(workspaceManager: any, workspaceId: string) {
    super(
      'add_reference_primitive',
      'Add a code reference primitive to a note. This creates a link to specific code in the codebase.',
      createInputSchema(
        {
          noteId: stringProperty('The ID of the note to add the primitive to'),
          semanticId: stringProperty(
            'Semantic ID like "src/main.ts#symbol:MainClass.init" or "src/utils.ts#L10-20"',
          ),
          description: stringProperty('Human-readable description of what this references'),
          snapshot: stringProperty('Optional: Current code snapshot for offline viewing'),
        },
        ['noteId', 'semanticId', 'description'],
      ),
    );
    this.workspaceManager = workspaceManager;
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const { noteId, semanticId, description, snapshot } = call.arguments;

    try {
      // Get the current note content
      const note = await this.workspaceManager.getNote(this.workspaceId, noteId);
      if (!note) {
        return this.error(`Note ${noteId} not found`);
      }

      // Create the reference target
      const target: ReferenceTarget = {
        kind: semanticId.includes('#symbol:') ? 'symbol' : 'file_range',
        semanticId,
      };

      // Create the reference primitive
      const primitive: ReferencePrimitive = {
        id: uuidv4(),
        version: 1,
        type: 'reference',
        createdAt: new Date().toISOString(),
        createdBy: 'agent',
        target,
        description,
        snapshot: snapshot
          ? ({
            code: snapshot,
            filePath: semanticId.split('#')[0],
            language: 'typescript',
          } as ReferenceSnapshot)
          : undefined,
      };

      // Serialize to ws-block format
      const wsBlock = `\n\n\`\`\`ws-block:reference\n${JSON.stringify(primitive, null, 2)}\n\`\`\`\n`;

      // Append to note content
      const updatedContent = (note.content || '') + wsBlock;

      // Update the note
      await this.workspaceManager.updateNote(this.workspaceId, noteId, {
        content: updatedContent,
      });

      return this.success(
        JSON.stringify({
          primitiveId: primitive.id,
          noteId,
          message: `Added reference primitive to note ${noteId}`,
        }),
      );
    } catch (error) {
      logger.error('Failed to add reference primitive', error as Error);
      return this.error(`Failed to add reference primitive: ${error}`);
    }
  }
}

/**
 * Tool to add a CLI command primitive to a note
 */
export class AddCliPrimitiveTool extends BaseMCPTool {
  private workspaceManager: any;
  private workspaceId: string;

  constructor(workspaceManager: any, workspaceId: string) {
    super(
      'add_cli_primitive',
      'Add a CLI command primitive to a note. This creates an executable command block.',
      createInputSchema(
        {
          noteId: stringProperty('The ID of the note to add the primitive to'),
          command: stringProperty('The command to execute'),
          workingDirectory: stringProperty(
            'Working directory for the command (optional, defaults to workspace root)',
          ),
          description: stringProperty('Description of what this command does'),
        },
        ['noteId', 'command', 'description'],
      ),
    );
    this.workspaceManager = workspaceManager;
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const { noteId, command, workingDirectory, description } = call.arguments;

    try {
      // Get the current note content
      const note = await this.workspaceManager.getNote(this.workspaceId, noteId);
      if (!note) {
        return this.error(`Note ${noteId} not found`);
      }

      // Create the CLI primitive
      const primitive: CliPrimitive = {
        id: uuidv4(),
        version: 1,
        type: 'cli',
        createdAt: new Date().toISOString(),
        createdBy: 'agent',
        command,
        description,
        cwd: workingDirectory || './',
        display: {
          showCommandPrefix: '$',
        },
      };

      // Serialize to ws-block format
      const wsBlock = `\n\n\`\`\`ws-block:cli\n${JSON.stringify(primitive, null, 2)}\n\`\`\`\n`;

      // Append to note content
      const updatedContent = (note.content || '') + wsBlock;

      // Update the note
      await this.workspaceManager.updateNote(this.workspaceId, noteId, {
        content: updatedContent,
      });

      return this.success(
        JSON.stringify({
          primitiveId: primitive.id,
          noteId,
          message: `Added CLI primitive to note ${noteId}`,
        }),
      );
    } catch (error) {
      logger.error('Failed to add CLI primitive', error as Error);
      return this.error(`Failed to add CLI primitive: ${error}`);
    }
  }
}

/**
 * Tool to add a patch primitive to a note
 */
export class AddPatchPrimitiveTool extends BaseMCPTool {
  private workspaceManager: any;
  private workspaceId: string;

  constructor(workspaceManager: any, workspaceId: string) {
    super(
      'add_patch_primitive',
      'Add a patch primitive to a note. This creates an applyable code diff block.',
      createInputSchema(
        {
          noteId: stringProperty('The ID of the note to add the primitive to'),
          filePath: stringProperty('Path to the file this patch applies to'),
          diff: stringProperty('The unified diff content'),
          description: stringProperty('Description of what this patch does'),
        },
        ['noteId', 'filePath', 'diff', 'description'],
      ),
    );
    this.workspaceManager = workspaceManager;
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const { noteId, filePath, diff, description } = call.arguments;

    try {
      // Get the current note content
      const note = await this.workspaceManager.getNote(this.workspaceId, noteId);
      if (!note) {
        return this.error(`Note ${noteId} not found`);
      }

      // Create the patch primitive
      const primitive: PatchPrimitive = {
        id: uuidv4(),
        version: 1,
        type: 'patch',
        createdAt: new Date().toISOString(),
        createdBy: 'agent',
        description,
        patches: [
          {
            filePath,
            diff,
          },
        ],
      };

      // Serialize to ws-block format
      const wsBlock = `\n\n\`\`\`ws-block:patch\n${JSON.stringify(primitive, null, 2)}\n\`\`\`\n`;

      // Append to note content
      const updatedContent = (note.content || '') + wsBlock;

      // Update the note
      await this.workspaceManager.updateNote(this.workspaceId, noteId, {
        content: updatedContent,
      });

      return this.success(
        JSON.stringify({
          primitiveId: primitive.id,
          noteId,
          message: `Added patch primitive to note ${noteId}`,
        }),
      );
    } catch (error) {
      logger.error('Failed to add patch primitive', error as Error);
      return this.error(`Failed to add patch primitive: ${error}`);
    }
  }
}

/**
 * Tool to add an agent action primitive to a note
 */
export class AddAgentActionPrimitiveTool extends BaseMCPTool {
  private workspaceManager: any;
  private workspaceId: string;

  constructor(workspaceManager: any, workspaceId: string) {
    super(
      'add_agent_action_primitive',
      'Add an agent action primitive to a note. This creates a triggerable agent task block.',
      createInputSchema(
        {
          noteId: stringProperty('The ID of the note to add the primitive to'),
          agentId: stringProperty('Agent identifier (e.g., "refactor", "explainer", "planner")'),
          goal: stringProperty('The goal/instruction for the agent'),
          description: stringProperty('Description of what this agent action does'),
        },
        ['noteId', 'agentId', 'goal', 'description'],
      ),
    );
    this.workspaceManager = workspaceManager;
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const { noteId, agentId, goal, description } = call.arguments;

    try {
      // Get the current note content
      const note = await this.workspaceManager.getNote(this.workspaceId, noteId);
      if (!note) {
        return this.error(`Note ${noteId} not found`);
      }

      // Create the agent action primitive
      const primitive: AgentActionPrimitive = {
        id: uuidv4(),
        version: 1,
        type: 'agent_action',
        createdAt: new Date().toISOString(),
        createdBy: 'agent',
        agentId,
        goal,
        description,
        inputs: [],
      };

      // Serialize to ws-block format
      const wsBlock = `\n\n\`\`\`ws-block:agent_action\n${JSON.stringify(primitive, null, 2)}\n\`\`\`\n`;

      // Append to note content
      const updatedContent = (note.content || '') + wsBlock;

      // Update the note
      await this.workspaceManager.updateNote(this.workspaceId, noteId, {
        content: updatedContent,
      });

      return this.success(
        JSON.stringify({
          primitiveId: primitive.id,
          noteId,
          message: `Added agent action primitive to note ${noteId}`,
        }),
      );
    } catch (error) {
      logger.error('Failed to add agent action primitive', error as Error);
      return this.error(`Failed to add agent action primitive: ${error}`);
    }
  }
}
