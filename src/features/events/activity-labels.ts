/**
 * Activity Label Utilities
 *
 * Provides natural language labels for workspace activity events.
 * Each event type has a getLabel function that generates a human-readable description.
 * Supports structured labels with styling for rich text rendering.
 */

import {
  cleanToolName,
  isDeferredToolLoad,
  isRawMcpName,
} from '$lib/components/chat/tool-classifier';
import { m } from '$shared/paraglide/messages.js';

import type { WorkspaceEvent } from './types';

/**
 * A part of a label that can be styled differently
 */
export interface LabelPart {
  text: string;
  /** If true, render with semibold weight and foreground color */
  emphasis?: boolean;
}

/**
 * Structured label with styled parts for rich text rendering
 */
export type StructuredLabel = LabelPart[];

/**
 * Truncate a string to a maximum length, adding ellipsis if needed
 */
function truncate(str: string, maxLength: number = 40): string {
  if (!str) return str;
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + '…';
}

/**
 * Get the actor name from an event, with truncation.
 * The daemon attributes its own bookkeeping (task status recomputes, note
 * rewrites, …) to a "System" actor — that's not a person, so skip it and let
 * the label fall back to an actor-less phrasing.
 */
function getActorName(event: WorkspaceEvent, fallback?: string): string {
  const name = event.actor?.name;
  if (name && name !== 'System') return truncate(name, 30);
  return fallback ?? m.events_activity_agent_fallback();
}

/**
 * Lowercase the first character (for splicing a title mid-sentence)
 */
function lowercaseFirst(str: string): string {
  if (!str) return str;
  return str.charAt(0).toLowerCase() + str.slice(1);
}

/**
 * Parse a file path to extract filename and directory
 */
function parseFilePath(path: string): { filename: string; directory: string } {
  const parts = path.split('/');
  const filename = parts.pop() || path;
  const directory = parts.join('/');
  return { filename, directory };
}

/**
 * Label generator for a specific event type
 */
type LabelGenerator = (event: WorkspaceEvent) => string;

/**
 * Structured label generator for a specific event type
 */
type StructuredLabelGenerator = (event: WorkspaceEvent) => StructuredLabel;

/**
 * Map of event types to their label generators
 */
