/**
 * WebSocket Protocol Handler
 *
 * Handles incoming JSON-RPC 2.0 messages over WebSocket connections,
 * validates them, and routes to the ProtocolAdapter for execution.
 *
 * This module is transport-agnostic — it takes a message string and
 * returns a response string (or null for notifications).
 */

import { Logger } from '../shared/logger';
import { protocolAdapter } from '../features/protocol/main/protocol-adapter';
import { AgentBackendHandler } from '../features/agent/main/agent-backend-handler.service';
import { PROVIDER_MODEL_TIERS } from '../shared/config/provider-config';
import { LIMITS } from '../shared/constants';
import { getAllRepos, syncRepos } from '../features/workspace/main/repo-registry';
import { execAsync } from '../shared/git/git-env';
import { buildNoteApi } from '../features/mcp/main/mcp/ws-note-api';
import { buildAgentApi } from '../features/mcp/main/mcp/ws-agent-api';
import { buildWsGitApi } from '../features/mcp/main/mcp/ws-git-api';
import { buildWsPrApi, type PRContext } from '../features/mcp/main/mcp/ws-pr-api';
import { buildScriptApi } from '../features/mcp/main/mcp/ws-script-api';
import { buildWsEventApi } from '../features/mcp/main/mcp/ws-event-api';
import {
  buildBrowserApi,
  buildCrossWorkspaceApi,
  buildFileApi,
  buildTerminalApi,
} from '../features/mcp/main/mcp/ws-misc-api';

const logger = new Logger('WebSocketProtocol');

// One-time background sync flag for repo registry
let repoRegistrySynced = false;

// ============================================================================
// JSON-RPC 2.0 Types
// ============================================================================

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, any>;
  /** Whether the 'id' key was present in the raw JSON (false = notification per JSON-RPC 2.0) */
  _hasId: boolean;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: any;
  error?: JsonRpcError;
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: any;
}

// JSON-RPC 2.0 Error Codes
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

// ============================================================================
// Error Helpers
// ============================================================================

class ProtocolError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: any,
  ) {
    super(message);
    this.name = 'ProtocolError';
  }
}

function requireParam(params: Record<string, any>, name: string): void {
  if (params[name] === undefined || params[name] === null) {
    throw new ProtocolError(INVALID_PARAMS, `Missing required parameter: ${name}`);
  }
}

/**
 * Build a short human-readable description of an agent subscription's filter
 * for the `agent.getSubscriptions` response. Surfaces the most salient fields
 * (event types, actor scope, delegation group) so external clients can render
 * the subscription without re-deriving the filter semantics.
 */
function describeAgentSubscription(sub: {
  agentName: string;
  filter: {
    eventTypes?: string[];
    actorTypes?: string[];
    actorIds?: string[];
    delegationGroup?: { groupId: string; awaitMode: 'any' | 'all'; expectedAgentIds: string[] };
    oneShot?: boolean;
  };
}): string {
  const parts: string[] = [];
  const eventTypes = sub.filter.eventTypes;
  if (eventTypes && eventTypes.length > 0) {
    parts.push(eventTypes.length === 1 ? eventTypes[0] : `${eventTypes.length} event types`);
  } else {
    parts.push('all events');
  }
  const actorIds = sub.filter.actorIds;
  if (actorIds && actorIds.length > 0) {
    parts.push(`from ${actorIds.length === 1 ? actorIds[0] : `${actorIds.length} actors`}`);
  } else if (sub.filter.actorTypes && sub.filter.actorTypes.length > 0) {
    parts.push(`from ${sub.filter.actorTypes.join('/')}`);
  }
  if (sub.filter.delegationGroup) {
    const group = sub.filter.delegationGroup;
    parts.push(`delegation group ${group.groupId} (await ${group.awaitMode}, ${group.expectedAgentIds.length} expected)`);
  }
  if (sub.filter.oneShot) {
    parts.push('one-shot');
  }
  return `${sub.agentName}: ${parts.join(', ')}`;
}

// ============================================================================
// Response Builders
// ============================================================================

function makeResponse(id: string | number | null, result: any): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function makeErrorResponse(
  id: string | number | null,
  code: number,
  message: string,
  data?: any,
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
}

// ============================================================================
// Message Parsing & Validation
// ============================================================================

function parseMessage(raw: string): JsonRpcRequest {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProtocolError(PARSE_ERROR, 'Parse error: invalid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ProtocolError(INVALID_REQUEST, 'Invalid Request: expected an object');
  }

  if (parsed.jsonrpc !== '2.0') {
    throw new ProtocolError(INVALID_REQUEST, 'Invalid Request: jsonrpc must be "2.0"');
  }

  if (typeof parsed.method !== 'string' || parsed.method.length === 0) {
    throw new ProtocolError(
      INVALID_REQUEST,
      'Invalid Request: method must be a non-empty string',
    );
  }

  // JSON-RPC 2.0 §4.2: params may be an Array (positional) or Object (named).
  if (
    parsed.params !== undefined &&
    typeof parsed.params !== 'object'
  ) {
    throw new ProtocolError(INVALID_PARAMS, 'Invalid params: must be an object or array');
  }

  // Our method handlers expect named params (object). Convert positional arrays
  // to an empty object — callers using positional params will need to use named params
  // for our API, but we accept the message per spec rather than rejecting it.
  if (Array.isArray(parsed.params)) {
    parsed.params = {};
  }

  // Validate id type per JSON-RPC 2.0: id MUST be a string, number, or null.
  if ('id' in parsed && parsed.id !== null && typeof parsed.id !== 'string' && typeof parsed.id !== 'number') {
    throw new ProtocolError(INVALID_REQUEST, 'Invalid Request: id must be a string, number, or null');
  }

  // Track whether 'id' was present in the raw JSON.
  // Per JSON-RPC 2.0: notification = request without 'id' member.
  // A request with id: null is a valid request and MUST get a response.
  parsed._hasId = 'id' in parsed;

  return parsed as JsonRpcRequest;
}


// ============================================================================
// ws.* Adapter Scaffold (Track R, wave 2a)
// ============================================================================
//
// Per-request adapter that exposes the unified ws.* surface to JSON-RPC
// shims. Each method below mirrors the calling convention of the matching
// MCP `ws.*` builder (e.g. `ws.note.setContent`) so the handler bodies can
// stay thin and forward positional params straight through.
//
// Wave 2a covers the 9 existing wrapped methods (`workspace.*` CRUD +
// `note.list/get/create/update`). The `workspace` namespace wraps
// `protocolAdapter` directly because the MCP `ws.workspace.*` surface
// exposes metadata helpers only — no CRUD analogues exist there. Later
// waves extend this scaffold with `task.*`, `comment.*`, `primitive.*`,
// `pr.*`, `script.*`, `browser.*`, `terminal.*`, `file.*`, `event.*`,
// and `crossWorkspace.*` shims.
//
// Wire format (JSON-RPC method names, params, response shapes, error
// codes) is preserved byte-for-byte; the wire-format golden-snapshot
// suite in `websocket-protocol-handler.test.ts` is the watchdog.

// Minimal ToolCall stub for the per-request buildNoteApi() peers. The
// builder only reads `metadata` for provenance attribution; an empty stub
// is sufficient for the wave 2b JSON-RPC shims.
const NOTE_API_CALL_STUB = { arguments: {}, metadata: {} } as any;

// Per-request ToolCall for the wave 2c `ws.agent.*` / `ws.git.*` peers.
// Carries `context.workspaceId` so the builders can scope mutations to the
// authenticated workspace. `agentId` is intentionally omitted — external
// JSON-RPC clients are not delegated agents; methods that require a calling
// agent (e.g. `agent.reportToParent`) surface the underlying tool error.
function buildAgentCall(workspaceId: string): any {
  return { arguments: {}, context: { workspaceId }, metadata: {} };
}