const labelGenerators: Record<string, LabelGenerator> = {
  // File events - include actor name when available
  'file:changed': (event) => {
    const data = event.data as any;
    const filename = data?.path
      ? truncate(parseFilePath(data.path).filename, 35)
      : m.events_activity_file_fallback();
    const actor = getActorName(event, '');
    const action = data?.action;

    const verb =
      action === 'create'
        ? m.events_activity_verbCreated_label()
        : action === 'delete'
          ? m.events_activity_verbDeleted_label()
          : action === 'rename'
            ? m.events_activity_verbRenamed_label()
            : m.events_activity_verbUpdated_label();

    if (actor) {
      return m.events_activity_actorVerbFile_label({ actor, verb, filename });
    }
    return m.events_activity_verbFile_label({
      verb: verb.charAt(0).toUpperCase() + verb.slice(1),
      filename,
    });
  },

  'file:created': (event) => {
    const data = event.data as any;
    const filename = data?.path
      ? truncate(parseFilePath(data.path).filename, 35)
      : m.events_activity_file_fallback();
    const actor = getActorName(event, '');
    if (actor) {
      return m.events_activity_actorCreatedFile_label({ actor, filename });
    }
    return m.events_activity_createdFile_label({ filename });
  },

  'file:deleted': (event) => {
    const data = event.data as any;
    const filename = data?.path
      ? truncate(parseFilePath(data.path).filename, 35)
      : m.events_activity_file_fallback();
    const actor = getActorName(event, '');
    if (actor) {
      return m.events_activity_actorDeletedFile_label({ actor, filename });
    }
    return m.events_activity_deletedFile_label({ filename });
  },

  'file:renamed': (event) => {
    const data = event.data as any;
    const filename = data?.path
      ? truncate(parseFilePath(data.path).filename, 30)
      : m.events_activity_file_fallback();
    const oldFilename = data?.oldPath ? truncate(parseFilePath(data.oldPath).filename, 20) : null;
    const actor = getActorName(event, '');
    if (oldFilename) {
      if (actor) {
        return m.events_activity_actorRenamedFileArrow_label({ actor, oldFilename, filename });
      }
      return m.events_activity_renamedFileArrow_label({ oldFilename, filename });
    }
    if (actor) {
      return m.events_activity_actorRenamedFile_label({ actor, filename });
    }
    return m.events_activity_renamedFile_label({ filename });
  },

  // Note events - include note title with truncation
  'note:created': (event) => {
    const data = event.data as any;
    const title = truncate(data?.title || data?.name || m.events_activity_note_fallback(), 35);
    const actor = getActorName(event, '');
    if (actor) {
      return m.events_activity_actorCreatedNote_label({ actor, title });
    }
    return m.events_activity_createdNote_label({ title });
  },

  'note:updated': (event) => {
    const data = event.data as any;
    const title = truncate(data?.title || data?.name || m.events_activity_note_fallback(), 35);
    const actor = getActorName(event, '');
    if (actor) {
      return m.events_activity_actorUpdatedNote_label({ actor, title });
    }
    return m.events_activity_updatedNote_label({ title });
  },

  'note:deleted': (event) => {
    const data = event.data as any;
    const title = truncate(data?.title || data?.name || m.events_activity_note_fallback(), 35);
    const actor = getActorName(event, '');
    if (actor) {
      return m.events_activity_actorDeletedNote_label({ actor, title });
    }
    return m.events_activity_deletedNote_label({ title });
  },

  // Git events
  'git:commit': (event) => {
    const data = event.data as any;
    const message = data?.message;
    if (message) {
      // Truncate long commit messages
      const truncated = message.length > 40 ? `${message.slice(0, 37)}...` : message;
      return m.events_activity_committed_label({ message: truncated });
    }
    return m.events_activity_madeCommit_label();
  },

  'git:push': () => m.events_activity_pushedChanges_label(),

  'git:pull': () => m.events_activity_pulledChanges_label(),

  'git:branch': (event) => {
    const data = event.data as any;
    const branch = data?.branch || data?.name;
    if (branch) {
      return m.events_activity_switchedTo_label({ branch });
    }
    return m.events_activity_changedBranch_label();
  },

  'git:merge': (event) => {
    const data = event.data as any;
    const branch = data?.branch || data?.source;
    if (branch) {
      return m.events_activity_merged_label({ branch });
    }
    return m.events_activity_mergedBranches_label();
  },

  // Agent events - always try to show agent name from actor or data
  'agent:started': (event) => {
    const data = event.data as any;
    // Try actor name first, then data fields
    const name = truncate(
      event.actor?.name || data?.name || data?.agentName || data?.taskTitle || '',
      35,
    );
    if (name) {
      return m.events_activity_startedWorking_label({ name });
    }
    return m.events_activity_agentStarted_label();
  },

  'agent:completed': (event) => {
    const data = event.data as any;
    const name = truncate(event.actor?.name || data?.name || data?.agentName || '', 35);
    if (name) {
      return m.events_activity_nameCompleted_label({ name });
    }
    return m.events_activity_agentCompleted_label();
  },

  'agent:failed': (event) => {
    const data = event.data as any;
    const name = truncate(event.actor?.name || data?.name || data?.agentName || '', 35);
    if (name) {
      return m.events_activity_nameFailed_label({ name });
    }
    return m.events_activity_agentFailed_label();
  },

  'agent:deleted': (event) => {
    const data = event.data as any;
    const name = truncate(event.actor?.name || data?.name || data?.agentName || '', 35);
    if (name) {
      return m.events_activity_deletedName_label({ name });
    }
    return m.events_activity_agentDeleted_label();
  },

  'agent:message': (event) => {
    const name = truncate(getActorName(event, ''), 30);
    if (name) {
      return m.events_activity_nameSentMessage_label({ name });
    }
    return m.events_activity_agentSentMessage_label();
  },

  'agent:idle': (event) => {
    const data = event.data as any;
    const name = truncate(event.actor?.name || data?.name || data?.agentName || '', 35);
    if (name) {
      return m.events_activity_nameFinished_label({ name });
    }
    return m.events_activity_agentFinished_label();
  },

  'agent:status-changed': (event) => {
    const data = event.data as any;
    const name = truncate(event.actor?.name || data?.name || data?.agentName || '', 30);
    const status = data?.status || data?.newStatus;
    const displayName = name || m.events_activity_agent_fallback();

    // Map status to friendly phrase
    switch (status) {
      case 'idle':
        return m.events_activity_nameFinished_label({ name: displayName });
      case 'responding':
      case 'streaming':
      case 'thinking':
        return m.events_activity_nameIsWorking_label({ name: displayName });
      case 'waiting':
      case 'waiting_for_input':
        return m.events_activity_nameIsWaiting_label({ name: displayName });
      case 'completed':
      case 'done':
        return m.events_activity_nameCompleted_label({ name: displayName });
      case 'error':
      case 'failed':
        return m.events_activity_nameEncounteredError_label({ name: displayName });
      default:
        if (status) {
          return m.events_activity_nameIsStatus_label({ name: displayName, status });
        }
        return m.events_activity_nameStatusChanged_label({ name: displayName });
    }
  },

  'agent:tool:call': (event) => {
    const data = event.data as any;
    // `title` is the human-readable ACP tool-call title (e.g. "Read foo.ts");
    // prefer it over the raw tool name (§6.6 payload). `tool_call_update`
    // payloads only carry changed fields, so `title` is often empty there —
    // fall back to the `_acpTitle` echoed on the input, then the tool name,
    // then a toolKind-based phrase.
    const title = truncate(data?.title || data?.input?._acpTitle || '', 40);
    if (title) {
      return title;
    }
    // Clean the tool name so raw MCP identifiers (mcp__<server>__<tool>, from
    // older daemons) never display in the activity feed. Unstrippable raw
    // names (e.g. server segments with underscores) and deferred tool-loading
    // selectors ("Search select:mcp__...") are dropped entirely.
    const rawName = data?.toolName || data?.name || '';
    const cleaned = cleanToolName(rawName);
    const toolName =
      isRawMcpName(cleaned) || isDeferredToolLoad(rawName, data?.input ?? {})
        ? ''
        : truncate(cleaned, 25);
    const actor = truncate(getActorName(event, ''), 25);
    if (toolName && actor) {
      return m.events_activity_actorUsedTool_label({ actor, toolName });
    }
    if (toolName) {
      return m.events_activity_usedTool_label({ toolName });
    }
    // toolKind is one of file|search|terminal|git|note|other (§6.6).
    switch (data?.toolKind) {
      case 'file':
        return 'Worked on a file';
      case 'search':
        return 'Searched the codebase';
      case 'terminal':
        return 'Ran a terminal command';
      case 'git':
        return 'Ran a git operation';
      case 'note':
        return 'Worked on a note';
      default:
        return 'Used a tool';
    }
  },

  'agent:created': (event) => {
    const data = event.data as any;
    // Use the agent name from data (the created agent), not actor.name (who created it).
    // A default pre-rename name of "Agent" reads doubled ("Created agent Agent"), so drop it.
    const rawName = String(data?.agentName || data?.name || '');
    const agentName = /^agent$/i.test(rawName.trim()) ? '' : truncate(rawName, 20);
    const creatorName = truncate(getActorName(event, ''), 20);
    if (agentName && creatorName) {
      return m.events_activity_creatorCreatedAgent_label({ creator: creatorName, agentName });
    }
    if (agentName) {
      return m.events_activity_createdAgentName_label({ agentName });
    }
    if (creatorName) {
      return m.events_activity_creatorCreatedAnAgent_label({ creator: creatorName });
    }
    return m.events_activity_createdNewAgent_label();
  },

  'agent:renamed': (event) => {
    const data = event.data as any;
    // Payload is `{ agentId, name }` — the new name.
    const name = truncate(data?.name || '', 30);
    if (name) {
      return `Renamed agent to ${name}`;
    }
    return 'Renamed an agent';
  },

  'agent:updated': (event) => {
    const data = event.data as any;
    const name = truncate(event.actor?.name || data?.agentName || '', 25);
    const who = name || 'Agent';
    // Payload carries the specific mutation (§5.5): modelId for setModel, etc.
    if (typeof data?.modelId === 'string' && data.modelId) {
      return `${who} model set to ${truncate(data.modelId, 25)}`;
    }
    if (data?.completionReportCleared) {
      return `Cleared ${who.toLowerCase() === 'agent' ? "an agent's" : `${who}'s`} report`;
    }
    return `${who} settings updated`;
  },

  'agent:restored': (event) => {
    const data = event.data as any;
    const name = truncate(event.actor?.name || data?.name || data?.agentName || '', 30);
    if (name) {
      return `Restored ${name}`;
    }
    return 'Restored an agent';
  },

  'agent:permission:request': (event) => {
    const data = event.data as any;
    // Payload is PermissionRequestData: `{ title, agentName, riskLevel }` (§8);
    // `title` is the tool-call title (e.g. "Run pnpm test").
    const agentName = truncate(data?.agentName || event.actor?.name || '', 20);
    const title = truncate(data?.title || '', 35);
    if (agentName && title) {
      return `${agentName} asked to ${lowercaseFirst(title)}`;
    }
    if (title) {
      return `Permission requested: ${title}`;
    }
    return 'Agent asked for permission';
  },

  'agent:permission:resolved': (event) => {
    const data = event.data as any;
    // Payload is `{ requestId, outcome: { outcome: "selected"|"cancelled" } }`.
    const outcome = data?.outcome?.outcome;
    if (outcome === 'cancelled') {
      return 'Permission request dismissed';
    }
    return 'Permission request answered';
  },

  'agent:user-message:sent': (event) => {
    const data = event.data as any;
    const agentName = truncate(data?.agentName || data?.toAgentName || '', 25);
    if (agentName) {
      return `You messaged ${agentName}`;
    }
    return 'You sent a message';
  },

  // Task events - show task name and status clearly. The status verb LEADS
  // the sentence so the (untruncated) task title is the tail — the row's CSS
  // `truncate` clips the title with a single ellipsis instead of the metadata.
  'task:status-changed': (event) => {
    const data = event.data as any;
    const taskName = data?.taskName || data?.noteTitle || '';
    const newStatus = data?.newStatus || data?.status;
    const actor = truncate(getActorName(event, ''), 25);

    // Convert status to friendly format
    let friendlyStatus = m.events_activity_statusUpdated_label();
    if (newStatus) {
      const statusLower = newStatus.toLowerCase().replace(/_/g, ' ');
      if (statusLower === 'complete' || statusLower === 'completed' || statusLower === 'done') {
        friendlyStatus = m.events_activity_statusComplete_label();
      } else if (statusLower === 'in progress' || statusLower === 'in_progress') {
        friendlyStatus = m.events_activity_statusInProgress_label();
      } else if (statusLower === 'cancelled' || statusLower === 'canceled') {
        friendlyStatus = m.events_activity_statusCancelled_label();
      } else {
        friendlyStatus = statusLower;
      }
    }

    if (taskName && taskName !== 'task') {
      const verb =
        friendlyStatus === 'complete'
          ? 'Completed'
          : friendlyStatus === 'in progress'
            ? 'Started'
            : friendlyStatus === 'cancelled'
              ? 'Cancelled'
              : `Marked ${friendlyStatus}:`;
      return `${verb} ${taskName}`;
    }
    if (actor) {
      return m.events_activity_actorUpdatedTaskStatus_label({ actor });
    }
    return m.events_activity_taskMarked_label({ status: friendlyStatus });
  },

  'task:ready-tasks-changed': (event) => {
    const data = event.data as any;
    // Payload is `{ readyTaskIds, triggeredBy: { previousStatus, newStatus } }`.
    const count = Array.isArray(data?.readyTaskIds)
      ? data.readyTaskIds.length
      : data?.count || data?.taskCount;
    if (typeof count === 'number') {
      if (count === 0) return 'No tasks ready to start';
      return count === 1 ? '1 task ready to start' : `${count} tasks ready to start`;
    }
    return m.events_activity_readyTasksUpdated_label();
  },

  'task:agent-linked': (event) => {
    const data = event.data as any;
    // Payload is `{ noteId, taskKey, link: { taskText, agentId } }` (§6.7).
    // Tail position — leave untruncated for CSS to clip.
    const taskText = data?.link?.taskText || data?.taskKey || '';
    if (taskText) {
      return `Agent assigned to ${taskText}`;
    }
    return 'Agent assigned to a task';
  },

  'task:agent-unlinked': (event) => {
    const data = event.data as any;
    const taskText = data?.taskKey || '';
    if (taskText) {
      return `Agent unassigned from ${taskText}`;
    }
    return 'Agent unassigned from a task';
  },

  // Pull request events (§7.6)
  'pr:linked': (event) => {
    const data = event.data as any;
    const prNumber = data?.prNumber;
    if (prNumber) {
      return `Linked PR #${prNumber}`;
    }
    return 'Linked a pull request';
  },

  'pr:updated': (event) => {
    const data = event.data as any;
    const prNumber = data?.prNumber;
    const status = typeof data?.prStatus === 'string' ? data.prStatus.toLowerCase() : '';
    if (prNumber && status) {
      return `PR #${prNumber} is ${status === 'draft' ? 'a draft' : status}`;
    }
    if (prNumber) {
      return `PR #${prNumber} updated`;
    }
    return 'Pull request updated';
  },

  'pr:unlinked': () => 'Unlinked pull request',

  // Terminal events
  'terminal:command': (event) => {
    const data = event.data as any;
    const command = data?.command;
    const actor = truncate(getActorName(event, ''), 25);
    if (command) {
      const truncatedCmd = truncate(command, 25);
      if (actor) {
        return m.events_activity_actorRanCommand_label({ actor, command: truncatedCmd });
      }
      return m.events_activity_ranCommandName_label({ command: truncatedCmd });
    }
    if (actor) {
      return m.events_activity_actorRanACommand_label({ actor });
    }
    return m.events_activity_ranCommand_label();
  },

  'terminal:exit': (event) => {
    const data = event.data as any;
    // Payload is `{ terminalId, exitCode, signal }`.
    const exitCode = data?.exitCode;
    if (typeof exitCode === 'number' && exitCode !== 0) {
      return `Terminal exited with code ${exitCode}`;
    }
    return 'Terminal session ended';
  },

  'terminal:title': (event) => {
    const data = event.data as any;
    const title = truncate(data?.title || '', 35);
    if (title) {
      return `Terminal running ${title}`;
    }
    return 'Terminal title changed';
  },

  // Script events
  'script:state': (event) => {
    const data = event.data as any;
    // Payload is ScriptRuntimeState + scriptId: `{ scriptId, status, exitCode, error }`.
    const scriptId = truncate(data?.scriptId || '', 25);
    const status = data?.status;
    const name = scriptId || 'Script';
    switch (status) {
      case 'running':
        return `${name} started`;
      case 'stopped': {
        const exitCode = data?.exitCode;
        if (typeof exitCode === 'number' && exitCode !== 0) {
          return `${name} failed (exit ${exitCode})`;
        }
        return `${name} stopped`;
      }
      case 'error':
        return `${name} errored${data?.error ? `: ${truncate(data.error, 30)}` : ''}`;
      default:
        return status ? `${name} is ${status}` : `${name} state changed`;
    }
  },

  // Test events
  'test:started': (event) => {
    const data = event.data as any;
    const testName = truncate(data?.testName || data?.testSuite || '', 30);
    const actor = truncate(getActorName(event, ''), 25);
    if (testName) {
      if (actor) {
        return m.events_activity_actorStartedTesting_label({ actor, testName });
      }
      return m.events_activity_startedTestingName_label({ testName });
    }
    if (actor) {
      return m.events_activity_actorStartedTests_label({ actor });
    }
    return m.events_activity_startedTests_label();
  },

  'test:completed': (event) => {
    const data = event.data as any;
    const status = data?.status;
    const testName = truncate(data?.testName || data?.testSuite || '', 30);

    if (status === 'passed') {
      return testName
        ? m.events_activity_testsPassedName_label({ testName })
        : m.events_activity_testsPassed_label();
    } else if (status === 'failed') {
      return testName
        ? m.events_activity_testsFailedName_label({ testName })
        : m.events_activity_testsFailed_label();
    }
    return testName
      ? m.events_activity_testsCompletedName_label({ testName })
      : m.events_activity_testsCompleted_label();
  },

  // Build events
  'build:started': (event) => {
    const data = event.data as any;
    const target = truncate(data?.target || '', 30);
    const actor = truncate(getActorName(event, ''), 25);
    if (target) {
      if (actor) {
        return m.events_activity_actorStartedBuilding_label({ actor, target });
      }
      return m.events_activity_startedBuildingTarget_label({ target });
    }
    if (actor) {
      return m.events_activity_actorStartedBuild_label({ actor });
    }
    return m.events_activity_startedBuild_label();
  },

  'build:completed': (event) => {
    const data = event.data as any;
    const status = data?.status;
    const target = truncate(data?.target || '', 30);

    if (status === 'success') {
      return target
        ? m.events_activity_buildSucceededTarget_label({ target })
        : m.events_activity_buildSucceeded_label();
    } else if (status === 'failed') {
      return target
        ? m.events_activity_buildFailedTarget_label({ target })
        : m.events_activity_buildFailed_label();
    }
    return target
      ? m.events_activity_buildCompletedTarget_label({ target })
      : m.events_activity_buildCompleted_label();
  },

  // Workspace events
  'workspace:created': (event) => {
    const data = event.data as any;
    // Payload is `{ workspaceId, workspace }` (§6.7).
    const name = truncate(data?.workspace?.title || data?.name || '', 35);
    if (name) {
      return m.events_activity_createdWorkspaceName_label({ name });
    }
    return m.events_activity_createdWorkspace_label();
  },
  'workspace:updated': (event) => {
    const data = event.data as any;
    // Payload is `{ workspaceId, changes }` where `changes` is the applied
    // WorkspaceUpdate delta (PROTOCOL §6.5) — describe what actually changed.
    const changes = (data?.changes ?? {}) as Record<string, unknown>;
    if (typeof changes.title === 'string' && changes.title) {
      return `Renamed workspace to ${truncate(changes.title, 30)}`;
    }
    if (typeof changes.statusMessage === 'string') {
      return changes.statusMessage
        ? `Status: ${truncate(changes.statusMessage, 40)}`
        : 'Cleared workspace status';
    }
    if (typeof changes.status === 'string' && changes.status) {
      return `Workspace marked ${changes.status.toLowerCase()}`;
    }
    if (typeof changes.branch === 'string' && changes.branch) {
      return `Branch set to ${truncate(changes.branch, 30)}`;
    }
    if (typeof changes.baseRef === 'string' && changes.baseRef) {
      return `Base branch set to ${truncate(changes.baseRef, 30)}`;
    }
    const FIELD_LABELS: Record<string, string> = {
      baseCommitSha: 'base commit',
      statusMessage: 'status message',
      lastActivity: 'activity time',
      repositoryPath: 'repository path',
      repositoryOwner: 'repository owner',
      repositoryName: 'repository name',
      worktreePath: 'worktree path',
      setupScript: 'setup script',
      skipWorktree: 'worktree setting',
    };
    const changedFields = Object.keys(changes).filter((key) => key !== 'workspaceId');
    if (changedFields.length > 0) {
      const friendly = changedFields.map((field) => FIELD_LABELS[field] ?? field);
      return `Changed workspace ${truncate(friendly.join(', '), 35)}`;
    }
    const name = truncate(data?.name || '', 35);
    if (name) {
      return m.events_activity_updatedWorkspaceName_label({ name });
    }
    return m.events_activity_updatedWorkspace_label();
  },
  'workspace:deleted': (event) => {
    const data = event.data as any;
    const name = truncate(data?.name || '', 35);
    if (name) {
      return m.events_activity_deletedWorkspaceName_label({ name });
    }
    return m.events_activity_deletedWorkspace_label();
  },
  'workspace:opened': (event) => {
    const data = event.data as any;
    const name = truncate(data?.name || '', 35);
    if (name) {
      return m.events_activity_openedName_label({ name });
    }
    return m.events_activity_openedWorkspace_label();
  },
  'workspace:closed': (event) => {
    const data = event.data as any;
    const name = truncate(data?.name || '', 35);
    if (name) {
      return m.events_activity_closedName_label({ name });
    }
    return m.events_activity_closedWorkspace_label();
  },
  'workspace:activity': (event) => {
    const data = event.data as any;
    const description = truncate(data?.description || '', 40);
    if (description) {
      return description;
    }
    return m.events_activity_workspaceActivity_label();
  },

  // Spec events
  'spec:updated': (event) => {
    const data = event.data as any;
    const section = truncate(data?.section || '', 30);
    const actor = truncate(getActorName(event, ''), 25);
    if (section) {
      if (actor) {
        return m.events_activity_actorUpdatedSpecSection_label({ actor, section });
      }
      return m.events_activity_updatedSpecSection_label({ section });
    }
    if (actor) {
      return m.events_activity_actorUpdatedSpec_label({ actor });
    }
    return m.events_activity_updatedSpec_label();
  },

  'goal:updated': (event) => {
    const actor = truncate(getActorName(event, ''), 30);
    if (actor) {
      return m.events_activity_actorUpdatedGoal_label({ actor });
    }
    return m.events_activity_updatedGoal_label();
  },

  // Comment events
  'comment:added': (event) => {
    const data = event.data as any;
    const author = truncate(event.actor?.name || data?.author || data?.authorName || '', 30);
    const preview = truncate(data?.preview || data?.text || '', 25);
    if (author && preview) {
      return m.events_activity_authorCommentedPreview_label({ author, preview });
    }
    if (author) {
      return m.events_activity_authorCommented_label({ author });
    }
    if (preview) {
      return m.events_activity_commentPreview_label({ preview });
    }
    return m.events_activity_commentAdded_label();
  },

  // Agent message events (for agent-to-agent communication)
  'agent:message:sent': (event) => {
    const data = event.data as any;
    const fromName = truncate(
      event.actor?.name || data?.fromAgentName || m.events_activity_agent_fallback(),
      25,
    );
    const toName = truncate(data?.toAgentName || '', 25);
    if (toName) {
      return m.events_activity_fromMessagedTo_label({ fromName, toName });
    }
    return m.events_activity_fromSentMessage_label({ fromName });
  },

  'agent:message:received': (event) => {
    const data = event.data as any;
    const fromName = truncate(data?.fromAgentName || '', 25);
    const toName = truncate(
      event.actor?.name || data?.toAgentName || m.events_activity_agent_fallback(),
      25,
    );
    if (fromName) {
      return m.events_activity_receivedMessageFrom_label({ toName, fromName });
    }
    return m.events_activity_receivedAMessage_label({ toName });
  },

  'agent:message:delivery-failed': (event) => {
    const data = event.data as any;
    const toName = truncate(data?.toAgentName || data?.agentName || '', 25);
    if (toName) {
      return `Message to ${toName} failed to deliver`;
    }
    return 'Agent message failed to deliver';
  },

  // Agent subscription events
  'agent:subscribed': (event) => {
    const data = event.data as any;
    const name = truncate(
      event.actor?.name || data?.agentName || m.events_activity_agent_fallback(),
      30,
    );
    const eventTypes = data?.eventTypes;
    if (eventTypes?.length === 1) {
      return m.events_activity_watchingCategoryEvents_label({
        name,
        category: eventTypes[0].split(':')[0],
      });
    }
    if (eventTypes?.length > 1) {
      return m.events_activity_watchingForUpdates_label({ name });
    }
    return m.events_activity_startedWatching_label({ name });
  },

  'agent:unsubscribed': (event) => {
    const data = event.data as any;
    const name = truncate(
      event.actor?.name || data?.agentName || m.events_activity_agent_fallback(),
      30,
    );
    return m.events_activity_stoppedWatching_label({ name });
  },

  'agent:woken-by-subscription': (event) => {
    const data = event.data as any;
    const name = truncate(
      event.actor?.name || data?.agentName || m.events_activity_agent_fallback(),
      30,
    );
    const eventCount = data?.eventCount || 1;
    if (eventCount === 1) {
      return m.events_activity_nameResumed_label({ name });
    }
    return m.events_activity_nameResumedEvents_label({ name, count: eventCount });
  },

  // Agent resumed event (different from woken-by-subscription)
  'agent:resumed': (event) => {
    const data = event.data as any;
    const name = truncate(event.actor?.name || data?.agentName || data?.name || '', 35);
    if (name) {
      return m.events_activity_nameResumed_label({ name });
    }
    return m.events_activity_agentResumed_label();
  },

  'comment:resolved': (event) => {
    const data = event.data as any;
    // Payload is `{ noteId, threadId, resolved }` — resolved:false means reopened.
    if (data?.resolved === false) {
      return 'Reopened a comment thread';
    }
    return 'Resolved a comment thread';
  },

  // Git clone events
  'git:clone:done': (event) => {
    const data = event.data as any;
    const repo = truncate(data?.repository || data?.repo || data?.url || '', 35);
    if (repo) {
      return `Cloned ${repo}`;
    }
    return 'Repository cloned';
  },

  // Settings & config events
  'settings:changed': (event) => {
    const data = event.data as any;
    // Payload is `{ changes: [{ path, value }] }` with redacted values (§9.8).
    const paths = Array.isArray(data?.changes)
      ? data.changes.map((c: { path?: string }) => c?.path).filter(Boolean)
      : [];
    if (paths.length === 1) {
      return `Changed setting ${truncate(paths[0], 35)}`;
    }
    if (paths.length > 1) {
      return `Changed ${paths.length} settings`;
    }
    return 'Settings changed';
  },

  'skills:changed': () => 'Available skills changed',

  'mcp:notification': (event) => {
    const data = event.data as any;
    const server = truncate(data?.serverName || data?.server || '', 25);
    if (server) {
      return `Update from ${server}`;
    }
    return 'MCP server notification';
  },

  'mcp.servers:status-changed': () => 'MCP server status changed',

  'github:auth-changed': (event) => {
    const data = event.data as any;
    const status = data?.status;
    if (status === 'authenticated' || status === 'success') {
      return 'Signed in to GitHub';
    }
    if (status === 'signed-out' || status === 'expired') {
      return 'GitHub sign-in expired';
    }
    return 'GitHub authentication changed';
  },

  'workspace:context-changed': () => 'Workspace context updated',
};

/**
 * Get a natural language label for an activity event
 */
export function getActivityLabel(event: WorkspaceEvent): string {
  // Guard against undefined event or type
  if (!event?.type) {
    return m.events_activity_unknownActivity_label();
  }

  const generator = labelGenerators[event.type];
  if (generator) {
    try {
      return generator(event);
    } catch {
      // Fall through to default
    }
  }

  // Default: convert event type to readable format
  // e.g., 'file:changed' -> 'File changed'
  const parts = event.type.split(':');
  if (parts.length >= 2) {
    const [category, action] = parts;
    return `${category.charAt(0).toUpperCase() + category.slice(1)} ${action}`;
  }

  return event.type.replace(/[_:]/g, ' ');
}

/**
 * Get a short label (just the action verb) for compact displays
 */
export function getActivityVerb(event: WorkspaceEvent): string {
  const data = event.data as any;

  switch (event.type) {
    case 'file:changed':
      switch (data?.action) {
        case 'create':
          return m.events_activity_verbCreated_short();
        case 'delete':
          return m.events_activity_verbDeleted_short();
        case 'rename':
          return m.events_activity_verbRenamed_short();
        default:
          return m.events_activity_verbUpdated_short();
      }
    case 'file:created':
      return m.events_activity_verbCreated_short();
    case 'file:deleted':
      return m.events_activity_verbDeleted_short();
    case 'file:renamed':
      return m.events_activity_verbRenamed_short();
    case 'note:created':
      return m.events_activity_verbCreated_short();
    case 'note:updated':
      return m.events_activity_verbUpdated_short();
    case 'note:deleted':
      return m.events_activity_verbDeleted_short();
    case 'git:commit':
      return m.events_activity_verbCommitted_short();
    case 'git:push':
      return m.events_activity_verbPushed_short();
    case 'git:pull':
      return m.events_activity_verbPulled_short();
    case 'agent:started':
      return m.events_activity_verbStarted_short();
    case 'agent:completed':
      return m.events_activity_verbCompleted_short();
    case 'terminal:command':
      return m.events_activity_verbRan_short();
    default:
      return event.type.split(':')[1] || m.events_activity_activity_short();
  }
}