function buildWsApi(workspaceId: string) {
  // Lazy-instantiate ws.note/comment/task peers from buildNoteApi() so
  // wave 2a shims that don't need them avoid the construction cost.
  let notePeers: ReturnType<typeof buildNoteApi> | null = null;
  const peers = () => {
    if (!notePeers) notePeers = buildNoteApi(protocolAdapter, workspaceId, NOTE_API_CALL_STUB);
    return notePeers;
  };

  // Wave 2c — lazy peers for ws.agent.*, ws.git.*, ws.pr.*.
  let agentPeer: ReturnType<typeof buildAgentApi> | null = null;
  const getAgentPeer = () => {
    if (!agentPeer) {
      agentPeer = buildAgentApi(workspaceId, '', buildAgentCall(workspaceId));
    }
    return agentPeer;
  };

  let gitPeer: ReturnType<typeof buildWsGitApi> | null = null;
  const getGitPeer = () => {
    if (!gitPeer) {
      gitPeer = buildWsGitApi({ workspaceId, call: buildAgentCall(workspaceId) });
    }
    return gitPeer;
  };

  // `pr.*` peer requires resolving the workspace's active pull request before
  // construction. Builder is invoked once per request, on first `pr.*` use.
  let prPeer: ReturnType<typeof buildWsPrApi> | null = null;
  const getPrPeer = async () => {
    if (!prPeer) {
      let prContext: PRContext | undefined;
      try {
        const workspace = await protocolAdapter.getWorkspace(workspaceId);
        const ws = workspace as any;
        if (
          ws?.activePullRequest &&
          ws.repositoryOwner &&
          ws.repositoryName &&
          (ws.activePullRequest.status === 'Open' || ws.activePullRequest.status === 'Draft')
        ) {
          prContext = {
            owner: ws.repositoryOwner,
            repo: ws.repositoryName,
            prNumber: ws.activePullRequest.number,
          };
        }
      } catch {
        // Fall through with prContext undefined — pr.* methods will throw
        // "No active PR" from the underlying builder.
      }
      prPeer = buildWsPrApi(prContext);
    }
    return prPeer;
  };

  // Track R, wave 2d — lazy peers for ws.script.*, ws.browser.*,
  // ws.terminal.*, ws.event.*, ws.crossWorkspace.*, ws.file.*. The
  // `primitive.*` namespace lives inside buildNoteApi(), so it reuses
  // the existing `peers()` getter above.
  let scriptPeer: ReturnType<typeof buildScriptApi> | null = null;
  const getScriptPeer = () => {
    if (!scriptPeer) scriptPeer = buildScriptApi(workspaceId);
    return scriptPeer;
  };

  let browserPeer: ReturnType<typeof buildBrowserApi> | null = null;
  const getBrowserPeer = () => {
    if (!browserPeer) browserPeer = buildBrowserApi(buildAgentCall(workspaceId));
    return browserPeer;
  };

  let terminalPeer: ReturnType<typeof buildTerminalApi> | null = null;
  const getTerminalPeer = () => {
    if (!terminalPeer) terminalPeer = buildTerminalApi(workspaceId);
    return terminalPeer;
  };

  let eventPeer: ReturnType<typeof buildWsEventApi> | null = null;
  const getEventPeer = () => {
    if (!eventPeer) eventPeer = buildWsEventApi(workspaceId, buildAgentCall(workspaceId));
    return eventPeer;
  };

  let crossWorkspacePeer: ReturnType<typeof buildCrossWorkspaceApi> | null = null;
  const getCrossWorkspacePeer = () => {
    if (!crossWorkspacePeer) {
      crossWorkspacePeer = buildCrossWorkspaceApi({
        workspaceId,
        workspaceManager: protocolAdapter as any,
      });
    }
    return crossWorkspacePeer;
  };

  // `file.*` peer requires resolving the workspace's filesystem path
  // before construction (matches the protocol adapter convention:
  // `worktreePath || repositoryPath || cwd`). Builder is invoked once
  // per request, on first `file.*` use.
  let filePeer: ReturnType<typeof buildFileApi> | null = null;
  const getFilePeer = async () => {
    if (!filePeer) {
      let workspacePath = '';
      try {
        const workspace = await protocolAdapter.getWorkspace(workspaceId);
        const ws = workspace as any;
        workspacePath = ws?.worktreePath || ws?.repositoryPath || '';
      } catch {
        // Fall through with empty workspacePath — file.* methods will
        // surface the underlying access-denied / path-outside errors.
      }
      filePeer = buildFileApi({
        workspaceId,
        workspacePath,
        call: buildAgentCall(workspaceId),
      });
    }
    return filePeer;
  };

  return {
    workspace: {
      async list(opts: { includeArchived?: boolean } = {}) {
        const includeArchived = opts.includeArchived ?? false;
        const result = await protocolAdapter.listAllWorkspaces({ includeArchived, lite: false });
        if (!result.ok) throw new ProtocolError(INTERNAL_ERROR, result.error);
        return result.data;
      },
      async get(id: string) {
        return await protocolAdapter.getWorkspace(id);
      },
      async create(params: Record<string, any>) {
        const result = await protocolAdapter.createWorkspace(params);
        if (!result.ok) throw new ProtocolError(INTERNAL_ERROR, result.error);
        return result.data;
      },
      async update(id: string, patch: Record<string, any>) {
        const result = await protocolAdapter.updateWorkspace({ id, ...patch });
        if (!result.ok) throw new ProtocolError(INTERNAL_ERROR, result.error);
        return result.data;
      },
      async delete(id: string) {
        const result = await protocolAdapter.deleteWorkspace(id);
        if (!result.ok) throw new ProtocolError(INTERNAL_ERROR, result.error);
      },
      async archive(id: string) {
        const result = await protocolAdapter.archiveWorkspace(id);
        if (!result.ok) throw new ProtocolError(INTERNAL_ERROR, result.error);
      },
      async unarchive(id: string) {
        const result = await protocolAdapter.unarchiveWorkspace(id);
        if (!result.ok) throw new ProtocolError(INTERNAL_ERROR, result.error);
      },
    },
    note: {
      async list() {
        return await protocolAdapter.listNotes(workspaceId);
      },
      async get(noteId: string) {
        return await protocolAdapter.getNote(workspaceId, noteId);
      },
      async create(input: { title: string; content?: string; tags?: string[]; parentId?: string }) {
        return await protocolAdapter.createNote(workspaceId, {
          title: input.title,
          content: input.content || '',
          tags: input.tags,
          parentId: input.parentId,
        } as any);
      },
      async setContent(noteId: string, content: string) {
        return await protocolAdapter.updateNote(workspaceId, noteId, { content });
      },
      async updateMetadata(
        noteId: string,
        updates: { title?: string; tags?: string[] },
      ) {
        return await protocolAdapter.updateNote(workspaceId, noteId, updates);
      },
      // Track R, wave 2b — 1:1 forwarders to ws.note.* peers (buildNoteApi).
      async add(
        noteId: string,
        options: { content: string; heading?: string; position?: string },
      ) {
        return await peers().note.add(noteId, options);
      },
      async edit(noteId: string, options: { old: string; new: string }) {
        return await peers().note.edit(noteId, options);
      },
      async editLines(
        noteId: string,
        options: { start: number | string; end: number | string; content: string },
      ) {
        return await peers().note.editLines(noteId, options);
      },
      async setContentPeer(
        noteId: string,
        content: string,
        confirmReplacement?: string | boolean,
      ) {
        return await peers().note.setContent(noteId, content, confirmReplacement);
      },
      async updateMetadataPeer(
        noteId: string,
        options: { title?: string; tags?: string | string[] },
      ) {
        return await peers().note.updateMetadata(noteId, options);
      },
      async delete(noteId: string) {
        return await peers().note.delete(noteId);
      },
      async listTasks(noteId: string) {
        return await peers().note.listTasks(noteId);
      },
      async readAsset(asset: string) {
        return await peers().note.readAsset(asset);
      },
    },
    // Track R, wave 2b — comment.* shims forward to ws.comment.* peers.
    comment: {
      async add(
        noteId: string,
        options: {
          searchContext: string;
          commentTarget: string;
          comment: string;
          type?: string;
          author?: string;
        },
      ) {
        return await peers().comment.add(noteId, options);
      },
      async list(
        noteId: string,
        options: {
          since?: string;
          authorType?: string;
          status?: string;
          includeComments?: boolean;
        } = {},
      ) {
        return await peers().comment.list(noteId, options);
      },
      async getThread(
        noteId: string,
        options: { threadId?: string; commentId?: string },
      ) {
        return await peers().comment.getThread(noteId, options);
      },
      async respond(
        noteId: string,
        options: {
          threadId?: string;
          commentId?: string;
          comment: string;
          type?: string;
          author?: string;
          suggestionOriginal?: string;
          suggestionProposed?: string;
        },
      ) {
        return await peers().comment.respond(noteId, options);
      },
      async delete(noteId: string, commentId: string) {
        return await peers().comment.delete(noteId, commentId);
      },
    },
    // Track R, wave 2b — task.* shims forward to ws.task.* peers.
    task: {
      async updateStatus(
        noteId: string,
        taskText: string,
        status: 'done' | 'todo' | 'in-progress',
      ) {
        return await peers().task.updateStatus(noteId, taskText, status);
      },
      async updateNoteStatus(noteId: string, status: string) {
        return await peers().task.updateNoteStatus(noteId, status);
      },
      async update(
        noteId: string,
        line: number,
        options: { text?: string; status?: 'todo' | 'in-progress' | 'done'; expected?: string },
      ) {
        return await peers().task.update(noteId, line, options);
      },
      async getMyTask(taskNoteId: string) {
        return await peers().task.getMyTask(taskNoteId);
      },
      async markAsTask(
        noteId: string,
        status: string,
        options: { acceptanceCriteria?: string[] | string; effort?: string } = {},
      ) {
        return await peers().task.markAsTask(noteId, status, options);
      },
      async convertBlocks(noteId: string) {
        return await peers().task.convertBlocks(noteId);
      },
      async createPrerequisite(
        dependentNoteId: string,
        title: string,
        options: { content?: string; status?: string } = {},
      ) {
        return await peers().task.createPrerequisite(dependentNoteId, title, options);
      },
      async assignAgent(noteId: string, agentId: string) {
        return await peers().task.assignAgent(noteId, agentId);
      },
    },
    // Track R, wave 2c — agent.* shims forward to ws.agent.* peers. The
    // 8 existing legacy agent.* handlers (list/get/sendMessage/...) stay
    // handler-owned (UI/IPC behaviour with no `ws.*` analogue). These 7
    // expose the new MCP-only methods. `subscribe`/`unsubscribe` are
    // deprecated aliases for the bridge `events.subscribe`/
    // `events.unsubscribe` surface (per Audit 1 §2 row 14); the bridge
    // remains the canonical surface for WebSocket clients.
    agent: {
      async delegate(opts: Record<string, any>) {
        return await getAgentPeer().delegate(opts);
      },
      async sendToTask(taskNoteId: string, message: string, priority?: any) {
        return await getAgentPeer().sendToTask(taskNoteId, message, priority);
      },
      /** @deprecated Use `events.subscribe` (bridge) for WebSocket clients. */
      async subscribe(eventTypes: string[], opts: Record<string, any> = {}) {
        return await getAgentPeer().subscribe(eventTypes, opts);
      },
      /** @deprecated Use `events.unsubscribe` (bridge) for WebSocket clients. */
      async unsubscribe(subscriptionId: string) {
        return await getAgentPeer().unsubscribe(subscriptionId);
      },
      async wakeOrCreate(taskNoteId: string, contextMessage: string, model?: string) {
        return await getAgentPeer().wakeOrCreate(taskNoteId, contextMessage, model);
      },
      async summary(agentId: string) {
        return await getAgentPeer().summary(agentId);
      },
      async reportToParent(report: string) {
        return await getAgentPeer().reportToParent(report);
      },
    },
    // Track R, wave 2c — git.* shims forward to ws.git.* peers. The
    // existing `git.getBranches` handler stays handler-owned (uses
    // `execAsync` directly; not covered by ws.git.*).
    git: {
      async status() {
        return await getGitPeer().status();
      },
      async stage(paths: string | string[]) {
        return await getGitPeer().stage(paths);
      },
      async commit(message: string) {
        return await getGitPeer().commit(message);
      },
      async agentCommit(message: string, opts: { files?: string[]; userRequested?: boolean } = {}) {
        return await getGitPeer().agentCommit(message, opts);
      },
      async checkMergeConflicts(targetBranch?: string) {
        return await getGitPeer().checkMergeConflicts(targetBranch);
      },
    },
    // Track R, wave 2c — pr.* shims forward to ws.pr.* peers. All 9
    // methods require an active PR; underlying builder throws
    // "No active PR" when `prContext` is undefined.
    pr: {
      async merge(options: Record<string, any> = {}) {
        return await (await getPrPeer()).merge(options);
      },
      async status() {
        return await (await getPrPeer()).status();
      },
      async updateBranch() {
        return await (await getPrPeer()).updateBranch();
      },
      async waitForChanges(options: Record<string, any> = {}) {
        return await (await getPrPeer()).waitForChanges(options);
      },
      async listReviewComments(options: Record<string, any> = {}) {
        return await (await getPrPeer()).listReviewComments(options);
      },
      async replyToReviewComment(commentId: number, body: string) {
        return await (await getPrPeer()).replyToReviewComment(commentId, body);
      },
      async resolveThread(threadId: string, action?: any) {
        return await (await getPrPeer()).resolveThread(threadId, action);
      },
      async listComments(options: Record<string, any> = {}) {
        return await (await getPrPeer()).listComments(options);
      },
      async postComment(body: string) {
        return await (await getPrPeer()).postComment(body);
      },
    },
    // Track R, wave 2d — 1:1 forwarders to ws.script.*, ws.browser.*,
    // ws.terminal.*, ws.file.*, ws.event.*, ws.crossWorkspace.*, and
    // ws.primitive.* peers. Wire shape is preserved byte-for-byte; the
    // underlying builder suites cover behavioural correctness.
    script: {
      async list() {
        return await getScriptPeer().list();
      },
      async create(
        name: string,
        command: string,
        mode: 'service' | 'command',
        options: Record<string, any> = {},
      ) {
        return await getScriptPeer().create(name, command, mode, options);
      },
      async remove(scriptId: string) {
        return await getScriptPeer().remove(scriptId);
      },
      async start(scriptId: string) {
        return await getScriptPeer().start(scriptId);
      },
      async stop(scriptId: string) {
        return await getScriptPeer().stop(scriptId);
      },
      async restart(scriptId: string) {
        return await getScriptPeer().restart(scriptId);
      },
      async output(scriptId: string, maxLines?: number) {
        return await getScriptPeer().output(scriptId, maxLines);
      },
      async status(scriptId: string) {
        return await getScriptPeer().status(scriptId);
      },
      async run(scriptId: string, options: Record<string, any> = {}) {
        return await getScriptPeer().run(scriptId, options);
      },
    },
    browser: {
      async exec(actions: unknown[], tabId?: string) {
        return await getBrowserPeer().exec(actions, tabId);
      },
      async docs(topic: string) {
        return await getBrowserPeer().docs(topic);
      },
    },
    terminal: {
      async list() {
        return await getTerminalPeer().list();
      },
      async readOutput(terminalId: string, maxLines?: number) {
        return await getTerminalPeer().readOutput(terminalId, maxLines);
      },
    },
    file: {
      async read(path: string) {
        return await (await getFilePeer()).read(path);
      },
      async write(path: string, content: string) {
        return await (await getFilePeer()).write(path, content);
      },
      async list(path?: string) {
        return await (await getFilePeer()).list(path);
      },
      async delete(path: string) {
        return await (await getFilePeer()).delete(path);
      },
      async mkdir(path: string) {
        return await (await getFilePeer()).mkdir(path);
      },
      async rename(oldPath: string, newPath: string) {
        return await (await getFilePeer()).rename(oldPath, newPath);
      },
    },
    // `event.subscribe`/`event.unsubscribe` are deprecated aliases — the
    // canonical WebSocket subscription surface is the bridge
    // `events.subscribe` / `events.unsubscribe` handled in
    // `websocket-api-server.ts` (per Audit 1 §2 row 14, same pattern as
    // `agent.subscribe` from wave 2c).
    event: {
      async recentFiles(limit?: number) {
        return await getEventPeer().recentFiles(limit);
      },
      async agentActivity(agentId?: string, minutesAgo?: number) {
        return await getEventPeer().agentActivity(agentId, minutesAgo);
      },
      async workspaceSummary(minutesAgo?: number) {
        return await getEventPeer().workspaceSummary(minutesAgo);
      },
      async directoryChanges(dir: string, limit?: number) {
        return await getEventPeer().directoryChanges(dir, limit);
      },
      async query(options: Record<string, any> = {}) {
        return await getEventPeer().query(options);
      },
      /** @deprecated Use `events.subscribe` (bridge) for WebSocket clients. */
      async subscribe(eventTypes: string[], options: Record<string, any> = {}) {
        return await getEventPeer().subscribe(eventTypes, options);
      },
      /** @deprecated Use `events.unsubscribe` (bridge) for WebSocket clients. */
      async unsubscribe(subscriptionId: string) {
        return await getEventPeer().unsubscribe(subscriptionId);
      },
    },
    crossWorkspace: {
      async listSiblings() {
        return await getCrossWorkspacePeer().listSiblings();
      },
      async readNote(targetWorkspaceId: string, noteId: string) {
        return await getCrossWorkspacePeer().readNote(targetWorkspaceId, noteId);
      },
      async listNotes(targetWorkspaceId: string) {
        return await getCrossWorkspacePeer().listNotes(targetWorkspaceId);
      },
    },
    // `primitive.*` lives inside buildNoteApi() peers (same lazy getter
    // as note/comment/task) — no separate builder needed.
    primitive: {
      async addReference(noteId: string, semanticId: string, description: string, snapshot?: string) {
        return await peers().primitive.addReference(noteId, semanticId, description, snapshot);
      },
      async addCli(noteId: string, command: string, description: string, workingDirectory?: string) {
        return await peers().primitive.addCli(noteId, command, description, workingDirectory);
      },
      async addPatch(noteId: string, filePath: string, diff: string, description: string) {
        return await peers().primitive.addPatch(noteId, filePath, diff, description);
      },
      async addAgentAction(noteId: string, agentId: string, goal: string, description: string) {
        return await peers().primitive.addAgentAction(noteId, agentId, goal, description);
      },
    },
  };
}