/**
 * Get the subject of the activity (e.g., filename, note title)
 */
export function getActivitySubject(event: WorkspaceEvent): string | null {
  const data = event.data as any;

  if (event.type.startsWith('file:') && data?.path) {
    return parseFilePath(data.path).filename;
  }

  if (event.type.startsWith('note:') && data?.title) {
    return data.title;
  }

  if (event.type === 'agent:tool:call' && data?.toolName) {
    const cleaned = cleanToolName(data.toolName);
    // Unstrippable raw MCP identifiers and deferred tool-loading selectors must
    // never surface as the subject
    return !cleaned || isRawMcpName(cleaned) || isDeferredToolLoad(data.toolName, data.input ?? {})
      ? null
      : cleaned;
  }

  if (event.type === 'terminal:command' && data?.command) {
    const truncated = data.command.length > 30 ? `${data.command.slice(0, 27)}...` : data.command;
    return truncated;
  }

  return null;
}

/**
 * Map of event types to their structured label generators
 * These return arrays of LabelParts with optional emphasis for semibold styling
 */
const structuredLabelGenerators: Record<string, StructuredLabelGenerator> = {
  // File events - actor and filename get emphasis
  'file:changed': (event) => {
    const data = event.data as any;
    const filename = data?.path
      ? truncate(parseFilePath(data.path).filename, 35)
      : m.events_activity_file_fallback();
    const actor = getActorName(event, '');
    const action = data?.action;
    const verb =
      action === 'create'
        ? m.events_activity_verbCreated_label()
        : action === 'delete'
          ? m.events_activity_verbDeleted_label()
          : action === 'rename'
            ? m.events_activity_verbRenamed_label()
            : m.events_activity_verbUpdated_label();
    if (actor) {
      return [
        { text: actor, emphasis: true },
        { text: m.events_activity_partVerbSpace_label({ verb }) },
        { text: filename, emphasis: true },
      ];
    }
    return [
      {
        text: m
          .events_activity_partVerbSpace_label({
            verb: verb.charAt(0).toUpperCase() + verb.slice(1),
          })
          .trimStart(),
      },
      { text: filename, emphasis: true },
    ];
  },

  'file:created': (event) => {
    const data = event.data as any;
    const filename = data?.path
      ? truncate(parseFilePath(data.path).filename, 35)
      : m.events_activity_file_fallback();
    const actor = getActorName(event, '');
    if (actor) {
      return [
        { text: actor, emphasis: true },
        { text: m.events_activity_partCreatedSpace_label() },
        { text: filename, emphasis: true },
      ];
    }
    return [
      { text: m.events_activity_partCreatedPrefix_label() },
      { text: filename, emphasis: true },
    ];
  },

  'file:deleted': (event) => {
    const data = event.data as any;
    const filename = data?.path
      ? truncate(parseFilePath(data.path).filename, 35)
      : m.events_activity_file_fallback();
    const actor = getActorName(event, '');
    if (actor) {
      return [
        { text: actor, emphasis: true },
        { text: m.events_activity_partDeletedSpace_label() },
        { text: filename, emphasis: true },
      ];
    }
    return [
      { text: m.events_activity_partDeletedPrefix_label() },
      { text: filename, emphasis: true },
    ];
  },

  'file:renamed': (event) => {
    const data = event.data as any;
    const filename = data?.path
      ? truncate(parseFilePath(data.path).filename, 30)
      : m.events_activity_file_fallback();
    const oldFilename = data?.oldPath ? truncate(parseFilePath(data.oldPath).filename, 20) : null;
    const actor = getActorName(event, '');
    if (oldFilename) {
      if (actor) {
        return [
          { text: actor, emphasis: true },
          { text: m.events_activity_partRenamedSpace_label() },
          { text: oldFilename, emphasis: true },
          { text: m.events_activity_partArrow_label() },
          { text: filename, emphasis: true },
        ];
      }
      return [
        { text: m.events_activity_partRenamedPrefix_label() },
        { text: oldFilename, emphasis: true },
        { text: m.events_activity_partArrow_label() },
        { text: filename, emphasis: true },
      ];
    }
    if (actor) {
      return [
        { text: actor, emphasis: true },
        { text: m.events_activity_partRenamedSpace_label() },
        { text: filename, emphasis: true },
      ];
    }
    return [
      { text: m.events_activity_partRenamedPrefix_label() },
      { text: filename, emphasis: true },
    ];
  },

  // Note events - actor and note title get emphasis (no quotes)
  'note:created': (event) => {
    const data = event.data as any;
    const title = truncate(data?.title || data?.name || m.events_activity_note_fallback(), 35);
    const actor = getActorName(event, '');
    if (actor) {
      return [
        { text: actor, emphasis: true },
        { text: m.events_activity_partCreatedSpace_label() },
        { text: title, emphasis: true },
      ];
    }
    return [{ text: m.events_activity_partCreatedPrefix_label() }, { text: title, emphasis: true }];
  },

  'note:updated': (event) => {
    const data = event.data as any;
    const title = truncate(data?.title || data?.name || m.events_activity_note_fallback(), 35);
    const actor = getActorName(event, '');
    if (actor) {
      return [
        { text: actor, emphasis: true },
        { text: m.events_activity_partUpdatedSpace_label() },
        { text: title, emphasis: true },
      ];
    }
    return [{ text: m.events_activity_partUpdatedPrefix_label() }, { text: title, emphasis: true }];
  },

  'note:deleted': (event) => {
    const data = event.data as any;
    const title = truncate(data?.title || data?.name || m.events_activity_note_fallback(), 35);
    const actor = getActorName(event, '');
    if (actor) {
      return [
        { text: actor, emphasis: true },
        { text: m.events_activity_partDeletedSpace_label() },
        { text: title, emphasis: true },
      ];
    }
    return [{ text: m.events_activity_partDeletedPrefix_label() }, { text: title, emphasis: true }];
  },

  // Agent events - agent name gets emphasis
  'agent:started': (event) => {
    const data = event.data as any;
    const name = truncate(
      event.actor?.name || data?.name || data?.agentName || data?.taskTitle || '',
      35,
    );
    if (name) {
      return [
        { text: name, emphasis: true },
        { text: m.events_activity_partStartedWorking_label() },
      ];
    }
    return [{ text: m.events_activity_agentStarted_label() }];
  },

  'agent:completed': (event) => {
    const data = event.data as any;
    const name = truncate(event.actor?.name || data?.name || data?.agentName || '', 35);
    if (name) {
      return [{ text: name, emphasis: true }, { text: m.events_activity_partCompleted_label() }];
    }
    return [{ text: m.events_activity_agentCompleted_label() }];
  },

  'agent:failed': (event) => {
    const data = event.data as any;
    const name = truncate(event.actor?.name || data?.name || data?.agentName || '', 35);
    if (name) {
      return [{ text: name, emphasis: true }, { text: m.events_activity_partFailed_label() }];
    }
    return [{ text: m.events_activity_agentFailed_label() }];
  },

  'agent:deleted': (event) => {
    const data = event.data as any;
    const name = truncate(event.actor?.name || data?.name || data?.agentName || '', 35);
    if (name) {
      return [
        { text: m.events_activity_partDeletedPrefix_label() },
        { text: name, emphasis: true },
      ];
    }
    return [{ text: m.events_activity_agentDeleted_label() }];
  },

  'agent:idle': (event) => {
    const data = event.data as any;
    const name = truncate(event.actor?.name || data?.name || data?.agentName || '', 35);
    if (name) {
      return [{ text: name, emphasis: true }, { text: m.events_activity_partFinished_label() }];
    }
    return [{ text: m.events_activity_agentFinished_label() }];
  },

  'agent:created': (event) => {
    const data = event.data as any;
    const name = truncate(data?.agentName || data?.name || event.actor?.name || '', 35);
    if (name) {
      return [{ text: name, emphasis: true }, { text: m.events_activity_partCreated_label() }];
    }
    return [{ text: m.events_activity_agentCreated_label() }];
  },
};

/**
 * Get a structured label for an activity event (for rich text rendering)
 * Returns an array of LabelParts with optional emphasis styling
 */
export function getActivityLabelParts(event: WorkspaceEvent): StructuredLabel {
  const generator = structuredLabelGenerators[event.type];
  if (generator) {
    return generator(event);
  }

  // Fall back to plain string label as single part
  const plainLabel = getActivityLabel(event);
  return [{ text: plainLabel }];
}