// ============================================================================
// Method Routing
// ============================================================================

type MethodHandler = (
  params: Record<string, any>,
  context: { workspaceId?: string },
) => Promise<any>;

function buildMethodMap(): Record<string, MethodHandler> {
  return {
    // Workspace methods — Track R, wave 2a shims over buildWsApi()
    'workspace.list': async (params) => {
      const ws = buildWsApi('');
      const workspaces = await ws.workspace.list({ includeArchived: params?.includeArchived ?? false });
      return { workspaces };
    },

    'workspace.get': async (params) => {
      requireParam(params, 'workspaceId');
      const ws = buildWsApi(params.workspaceId);
      const data = await ws.workspace.get(params.workspaceId);
      if (!data) throw new ProtocolError(INVALID_PARAMS, 'Workspace not found');
      return { workspace: data };
    },

    'workspace.create': async (params) => {
      const ws = buildWsApi('');
      const workspace = await ws.workspace.create(params);

      // Activate initial agent in background (fire-and-forget).
      // Handler-owned per Audit 1 §4 rec point 5 — no ws.* analogue exists.
      // The workspace is returned immediately; agent activation happens async.
      if (params.initialAgent?.prompt && params.initialAgent?.agentId) {
        void (async () => {
          try {
            const workspaceData = workspace;
            const wsId = workspaceData.id;
            const workspacePath =
              workspaceData.worktreePath ||
              workspaceData.repositoryPath ||
              workspaceData.path ||
              '';

            // Resolve specialist config if specified
            let behaviorPrompt: string | undefined;
            let specialistName: string | undefined;
            let roleReminder: string | undefined;
            let agentType: string | undefined;
            let model = params.initialAgent.model;

            if (params.initialAgent.specialist) {
              const { resolveSpecialistForAgent } = await import(
                '../features/agent/main/specialists.service'
              );
              const specialistConfig = resolveSpecialistForAgent(
                params.initialAgent.specialist,
                params.initialAgent.provider,
              );
              if (specialistConfig) {
                behaviorPrompt = params.initialAgent.behaviorPrompt || specialistConfig.behaviorPrompt;
                specialistName = specialistConfig.specialistName;
                roleReminder = specialistConfig.roleReminder;
                agentType = specialistConfig.defaultAgentType;
                if (!model && specialistConfig.model) {
                  model = specialistConfig.model;
                }
              }
            }

            // Use passed behaviorPrompt if no specialist or specialist didn't provide one
            if (!behaviorPrompt && params.initialAgent.behaviorPrompt) {
              behaviorPrompt = params.initialAgent.behaviorPrompt;
            }

            const agentName = params.initialAgent.name || 'Coordinator';

            const handler = AgentBackendHandler.getInstance();
            const agent = await handler.createAgent(wsId, agentName, {
              workspacePath,
              model,
              behaviorPrompt,
              specialistName,
              roleReminder,
              agentType: agentType || params.initialAgent.agentType || 'workspace',
              metadata: {
                ...params.initialAgent.metadata,
                isInitialAgent: true,
                isFirstWorkspaceAgent: true,
                specialist: params.initialAgent.specialist,
                provider: params.initialAgent.provider,
                initialMessage: params.initialAgent.prompt,
              },
            }, params.initialAgent.agentId);

            if (!agent) {
              logger.error('Failed to create initial agent after workspace creation', {
                workspaceId: wsId,
                agentId: params.initialAgent.agentId,
              });
              return;
            }

            logger.info('Initial agent created, sending initial message', {
              workspaceId: wsId,
              agentId: agent.id,
              agentName,
            });

            // Send the initial message to start the agent working
            await handler.sendMessage(null as any, {
              sessionId: agent.id,
              message: params.initialAgent.prompt,
              workspaceId: wsId,
              imageBlocks: params.initialAgent.imageBlocks,
            });

            logger.info('Initial agent activated successfully', {
              workspaceId: wsId,
              agentId: agent.id,
            });
          } catch (error) {
            logger.error('Failed to activate initial agent after workspace creation', {
              error: (error as Error).message,
              stack: (error as Error).stack,
              workspaceId: workspace?.id,
              agentId: params.initialAgent?.agentId,
            });
          }
        })();
      }

      return { workspace };
    },

    'workspace.update': async (params) => {
      requireParam(params, 'workspaceId');
      const { workspaceId, ...rest } = params;
      const ws = buildWsApi(workspaceId);
      const workspace = await ws.workspace.update(workspaceId, rest);
      return { workspace };
    },

    'workspace.delete': async (params) => {
      requireParam(params, 'workspaceId');
      const ws = buildWsApi(params.workspaceId);
      await ws.workspace.delete(params.workspaceId);
      return { success: true };
    },

    'workspace.archive': async (params) => {
      requireParam(params, 'workspaceId');
      const ws = buildWsApi(params.workspaceId);
      await ws.workspace.archive(params.workspaceId);
      return { success: true };
    },

    'workspace.unarchive': async (params) => {
      requireParam(params, 'workspaceId');
      const ws = buildWsApi(params.workspaceId);
      await ws.workspace.unarchive(params.workspaceId);
      return { success: true };
    },

    // Note methods — Track R, wave 2a shims over buildWsApi()
    'note.list': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      const ws = buildWsApi(workspaceId);
      const notes = await ws.note.list();
      return { notes };
    },

    'note.get': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'noteId');
      const ws = buildWsApi(workspaceId);
      const note = await ws.note.get(params.noteId);
      if (!note) throw new ProtocolError(INVALID_PARAMS, 'Note not found');
      return { note };
    },

    'note.create': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'title');
      const ws = buildWsApi(workspaceId);
      const note = await ws.note.create({
        title: params.title,
        content: params.content,
        tags: params.tags,
        parentId: params.parentId,
      });
      return { note };
    },

    'note.update': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'noteId');
      const ws = buildWsApi(workspaceId);

      // Route per ws.note.* surface:
      //   content present → ws.note.setContent
      //   otherwise       → ws.note.updateMetadata
      let note: any;
      if (params.content !== undefined) {
        note = await ws.note.setContent(params.noteId, params.content);
      } else {
        const updates: { title?: string; tags?: string[] } = {};
        if (params.title !== undefined) updates.title = params.title;
        if (params.tags !== undefined) updates.tags = params.tags;
        note = await ws.note.updateMetadata(params.noteId, updates);
      }

      if (note && typeof note === 'object' && 'ok' in note && !note.ok) {
        throw new ProtocolError(INTERNAL_ERROR, (note as any).error);
      }
      return { note };
    },

    // ========================================================================
    // Track R, wave 2b — note.* + task.* + comment.* adapter shims
    //
    // 1:1 forwarders to the ws.note.*, ws.task.*, ws.comment.* peers
    // exposed by buildNoteApi(). Wire shape (method names, params,
    // response bodies, error codes) is preserved byte-for-byte against
    // the corresponding MCP builder output. Behaviour is covered by the
    // ws-note-api / ws-task-api / ws-comment-api suites; the tests in
    // this file are shape-only.
    // ========================================================================

    'note.add': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'noteId');
      requireParam(params, 'content');
      const ws = buildWsApi(workspaceId);
      return await ws.note.add(params.noteId, {
        content: params.content,
        heading: params.heading,
        position: params.position,
      });
    },

    'note.edit': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'noteId');
      requireParam(params, 'old');
      requireParam(params, 'new');
      const ws = buildWsApi(workspaceId);
      return await ws.note.edit(params.noteId, { old: params.old, new: params.new });
    },

    'note.editLines': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'noteId');
      requireParam(params, 'start');
      requireParam(params, 'end');
      requireParam(params, 'content');
      const ws = buildWsApi(workspaceId);
      return await ws.note.editLines(params.noteId, {
        start: params.start,
        end: params.end,
        content: params.content,
      });
    },

    'note.setContent': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'noteId');
      requireParam(params, 'content');
      const ws = buildWsApi(workspaceId);
      return await ws.note.setContentPeer(
        params.noteId,
        params.content,
        params.confirmReplacement,
      );
    },

    'note.updateMetadata': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'noteId');
      const ws = buildWsApi(workspaceId);
      const updates: { title?: string; tags?: string | string[] } = {};
      if (params.title !== undefined) updates.title = params.title;
      if (params.tags !== undefined) updates.tags = params.tags;
      return await ws.note.updateMetadataPeer(params.noteId, updates);
    },

    'note.delete': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'noteId');
      const ws = buildWsApi(workspaceId);
      return await ws.note.delete(params.noteId);
    },

    'note.listTasks': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'noteId');
      const ws = buildWsApi(workspaceId);
      return await ws.note.listTasks(params.noteId);
    },

    'note.readAsset': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'asset');
      const ws = buildWsApi(workspaceId);
      return await ws.note.readAsset(params.asset);
    },

    'comment.add': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'noteId');
      requireParam(params, 'searchContext');
      requireParam(params, 'commentTarget');
      requireParam(params, 'comment');
      const ws = buildWsApi(workspaceId);
      return await ws.comment.add(params.noteId, {
        searchContext: params.searchContext,
        commentTarget: params.commentTarget,
        comment: params.comment,
        type: params.type,
        author: params.author,
      });
    },

    'comment.list': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'noteId');
      const ws = buildWsApi(workspaceId);
      return await ws.comment.list(params.noteId, {
        since: params.since,
        authorType: params.authorType,
        status: params.status,
        includeComments: params.includeComments,
      });
    },

    'comment.getThread': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'noteId');
      const ws = buildWsApi(workspaceId);
      return await ws.comment.getThread(params.noteId, {
        threadId: params.threadId,
        commentId: params.commentId,
      });
    },

    'comment.respond': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'noteId');
      requireParam(params, 'comment');
      const ws = buildWsApi(workspaceId);
      return await ws.comment.respond(params.noteId, {
        threadId: params.threadId,
        commentId: params.commentId,
        comment: params.comment,
        type: params.type,
        author: params.author,
        suggestionOriginal: params.suggestionOriginal,
        suggestionProposed: params.suggestionProposed,
      });
    },

    'comment.delete': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'noteId');
      requireParam(params, 'commentId');
      const ws = buildWsApi(workspaceId);
      return await ws.comment.delete(params.noteId, params.commentId);
    },

    'task.updateStatus': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'noteId');
      requireParam(params, 'taskText');
      requireParam(params, 'status');
      const ws = buildWsApi(workspaceId);
      return await ws.task.updateStatus(params.noteId, params.taskText, params.status);
    },

    'task.updateNoteStatus': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'noteId');
      requireParam(params, 'status');
      const ws = buildWsApi(workspaceId);
      return await ws.task.updateNoteStatus(params.noteId, params.status);
    },

    'task.update': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'noteId');
      requireParam(params, 'line');
      const ws = buildWsApi(workspaceId);
      return await ws.task.update(params.noteId, params.line, {
        text: params.text,
        status: params.status,
        expected: params.expected,
      });
    },

    'task.getMyTask': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'taskNoteId');
      const ws = buildWsApi(workspaceId);
      return await ws.task.getMyTask(params.taskNoteId);
    },

    'task.markAsTask': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'noteId');
      requireParam(params, 'status');
      const ws = buildWsApi(workspaceId);
      return await ws.task.markAsTask(params.noteId, params.status, {
        acceptanceCriteria: params.acceptanceCriteria,
        effort: params.effort,
      });
    },

    'task.convertBlocks': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'noteId');
      const ws = buildWsApi(workspaceId);
      return await ws.task.convertBlocks(params.noteId);
    },

    'task.createPrerequisite': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'dependentNoteId');
      requireParam(params, 'title');
      const ws = buildWsApi(workspaceId);
      return await ws.task.createPrerequisite(params.dependentNoteId, params.title, {
        content: params.content,
        status: params.status,
      });
    },

    'task.assignAgent': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'noteId');
      requireParam(params, 'agentId');
      const ws = buildWsApi(workspaceId);
      return await ws.task.assignAgent(params.noteId, params.agentId);
    },

    // ========================================================================
    // Track R, wave 2c — agent.* (new) + git.* + pr.* adapter shims
    //
    // 21 new JSON-RPC methods that 1:1 forward to ws.agent.*, ws.git.*, and
    // ws.pr.* peers. Wire shape (method names, params, response bodies,
    // error codes) is preserved byte-for-byte against the corresponding
    // MCP builder output. Behaviour is covered by the ws-agent-api /
    // ws-git-api suites (ws-pr-api behaviour coverage is deferred to a
    // separate test-coverage wave); the tests in this file are shape-only.
    //
    // `agent.subscribe` / `agent.unsubscribe` are exposed as deprecated
    // aliases — the canonical WebSocket subscription surface is the
    // bridge `events.subscribe` / `events.unsubscribe` handled in
    // `websocket-api-server.ts` (per Audit 1 §2 row 14).
    // ========================================================================

    'agent.delegate': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      const ws = buildWsApi(workspaceId);
      const { workspaceId: _ws, ...opts } = params;
      return await ws.agent.delegate(opts);
    },

    'agent.sendToTask': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'taskNoteId');
      requireParam(params, 'message');
      const ws = buildWsApi(workspaceId);
      return await ws.agent.sendToTask(params.taskNoteId, params.message, params.priority);
    },

    'agent.subscribe': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'eventTypes');
      if (!Array.isArray(params.eventTypes)) {
        throw new ProtocolError(INVALID_PARAMS, 'eventTypes must be an array');
      }
      const ws = buildWsApi(workspaceId);
      return await ws.agent.subscribe(params.eventTypes, {
        excludeSelf: params.excludeSelf,
        batchWindow: params.batchWindow,
      });
    },

    'agent.unsubscribe': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'subscriptionId');
      const ws = buildWsApi(workspaceId);
      return await ws.agent.unsubscribe(params.subscriptionId);
    },

    'agent.wakeOrCreate': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'taskNoteId');
      requireParam(params, 'contextMessage');
      const ws = buildWsApi(workspaceId);
      return await ws.agent.wakeOrCreate(params.taskNoteId, params.contextMessage, params.model);
    },

    'agent.summary': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'agentId');
      const ws = buildWsApi(workspaceId);
      return await ws.agent.summary(params.agentId);
    },

    'agent.reportToParent': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'report');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.agent.reportToParent(params.report);
      } catch (error) {
        // Underlying tool rejects when caller is not a delegated agent.
        // Surface as INTERNAL_ERROR with the original message so external
        // clients can distinguish "not a delegated agent" from validation.
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'git.status': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.git.status();
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'git.stage': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'paths');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.git.stage(params.paths);
      } catch (error) {
        // Underlying builder rejects `.`/`*`/`--all` per workspace policy.
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'git.commit': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'message');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.git.commit(params.message);
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'git.agentCommit': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'message');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.git.agentCommit(params.message, {
          files: params.files,
          userRequested: params.userRequested,
        });
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'git.checkMergeConflicts': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.git.checkMergeConflicts(params.targetBranch);
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'pr.merge': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.pr.merge({
          mergeMethod: params.mergeMethod,
          commitTitle: params.commitTitle,
          commitMessage: params.commitMessage,
        });
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'pr.status': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.pr.status();
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'pr.updateBranch': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.pr.updateBranch();
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'pr.waitForChanges': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.pr.waitForChanges({
          timeoutSeconds: params.timeoutSeconds,
          pollIntervalSeconds: params.pollIntervalSeconds,
          watch: params.watch,
        });
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'pr.listReviewComments': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.pr.listReviewComments({
          path: params.path,
          status: params.status,
        });
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'pr.replyToReviewComment': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'commentId');
      requireParam(params, 'body');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.pr.replyToReviewComment(params.commentId, params.body);
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'pr.resolveThread': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'threadId');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.pr.resolveThread(params.threadId, params.action);
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'pr.listComments': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.pr.listComments({ count: params.count });
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'pr.postComment': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'body');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.pr.postComment(params.body);
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    // ========================================================================
    // Track R, wave 2d — script.*, browser.*, terminal.*, file.*, event.*,
    // crossWorkspace.*, primitive.* shims. 1:1 forwarders to the matching
    // ws.* peers. Wire shape (method names, params, response bodies,
    // error codes) is preserved byte-for-byte against the corresponding
    // MCP builder output. Behaviour is covered by the ws-script-api /
    // ws-event-api / ws-misc-api / ws-note-api suites; the tests in this
    // file are shape-only.
    //
    // `event.subscribe` / `event.unsubscribe` are exposed as deprecated
    // aliases — the canonical WebSocket subscription surface is the
    // bridge `events.subscribe` / `events.unsubscribe` handled in
    // `websocket-api-server.ts` (same alias pattern as `agent.subscribe`
    // from wave 2c).
    // ========================================================================

    'script.list': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      const ws = buildWsApi(workspaceId);
      return await ws.script.list();
    },

    'script.create': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'name');
      requireParam(params, 'command');
      requireParam(params, 'mode');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.script.create(params.name, params.command, params.mode, {
          cwd: params.cwd,
          env: params.env,
          category: params.category,
          autoStart: params.autoStart,
          scriptId: params.scriptId,
        });
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'script.remove': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'scriptId');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.script.remove(params.scriptId);
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'script.start': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'scriptId');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.script.start(params.scriptId);
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'script.stop': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'scriptId');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.script.stop(params.scriptId);
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'script.restart': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'scriptId');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.script.restart(params.scriptId);
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'script.output': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'scriptId');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.script.output(params.scriptId, params.maxLines);
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'script.status': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'scriptId');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.script.status(params.scriptId);
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'script.run': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'scriptId');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.script.run(params.scriptId, {
          maxLines: params.maxLines,
          timeout: params.timeout,
          timeoutSeconds: params.timeoutSeconds,
        });
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'browser.exec': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'actions');
      if (!Array.isArray(params.actions)) {
        throw new ProtocolError(INVALID_PARAMS, 'actions must be an array');
      }
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.browser.exec(params.actions, params.tabId);
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'browser.docs': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'topic');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.browser.docs(params.topic);
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'terminal.list': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      const ws = buildWsApi(workspaceId);
      return await ws.terminal.list();
    },

    'terminal.readOutput': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'terminalId');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.terminal.readOutput(params.terminalId, params.maxLines);
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'file.read': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'path');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.file.read(params.path);
      } catch (error) {
        // Underlying builder rejects paths outside the workspace.
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'file.write': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'path');
      requireParam(params, 'content');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.file.write(params.path, params.content);
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'file.list': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.file.list(params.path);
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'file.delete': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'path');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.file.delete(params.path);
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'file.mkdir': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'path');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.file.mkdir(params.path);
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'file.rename': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'oldPath');
      requireParam(params, 'newPath');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.file.rename(params.oldPath, params.newPath);
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'event.recentFiles': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      const ws = buildWsApi(workspaceId);
      return await ws.event.recentFiles(params.limit);
    },

    'event.agentActivity': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      const ws = buildWsApi(workspaceId);
      return await ws.event.agentActivity(params.agentId, params.minutesAgo);
    },

    'event.workspaceSummary': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      const ws = buildWsApi(workspaceId);
      return await ws.event.workspaceSummary(params.minutesAgo);
    },

    'event.directoryChanges': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'dir');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.event.directoryChanges(params.dir, params.limit);
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'event.query': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      const ws = buildWsApi(workspaceId);
      const { workspaceId: _ws, ...opts } = params;
      return await ws.event.query(opts);
    },

    'event.subscribe': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'eventTypes');
      if (!Array.isArray(params.eventTypes)) {
        throw new ProtocolError(INVALID_PARAMS, 'eventTypes must be an array');
      }
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.event.subscribe(params.eventTypes, {
          excludeSelf: params.excludeSelf,
          batchWindow: params.batchWindow,
        });
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'event.unsubscribe': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'subscriptionId');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.event.unsubscribe(params.subscriptionId);
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'crossWorkspace.listSiblings': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.crossWorkspace.listSiblings();
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'crossWorkspace.readNote': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'targetWorkspaceId');
      requireParam(params, 'noteId');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.crossWorkspace.readNote(params.targetWorkspaceId, params.noteId);
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'crossWorkspace.listNotes': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'targetWorkspaceId');
      const ws = buildWsApi(workspaceId);
      try {
        return await ws.crossWorkspace.listNotes(params.targetWorkspaceId);
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'primitive.addReference': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'noteId');
      requireParam(params, 'semanticId');
      requireParam(params, 'description');
      const ws = buildWsApi(workspaceId);
      return await ws.primitive.addReference(
        params.noteId,
        params.semanticId,
        params.description,
        params.snapshot,
      );
    },

    'primitive.addCli': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'noteId');
      requireParam(params, 'command');
      requireParam(params, 'description');
      const ws = buildWsApi(workspaceId);
      return await ws.primitive.addCli(
        params.noteId,
        params.command,
        params.description,
        params.workingDirectory,
      );
    },

    'primitive.addPatch': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'noteId');
      requireParam(params, 'filePath');
      requireParam(params, 'diff');
      requireParam(params, 'description');
      const ws = buildWsApi(workspaceId);
      return await ws.primitive.addPatch(
        params.noteId,
        params.filePath,
        params.diff,
        params.description,
      );
    },

    'primitive.addAgentAction': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      requireParam(params, 'noteId');
      requireParam(params, 'agentId');
      requireParam(params, 'goal');
      requireParam(params, 'description');
      const ws = buildWsApi(workspaceId);
      return await ws.primitive.addAgentAction(
        params.noteId,
        params.agentId,
        params.goal,
        params.description,
      );
    },

    // Agent methods — route through AgentBackendHandler singleton
    'agent.list': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      try {
        const handler = AgentBackendHandler.getInstance();
        const agents = await handler.listAllAgents(workspaceId);
        // Strip messages and systemPrompt to reduce payload size — clients use agent.getConversation for full messages
        // Compute lastAgentResponse and digest from messages before stripping them
        const lightAgents = agents.map(({ messages, systemPrompt: _systemPrompt, ...rest }: any) => {
          let lastAgentResponse = rest.lastAgentResponse;
          let digest = rest.digest;

          // If lastAgentResponse isn't already set, compute it from messages
          if (!lastAgentResponse && Array.isArray(messages) && messages.length > 0) {
            for (let i = messages.length - 1; i >= 0; i--) {
              const msg = messages[i];
              if (msg.role === 'assistant') {
                const contentBlocks = msg.contentBlocks || [];

                // Check ALL text blocks, keeping the last meaningful one
                for (const block of contentBlocks) {
                  if (block.type === 'text' && block.text) {
                    const text = block.text.trim();
                    if (text) {
                      // Extract digest from any block
                      const digestMatch = text.match(/<agent_digest>([\s\S]*?)<\/agent_digest>/);
                      if (digestMatch && !digest) {
                        digest = digestMatch[1].trim();
                      }
                      let cleaned = text.replace(/<!--\s*suggested-prompts[\s\S]*?-->/g, '').trim();
                      cleaned = cleaned.replace(/<agent_digest>[\s\S]*?<\/agent_digest>/g, '').trim();
                      // Strip group tags
                      cleaned = cleaned.replace(/<group:[^>\n<]+>/g, '').trim();
                      cleaned = cleaned.replace(/<\/group(?::[^>\n<]+)?>/g, '').trim();
                      if (cleaned) {
                        const lines = cleaned.split('\n').filter((l: string) => l.trim());
                        lastAgentResponse = lines[lines.length - 1]?.trim() || cleaned.substring(0, 200);
                      }
                    }
                    // NO break here — continue to next block to find last meaningful text
                  }
                }
                break; // Still break after last assistant message
              }
            }
          }

          return {
            ...rest,
            messageCount: Array.isArray(messages) ? messages.length : 0,
            lastAgentResponse: lastAgentResponse || undefined,
            digest: digest || undefined,
          };
        });
        return { agents: lightAgents };
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'agent.get': async (params, context) => {
      requireParam(params, 'agentId');
      try {
        const handler = AgentBackendHandler.getInstance();
        let agent = await handler.getAgent(params.agentId);

        if (!agent) {
          // Agent not in memory — try loading from disk persistence
          const workspaceId = params.workspaceId || context.workspaceId;
          if (workspaceId) {
            const agents = await handler.listAllAgents(workspaceId);
            agent = agents.find((a: any) => String(a.id) === String(params.agentId)) || null;
          }
        }

        if (!agent) throw new ProtocolError(INVALID_PARAMS, 'Agent not found');

        // Compute lastAgentResponse and digest from messages (same as agent.list)
        const { messages, systemPrompt: _systemPrompt, ...rest } = agent as any;
        let lastAgentResponse = rest.lastAgentResponse;
        let digest = rest.digest;

        if (!lastAgentResponse && Array.isArray(messages) && messages.length > 0) {
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.role === 'assistant') {
              const contentBlocks = msg.contentBlocks || [];
              for (const block of contentBlocks) {
                if (block.type === 'text' && block.text) {
                  const text = block.text.trim();
                  if (text) {
                    const digestMatch = text.match(/<agent_digest>([\s\S]*?)<\/agent_digest>/);
                    if (digestMatch && !digest) {
                      digest = digestMatch[1].trim();
                    }
                    let cleaned = text.replace(/<!--\s*suggested-prompts[\s\S]*?-->/g, '').trim();
                    cleaned = cleaned.replace(/<agent_digest>[\s\S]*?<\/agent_digest>/g, '').trim();
                    cleaned = cleaned.replace(/<group:[^>\n<]+>/g, '').trim();
                    cleaned = cleaned.replace(/<\/group(?::[^>\n<]+)?>/g, '').trim();
                    if (cleaned) {
                      const lines = cleaned.split('\n').filter((l: string) => l.trim());
                      lastAgentResponse =
                        lines[lines.length - 1]?.trim() || cleaned.substring(0, 200);
                    }
                  }
                }
              }
              break;
            }
          }
        }

        return {
          agent: {
            ...rest,
            messageCount: Array.isArray(messages) ? messages.length : 0,
            lastAgentResponse: lastAgentResponse || undefined,
            digest: digest || undefined,
          },
        };
      } catch (error) {
        if (error instanceof ProtocolError) throw error;
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'agent.getConversation': async (params, context) => {
      requireParam(params, 'agentId');
      try {
        const handler = AgentBackendHandler.getInstance();
        let agent = await handler.getAgent(params.agentId);

        if (!agent) {
          // Agent not in memory — try loading from disk persistence
          const workspaceId = params.workspaceId || context.workspaceId;
          if (workspaceId) {
            const agents = await handler.listAllAgents(workspaceId);
            agent = agents.find((a: any) => String(a.id) === String(params.agentId)) || null;
          }
        }

        if (!agent) throw new ProtocolError(INVALID_PARAMS, 'Agent not found');

        let messages = (agent as any).messages || [];

        // If messages are empty, fall back to disk persistence
        if (messages.length === 0) {
          const workspaceId = params.workspaceId || context.workspaceId;
          if (workspaceId) {
            try {
              const { agentPersistence } = await import('../features/agent/main/agent-persistence');
              const { WorkspaceConfig } = await import('../shared/main/config');
              const workspacePath = WorkspaceConfig.paths.workspace(workspaceId);
              const result = await agentPersistence.loadAgent(
                params.agentId as any,
                workspaceId as any,
                workspacePath,
              );
              if (result.success && result.data?.messages?.length) {
                messages = result.data.messages;
                logger.info('Loaded messages from disk persistence', {
                  agentId: params.agentId,
                  count: messages.length,
                });
              }
            } catch (err) {
              logger.warn('Failed to load messages from disk persistence', {
                agentId: params.agentId,
                error: err,
              });
            }
          }
        }

        // Apply message cap for WebSocket API responses
        const limit = typeof params.limit === 'number' ? params.limit : LIMITS.MAX_WEBSOCKET_CONVERSATION_MESSAGES;
        const totalMessages = messages.length;
        const truncated = messages.length > limit;
        if (truncated) {
          messages = messages.slice(-limit);
        }

        return { agentId: params.agentId, messages, truncated, totalMessages };
      } catch (error) {
        if (error instanceof ProtocolError) throw error;
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'agent.sendMessage': async (params, context) => {
      requireParam(params, 'agentId');
      requireParam(params, 'content');
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      const messageId = params.messageId || `user-msg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
      try {
        const handler = AgentBackendHandler.getInstance();

        // If the agent is currently streaming, queue the message instead of interrupting.
        // handler.sendMessage() calls handleBackendStreamMessage which interrupts the active
        // stream and returns { success: true }, so the fallback-to-queue code never runs.
        // By checking upfront, we avoid the interruption entirely.
        if (handler.getActiveStreams().some(s => s.agentId === params.agentId)) {
          // `agent:user-message:sent` is emitted by handleQueueMessage (canonical queued-path
          // site). Do NOT emit here — see Audit 4 / Track F Bundle 3 (single-emit invariant).
          const queueResult = await handler.handleQueueMessage(null, {
            agentId: params.agentId,
            content: params.content,
            workspaceId,
            imageBlocks: params.imageBlocks,
          });
          return { success: queueResult.success, queued: true, queuedMessage: queueResult.queuedMessage };
        }

        // Use sendMessage (which calls handleBackendStreamMessage directly) — same path
        // as Electron IPC. sendBackendInitiatedMessage has guards (streamStartTimes,
        // pendingQueueProcessing, pendingBackendDeliveries) designed for system-triggered
        // messages that incorrectly reject user messages from WebSocket/iOS clients.
        // `agent:user-message:sent` is emitted by handleSendMessage (canonical site).
        // Do NOT emit here — see Audit 4 / Track F Bundle 3 (single-emit invariant).
        // Pass messageId as queuedMessageId so handleBackendStreamMessage uses it
        // for the user message ID instead of generating a new one. This ensures
        // cross-client deduplication works (the event emitted above and the
        // persisted message share the same ID).
        const result = await handler.sendMessage(null as any, {
          sessionId: params.agentId,
          message: params.content,
          workspaceId,
          imageBlocks: params.imageBlocks,
          queuedMessageId: messageId,
        });
        if (result.success) {
          return { success: true, queued: false, messageId };
        }
        // If send failed (agent is actually streaming), auto-queue the message.
        // Pass workspaceId so handleQueueMessage can emit the canonical
        // `agent:user-message:sent` workspace event for cross-client sync.
        const queueResult = await handler.handleQueueMessage(null, {
          agentId: params.agentId,
          content: params.content,
          workspaceId,
          imageBlocks: params.imageBlocks,
        });
        return { success: queueResult.success, queued: true, queuedMessage: queueResult.queuedMessage };
      } catch {
        // Also try queuing on exception (e.g., streaming guard throws)
        try {
          const handler = AgentBackendHandler.getInstance();
          const queueResult = await handler.handleQueueMessage(null, {
            agentId: params.agentId,
            content: params.content,
            workspaceId,
            imageBlocks: params.imageBlocks,
          });
          return { success: queueResult.success, queued: true, queuedMessage: queueResult.queuedMessage };
        } catch (queueError) {
          throw new ProtocolError(INTERNAL_ERROR, (queueError as Error).message);
        }
      }
    },

    'agent.queueMessage': async (params) => {
      requireParam(params, 'agentId');
      requireParam(params, 'content');
      try {
        const handler = AgentBackendHandler.getInstance();
        return await handler.handleQueueMessage(null, {
          agentId: params.agentId,
          content: params.content,
          imageBlocks: params.imageBlocks,
        });
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'agent.editQueuedMessage': async (params) => {
      requireParam(params, 'agentId');
      requireParam(params, 'messageId');
      requireParam(params, 'content');
      try {
        const handler = AgentBackendHandler.getInstance();
        return await handler.handleEditQueuedMessage(null, {
          agentId: params.agentId,
          messageId: params.messageId,
          content: params.content,
        });
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'agent.removeQueuedMessage': async (params) => {
      requireParam(params, 'agentId');
      requireParam(params, 'messageId');
      try {
        const handler = AgentBackendHandler.getInstance();
        return await handler.handleRemoveQueuedMessage(null, {
          agentId: params.agentId,
          messageId: params.messageId,
        });
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'agent.getQueue': async (params) => {
      requireParam(params, 'agentId');
      try {
        const handler = AgentBackendHandler.getInstance();
        return await handler.handleGetQueue(null, {
          agentId: params.agentId,
        });
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'agent.stop': async (params) => {
      requireParam(params, 'agentId');
      try {
        const handler = AgentBackendHandler.getInstance();
        await handler.stopAgent(params.agentId, 'websocket_api');
        return { success: true };
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'agent.forceMessage': async (params, context) => {
      requireParam(params, 'agentId');
      requireParam(params, 'messageId');
      requireParam(params, 'content');
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      try {
        const handler = AgentBackendHandler.getInstance();
        // Stop the current stream first, then send the new message
        await handler.stopAgent(params.agentId, 'force_message');
        const result = await handler.sendMessage(null as any, {
          sessionId: params.agentId,
          message: params.content,
          workspaceId,
          imageBlocks: params.imageBlocks,
          noteIds: params.noteIds,
          queuedMessageId: params.messageId,
        });
        // `agent:user-message:sent` is emitted by handleSendMessage (canonical site)
        // only when the send succeeds — see Audit 4 / Track F Bundle 3.
        return result;
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'agent.getModels': async () => {
      try {
        // Dynamically fetch models from auggie CLI (same as Electron app's auggie:get-models handler)
        const [{ executeAuggieCommand }, { parseModelListOutput }] = await Promise.all([
          import('../features/auggie/main/execute-auggie-command'),
          import('../features/auggie/main/auggie.ipc'),
        ]);

        try {
          const { stdout, stderr } = await executeAuggieCommand('model list');
          if (stderr) {
            logger.warn('Auggie model list stderr output', { stderr });
          }

          let models = parseModelListOutput(stdout);

          // If command succeeded but produced no output, try parsing stderr too
          if (models.length === 0 && stderr) {
            models = parseModelListOutput(stderr);
          }

          if (models.length > 0) {
            return {
              models: models.map((m: { value: string; label: string; description?: string }) => ({
                id: m.value,
                name: m.label,
                provider: 'auggie',
                description: m.description,
              })),
            };
          }
        } catch (cliError) {
          // CLI may fail but still produce valid stdout — try parsing from error
          const errorWithOutput = cliError as Error & { stdout?: string; stderr?: string };
          const outputToParse = errorWithOutput.stdout || errorWithOutput.stderr || '';
          if (outputToParse) {
            const models = parseModelListOutput(outputToParse);
            if (models.length > 0) {
              return {
                models: models.map(
                  (m: { value: string; label: string; description?: string }) => ({
                    id: m.value,
                    name: m.label,
                    provider: 'auggie',
                    description: m.description,
                  }),
                ),
              };
            }
          }
          logger.warn('Auggie CLI model list failed, falling back to static tiers', {
            error: (cliError as Error).message,
          });
        }

        // Fallback to static tier mappings if dynamic fetch fails
        const staticModels: Array<{ id: string; name: string; provider: string }> = [];
        const seen = new Set<string>();
        for (const [providerId, tiers] of Object.entries(PROVIDER_MODEL_TIERS)) {
          for (const [tier, modelId] of Object.entries(tiers)) {
            const key = `${providerId}:${modelId}`;
            if (!seen.has(key)) {
              seen.add(key);
              staticModels.push({
                id: modelId,
                name: `${modelId} (${tier})`,
                provider: providerId,
              });
            }
          }
        }
        return { models: staticModels };
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'agent.setModel': async (params, context) => {
      requireParam(params, 'agentId');
      requireParam(params, 'modelId');
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      try {
        const handler = AgentBackendHandler.getInstance();
        return await handler.handleSetModel(null, {
          agentId: params.agentId,
          modelId: params.modelId,
          workspaceId,
        });
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'agent.getSubscriptions': async (params, context) => {
      requireParam(params, 'agentId');
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      try {
        const { getMainState } = await import('../store/main/redux-store-bridge');
        const { selectAgentSubscriptions, selectDelegationGroupsForParent, selectWorkspaceSubscriptionState } = await import(
          '../store/main/slices/agent-subscriptions/agent-subscriptions-selectors'
        );
        const state = getMainState();
        const subscriptions = selectAgentSubscriptions.select(state, workspaceId, params.agentId);
        const delegationGroups = selectDelegationGroupsForParent.select(state, workspaceId, params.agentId);
        const wsState = selectWorkspaceSubscriptionState.select(state, workspaceId);

        // Additive shape per Audit 4 / Track F Bundle 3 task 2:
        //   - `subscriptions[*].description`: derived human-readable summary of the filter.
        //   - `subscriptions[*].eventTypes` / `actorTypes` / `actorIds` / `excludeActorIds` /
        //     `dataMatchers` / `since` / `priority` / `batchWindow` / `batchMaxEvents` /
        //     `delegationGroup` / `oneShot`: flattened from `filter.*` for easier client
        //     consumption.
        //   - `agentStatuses`: live `{ [agentId]: AgentStatus }` map for the workspace.
        //
        // @deprecated The legacy nested `subscriptions[*].filter` object is preserved for
        // wire compatibility and will be removed once external clients have migrated to
        // the flattened fields. Target removal: next breaking-shape wave (see Audit 4 §4).
        const enrichedSubscriptions = subscriptions.map((sub) => ({
          ...sub,
          description: describeAgentSubscription(sub),
          eventTypes: sub.filter.eventTypes,
          actorTypes: sub.filter.actorTypes,
          actorIds: sub.filter.actorIds,
          excludeActorIds: sub.filter.excludeActorIds,
          dataMatchers: sub.filter.dataMatchers,
          since: sub.filter.since,
          priority: sub.filter.priority,
          batchWindow: sub.filter.batchWindow,
          batchMaxEvents: sub.filter.batchMaxEvents,
          delegationGroup: sub.filter.delegationGroup,
          oneShot: sub.filter.oneShot,
        }));

        return {
          subscriptions: enrichedSubscriptions,
          delegationGroups,
          agentStatuses: wsState.agentStatuses,
        };
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'agent.cancelSubscriptions': async (params, context) => {
      requireParam(params, 'agentId');
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      try {
        const { agentUnsubscribeAll } = await import(
          '../features/events/main/agent-subscription-ops'
        );
        agentUnsubscribeAll(workspaceId, params.agentId);
        return { success: true };
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    // Specialist methods
    'specialist.list': async () => {
      try {
        const { loadBundledSpecialistFiles, loadSpecialistFiles } = await import(
          '../features/specialists/main/specialist-file-loader'
        );

        const [bundledResult, userResult] = await Promise.all([
          loadBundledSpecialistFiles(),
          loadSpecialistFiles(),
        ]);

        // Merge with user files taking priority (same pattern as specialists.ipc.ts LIST_ALL)
        const seen = new Set<string>();
        const specialists: Array<{
          id: string;
          name: string;
          description: string;
          modelTier?: string;
          source: string;
        }> = [];

        // User files first (highest priority)
        for (const spec of userResult.specialists) {
          seen.add(spec.id);
          specialists.push({
            id: spec.id,
            name: spec.frontmatter.name,
            description: spec.frontmatter.description,
            modelTier: spec.frontmatter.modelTier,
            source: 'file',
          });
        }

        // Bundled specialists (skip if overridden by user)
        for (const spec of bundledResult.specialists) {
          if (!seen.has(spec.id)) {
            seen.add(spec.id);
            specialists.push({
              id: spec.id,
              name: spec.frontmatter.name,
              description: spec.frontmatter.description,
              modelTier: spec.frontmatter.modelTier,
              source: 'bundled',
            });
          }
        }

        return { specialists };
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'agent.create': async (params, context) => {
      const workspaceId = params.workspaceId || context.workspaceId;
      if (!workspaceId) throw new ProtocolError(INVALID_PARAMS, 'workspaceId is required');
      try {
        // Get workspace path
        const workspaceData = await protocolAdapter.getWorkspace(workspaceId);
        if (!workspaceData) throw new ProtocolError(INVALID_PARAMS, 'Workspace not found');
        const workspacePath =
          (workspaceData as any).worktreePath ||
          (workspaceData as any).repositoryPath ||
          (workspaceData as any).path ||
          '';

        // Resolve specialist config if specialistId provided
        let behaviorPrompt: string | undefined;
        let specialistName: string | undefined;
        let roleReminder: string | undefined;
        let agentType: string | undefined;
        let model = params.model;

        if (params.specialistId) {
          const { resolveSpecialistForAgent } = await import(
            '../features/agent/main/specialists.service'
          );
          const specialistConfig = resolveSpecialistForAgent(params.specialistId);
          if (specialistConfig) {
            behaviorPrompt = specialistConfig.behaviorPrompt;
            specialistName = specialistConfig.specialistName;
            roleReminder = specialistConfig.roleReminder;
            agentType = specialistConfig.defaultAgentType;
            // Use specialist's model if caller didn't specify one
            if (!model && specialistConfig.model) {
              model = specialistConfig.model;
            }
          }
        }

        // Generate name if not provided
        let name = params.name;
        if (!name) {
          const { generateRandomAgentName } = await import(
            '../shared/utils/agent-name-generator'
          );
          name = generateRandomAgentName();
        }

        const handler = AgentBackendHandler.getInstance();
        const agent = await handler.createAgent(workspaceId, name, {
          workspacePath,
          model,
          behaviorPrompt,
          specialistName,
          roleReminder,
          agentType: agentType || 'chat',
          metadata: params.specialistId ? { specialist: params.specialistId } : undefined,
        });

        if (!agent) {
          throw new Error('Failed to create agent');
        }

        return {
          agent: {
            id: agent.id,
            name: agent.name,
          },
        };
      } catch (error) {
        if (error instanceof ProtocolError) throw error;
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'agent.rename': async (params, context) => {
      requireParam(params, 'agentId');
      requireParam(params, 'name');
      const workspaceId = params.workspaceId || context.workspaceId;
      const trimmedName = (params.name as string).trim();
      if (!trimmedName) {
        throw new ProtocolError(INVALID_PARAMS, 'Name cannot be empty');
      }

      try {
        // Route through the shared rename helper so the per-agent write lock,
        // `.checksum` sidecar update, persistence load-cache invalidation,
        // in-memory backend session sync, and `agent:renamed` workspace event
        // are all handled in one place.
        const { renameAgentOnDisk } = await import('../features/agent/main/agent-rename');
        const result = await renameAgentOnDisk({
          workspaceId,
          agentId: params.agentId,
          name: trimmedName,
        });
        return { success: true, name: result.name };
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    'agent.delete': async (params, context) => {
      requireParam(params, 'agentId');
      const workspaceId = params.workspaceId || context.workspaceId;
      try {
        const handler = AgentBackendHandler.getInstance();
        await handler.deleteAgent(params.agentId, workspaceId);
        return { success: true };
      } catch (error) {
        throw new ProtocolError(INTERNAL_ERROR, (error as Error).message);
      }
    },

    // Repo methods
    'repo.list': async () => {
      // Return known repos immediately
      const repos = getAllRepos();

      // One-time background sync: register repos from existing workspaces into the persistent registry
      if (!repoRegistrySynced) {
        repoRegistrySynced = true;
        protocolAdapter
          .listAllWorkspaces({ lite: true })
          .then((result) => {
            if (result.ok && result.data) {
              const reposToSync = result.data
                .filter((ws: any) => ws.repositoryPath)
                .map((ws: any) => ({
                  path: ws.repositoryPath,
                  name:
                    ws.repositoryName || ws.repositoryPath.split('/').pop() || 'Unknown',
                  owner: ws.repositoryOwner,
                }));
              if (reposToSync.length > 0) {
                syncRepos(reposToSync);
              }
            }
          })
          .catch((err) => {
            logger.warn('Failed to sync workspace repos to registry', { error: err });
          });
      }

      return { repos };
    },

    // Git methods
    'git.getBranches': async (params) => {
      requireParam(params, 'repoPath');
      const repoPath = params.repoPath as string;

      // Validate repoPath against known repos to prevent arbitrary filesystem access
      const knownRepos = getAllRepos();
      const isKnown = knownRepos.some(r => r.path === repoPath);
      if (!isKnown) {
        throw new ProtocolError(INVALID_PARAMS, 'Unknown or unauthorized repository path');
      }

      const includeRemote = params.includeRemote ?? false;

      try {
        // Get current branch
        const currentBranchResult = await execAsync('git branch --show-current', {
          cwd: repoPath,
        });
        const currentBranch = currentBranchResult.stdout.trim();

        // Get LOCAL branches only first (much faster for repos with many remote branches)
        const localBranchesResult = await execAsync('git branch', {
          cwd: repoPath,
        });

        const localBranches = localBranchesResult.stdout
          .split('\n')
          .map((b: string) => b.trim())
          .filter((b: string) => b.length > 0)
          .map((b: string) => b.replace(/^[*+]\s*/, '')) // Remove current branch marker (*) and worktree marker (+)
          .filter((b: string) => !b.includes(' -> ')); // Filter out symbolic refs

        // Try to determine default branch
        let defaultBranch = 'main';
        try {
          const defaultBranchResult = await execAsync(
            'git symbolic-ref refs/remotes/origin/HEAD',
            { cwd: repoPath },
          );
          const match = defaultBranchResult.stdout.match(/refs\/remotes\/origin\/(.+)/);
          if (match) {
            defaultBranch = match[1].trim();
          }
        } catch {
          // Fallback: check if main or master exists
          if (localBranches.includes('master')) {
            defaultBranch = 'master';
          }
        }

        // Only fetch remote branches if explicitly requested
        let remoteBranches: string[] = [];
        if (includeRemote) {
          try {
            const remoteBranchesResult = await execAsync(
              'git for-each-ref --format="%(refname:short)" refs/remotes/origin/',
              {
                cwd: repoPath,
                timeout: 5000,
              },
            );

            remoteBranches = remoteBranchesResult.stdout
              .split('\n')
              .map((b: string) => b.trim())
              .filter((b: string) => b.length > 0)
              .filter((b: string) => !b.includes(' -> '))
              .filter((b: string) => !localBranches.includes(b.replace(/^origin\//, '')));

            // Sort remote branches: default branch first, then alphabetically
            remoteBranches.sort((a, b) => {
              const aName = a.replace(/^origin\//, '');
              const bName = b.replace(/^origin\//, '');
              if (aName === defaultBranch) return -1;
              if (bName === defaultBranch) return 1;
              return aName.localeCompare(bName);
            });
          } catch {
            // Ignore remote branch errors
          }
        }

        // Sort local branches: default first, current second, then alphabetically
        const sortedLocalBranches = [...localBranches].sort((a, b) => {
          if (a === defaultBranch) return -1;
          if (b === defaultBranch) return 1;
          if (a === currentBranch) return -1;
          if (b === currentBranch) return 1;
          return a.localeCompare(b);
        });

        return {
          branches: sortedLocalBranches,
          remoteBranches,
          currentBranch,
          defaultBranch,
        };
      } catch (error) {
        throw new ProtocolError(
          INTERNAL_ERROR,
          error instanceof Error ? error.message : 'Failed to get branches',
        );
      }
    },
  };
}

// Lazy-initialized method map (singleton)
let methodMap: Record<string, MethodHandler> | null = null;

function getMethodMap(): Record<string, MethodHandler> {
  if (!methodMap) {
    methodMap = buildMethodMap();
  }
  return methodMap;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Handle an incoming WebSocket message (JSON-RPC 2.0).
 *
 * @param message - Raw JSON string from the WebSocket
 * @param context - Optional context (e.g., workspaceId from the connection)
 * @returns JSON string response, or null for notifications (no id)
 */
export async function handleWebSocketMessage(
  message: string,
  context: { workspaceId?: string } = {},
): Promise<string | null> {
  let id: string | number | null = null;
  let isNotification = true; // Default: treat as notification until we know otherwise

  try {
    const request = parseMessage(message);
    id = request.id ?? null;

    // Per JSON-RPC 2.0: A notification is a request without an 'id' member.
    // A request with id: null is a valid request and MUST receive a response.
    isNotification = !request._hasId;

    const methods = getMethodMap();
    const handler = methods[request.method];

    if (!handler) {
      if (isNotification) {
        logger.debug('Unknown notification method, ignoring', { method: request.method });
        return null;
      }
      return JSON.stringify(
        makeErrorResponse(id, METHOD_NOT_FOUND, `Method not found: ${request.method}`),
      );
    }

    logger.debug('Handling WebSocket request', {
      method: request.method,
      id: request.id,
      hasParams: !!request.params,
    });

    const result = await handler(request.params || {}, context);

    if (isNotification) {
      return null;
    }

    return JSON.stringify(makeResponse(id, result));
  } catch (error) {
    // Parse errors always get a response (we can't know if it was a notification)
    if (error instanceof ProtocolError && error.code === PARSE_ERROR) {
      return JSON.stringify(makeErrorResponse(null, PARSE_ERROR, error.message));
    }

    // Invalid request errors also always get a response (validation failed before we could determine notification status)
    if (error instanceof ProtocolError && error.code === INVALID_REQUEST) {
      return JSON.stringify(makeErrorResponse(id, INVALID_REQUEST, error.message));
    }

    // For notifications, don't send error responses
    if (isNotification) {
      logger.warn('Error processing notification', { error: (error as Error).message });
      return null;
    }

    if (error instanceof ProtocolError) {
      return JSON.stringify(
        makeErrorResponse(id, error.code, error.message, error.data),
      );
    }

    logger.error('Internal error handling WebSocket message', error as Error);
    return JSON.stringify(
      makeErrorResponse(id, INTERNAL_ERROR, 'Internal error', (error as Error).message),
    );
  }
}

/**
 * Get the list of supported method names.
 * Useful for documentation and capability negotiation.
 */
export function getSupportedMethods(): string[] {
  return Object.keys(getMethodMap());
}