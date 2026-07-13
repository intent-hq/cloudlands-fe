import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

/**
 * Mapping notes / deferred wiring contract for the ACP <-> Codex app-server adapter.
 *
 * ACP requests accepted from Intent:
 * - initialize -> Codex initialize
 * - authenticate -> local no-op (Codex auth is handled before app-server startup)
 * - session/new -> Codex thread/start
 * - session/load -> Codex thread/resume
 * - session/prompt -> Codex turn/start
 * - session/cancel -> Codex turn/interrupt notification-style handling
 * - session/set_mode -> local Codex approvalPolicy/sandbox defaults for subsequent turns
 * - listModels() -> Codex model/list
 *
 * Codex notifications surfaced as ACP session/update:
 * - turn/started -> local active-turn tracking
 * - item/agentMessage/delta and rawResponseItem/completed -> agent_message_chunk
 * - item/reasoning/*Delta -> agent_thought_chunk
 * - item/started and item/completed -> tool_call / tool_call_update
 * - turn/completed -> done
 * - model/rerouted and configWarning -> agent_message_chunk diagnostics prefixed with
 *   "[Codex warning]" so T3/provider wiring can display them without new UI plumbing.
 *
 * Codex server requests translated to ACP session/request_permission:
 * - applyPatchApproval, execCommandApproval
 * - item/commandExecution/requestApproval, item/fileChange/requestApproval
 * - item/permissions/requestApproval
 * The emitted ACP request id is correlated back to the original Codex JSON-RPC id;
 * handleAcpMessage() accepts the ACP response and writes the matching Codex response.
 *
 * Deferred to T3 wiring:
 * - Dynamic tool calls, MCP elicitation, auth-token refresh, filesystem/client helper
 *   requests, and non-permission app-server requests. They are still emitted as
 *   `codex:request` for observability, but this pure transport does not own the
 *   surrounding UI/services needed to satisfy them.
 */

type JsonRpcId = string | number;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId | null;
  result?: any;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: any;
}

type AcpStopReason = 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled';

interface TransportProcess {
  stdin?: NodeJS.WritableStream | null;
  stdout?: NodeJS.ReadableStream | null;
  stderr?: NodeJS.ReadableStream | null;
}

export interface CodexAppServerAcpAdapterOptions {
  requestTimeoutMs?: number;
  clientInfo?: { name: string; version: string };
}

interface PendingRequest {
  resolve: (response: JsonRpcResponse) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface PendingPrompt {
  resolve: (stopReason: AcpStopReason) => void;
  reject: (error: Error) => void;
}

interface PendingCodexApproval {
  codexId: JsonRpcId;
  codexMethod: string;
  codexParams: any;
}

interface SessionState {
  threadId: string;
  cwd?: string;
  modeId: string;
  approvalPolicy?: 'never' | 'on-request' | 'on-failure' | 'untrusted';
  sandbox?: 'danger-full-access' | 'workspace-write' | 'read-only';
  activeTurnId?: string;
  pendingTurnStart?: Promise<string>;
}

type CodexModel = {
  id: string;
  model: string;
  upgrade: string | null;
  upgradeInfo: unknown | null;
  availabilityNux: unknown | null;
  displayName: string;
  description: string;
  hidden: boolean;
  supportedReasoningEfforts: unknown[];
  defaultReasoningEffort: unknown;
  inputModalities: unknown[];
  supportsPersonality: boolean;
  additionalSpeedTiers: string[];
  isDefault: boolean;
};

export type ModelListResponse = {
  data: CodexModel[];
  nextCursor: string | null;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MODE_ID = 'default';

export class AdapterDisposedError extends Error {
  constructor() {
    super('Codex adapter disposed');
    this.name = 'AdapterDisposedError';
  }
}

/**
 * Pure transport adapter between Intent's ACP-facing provider code and Codex
 * app-server's JSON-RPC protocol. It owns no process spawning or provider wiring;
 * callers pass an already-spawned `codex app-server --listen stdio://` process.
 */
export class CodexAppServerAcpAdapter extends EventEmitter {
  private readonly proc: TransportProcess;
  private readonly requestTimeoutMs: number;
  private readonly clientInfo: { name: string; version: string };
  private requestId = 0;
  private buffer = '';
  private initialized = false;
  private readonly pendingRequests = new Map<JsonRpcId, PendingRequest>();
  private readonly sessions = new Map<string, SessionState>();
  private readonly pendingPrompts = new Map<string, PendingPrompt>();
  private readonly pendingApprovalRequests = new Map<JsonRpcId, PendingCodexApproval>();
  private readonly completedTurns = new Map<string, AcpStopReason>();
  private readonly emittedTextItems = new Set<string>();
  private disposed = false;

  constructor(
    proc: ChildProcess | TransportProcess,
    options: CodexAppServerAcpAdapterOptions = {},
  ) {
    super();
    this.proc = proc;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.clientInfo = options.clientInfo ?? { name: 'Intent', version: '1.0.0' };
    this.proc.stdout?.on('data', (chunk) => this.handleStdout(String(chunk)));
    this.proc.stderr?.on('data', (chunk) => this.emit('stderr', String(chunk)));
  }

  async initialize(): Promise<any> {
    if (this.initialized) return {};
    const response = await this.sendCodexRequest('initialize', {
      clientInfo: this.clientInfo,
      capabilities: { experimentalApi: true, optOutNotificationMethods: [] },
    });
    if (response.error) throw new Error(response.error.message);
    this.initialized = true;
    return response.result;
  }

  /**
   * List models available from the Codex app-server. Used by the model-list
   * probe path when the resolver picks app-server. Returns the parsed
   * ModelListResponse from the v2 protocol — leave the shape close to what
   * 'codex app-server generate-ts' produces; the caller maps it to Intent's
   * model-picker shape.
   *
   * Requires initialize() to have been called.
   */
  async listModels(): Promise<ModelListResponse> {
    const response = await this.sendCodexRequest('model/list', {});
    if (response.error) throw new Error(response.error.message);
    return response.result as ModelListResponse;
  }

  async newSession(params: any = {}): Promise<{ sessionId: string; modeState: any }> {
    await this.initialize();
    const cwd = this.resolveCwd(params);
    const response = await this.sendCodexRequest('thread/start', {
      cwd,
      model: this.resolveModel(params),
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
      baseInstructions: this.resolveInstructions(params),
      sessionStartSource: 'startup',
    });
    if (response.error) throw new Error(response.error.message);
    const threadId = response.result?.thread?.id;
    if (!threadId) throw new Error('Codex thread/start response missing thread.id');
    this.sessions.set(threadId, {
      threadId,
      cwd,
      modeId: 'bypassPermissions',
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
    });
    return { sessionId: threadId, modeState: this.modeState('bypassPermissions') };
  }

  async loadSession(
    params: any = {},
  ): Promise<{ sessionId: string; messages: any[]; modeState: any }> {
    await this.initialize();
    const threadId = String(params.sessionId || '');
    if (!threadId) throw new Error('session/load requires sessionId');
    const cwd = this.resolveCwd(params);
    const response = await this.sendCodexRequest('thread/resume', {
      threadId,
      cwd,
      model: this.resolveModel(params),
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
      excludeTurns: false,
    });
    if (response.error) throw new Error(response.error.message);
    const resumedId = response.result?.thread?.id || threadId;
    this.sessions.set(resumedId, {
      threadId: resumedId,
      cwd,
      modeId: 'bypassPermissions',
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
    });
    return { sessionId: resumedId, messages: [], modeState: this.modeState('bypassPermissions') };
  }

  async prompt(params: any = {}): Promise<{ stopReason: AcpStopReason }> {
    await this.initialize();
    const session = this.requireSession(params.sessionId);
    const turnStart = this.sendCodexRequest('turn/start', {
      threadId: session.threadId,
      input: this.toCodexInput(params.prompt),
      cwd: session.cwd,
      approvalPolicy: session.approvalPolicy,
      sandboxPolicy:
        session.sandbox === 'danger-full-access' ? { type: 'dangerFullAccess' } : undefined,
      model: this.resolveModel(params),
    }).then((response) => {
      if (response.error) throw new Error(response.error.message);
      const turnId = response.result?.turn?.id;
      if (!turnId) throw new Error('Codex turn/start response missing turn.id');
      session.activeTurnId = turnId;
      return turnId;
    });
    session.pendingTurnStart = turnStart;
    let turnId: string;
    try {
      turnId = await turnStart;
    } finally {
      if (session.pendingTurnStart === turnStart) delete session.pendingTurnStart;
    }
    const completedStopReason = this.completedTurns.get(turnId);
    if (completedStopReason) {
      this.completedTurns.delete(turnId);
      return { stopReason: completedStopReason };
    }
    if (this.disposed) throw new AdapterDisposedError();
    return {
      stopReason: await new Promise<AcpStopReason>((resolve, reject) => {
        this.pendingPrompts.set(turnId, { resolve, reject });
      }),
    };
  }

  async cancel(params: any = {}): Promise<void> {
    const session = this.sessions.get(String(params.sessionId || ''));
    if (!session) return;
    let turnId = session.activeTurnId;
    if (!turnId && session.pendingTurnStart) {
      try {
        turnId = await session.pendingTurnStart;
      } catch {
        return;
      }
    }
    if (!turnId || session.activeTurnId !== turnId) return;
    await this.sendCodexRequest('turn/interrupt', {
      threadId: session.threadId,
      turnId,
    }).catch((error) => this.emit('error', error));
  }

  async setMode(params: any = {}): Promise<{ modeState: any }> {
    const session = this.requireSession(params.sessionId);
    const modeId = String(params.modeId || DEFAULT_MODE_ID);
    session.modeId = modeId;

    // Intent exposes ACP `session/set_mode` with a small mode vocabulary while
    // Codex app-server expects per-turn approval/sandbox policy knobs. We keep
    // the current ACP mode locally and apply its Codex equivalent to future
    // `turn/start` requests:
    // - `bypassPermissions` -> approvalPolicy `never` and sandbox
    //   `danger-full-access`, matching Intent's "do not interrupt for tools"
    //   behavior.
    // - any other/default mode -> approvalPolicy `on-request` and sandbox
    //   `workspace-write`, allowing Codex to ask before risky operations.
    if (modeId === 'bypassPermissions') {
      session.approvalPolicy = 'never';
      session.sandbox = 'danger-full-access';
    } else {
      session.approvalPolicy = 'on-request';
      session.sandbox = 'workspace-write';
    }
    return { modeState: this.modeState(modeId) };
  }

  async handleAcpMessage(message: string): Promise<string | null> {
    let parsed: JsonRpcRequest | JsonRpcNotification;
    try {
      parsed = JSON.parse(message);
    } catch (error) {
      return JSON.stringify(this.errorResponse(null, -32700, 'Parse error', String(error)));
    }
    if ('id' in parsed && !('method' in parsed)) {
      return this.handleAcpResponse(parsed as JsonRpcResponse);
    }
    if (!('id' in parsed)) {
      if (parsed.method === 'session/cancel') await this.cancel(parsed.params);
      return null;
    }
    try {
      const result = await this.dispatchAcpRequest(parsed);
      return JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result });
    } catch (error) {
      return JSON.stringify(this.errorResponse(parsed.id, -32603, (error as Error).message));
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new AdapterDisposedError());
    }
    this.pendingRequests.clear();
    for (const pending of this.pendingPrompts.values())
      pending.reject(new AdapterDisposedError());
    this.pendingPrompts.clear();
    this.pendingApprovalRequests.clear();
    this.completedTurns.clear();
    this.removeAllListeners();
  }

  private async dispatchAcpRequest(request: JsonRpcRequest): Promise<any> {
    switch (request.method) {
      case 'initialize': {
        const result = await this.initialize();
        return {
          protocolVersion: 1,
          agentInfo: { name: 'codex-app-server', version: result?.userAgent || 'unknown' },
          promptCapabilities: { embeddedContext: true, image: true },
          sessionCapabilities: { modes: true, models: false, slashCommands: false },
          agentCapabilities: { loadSession: true },
        };
      }
      case 'authenticate':
        return {};
      case 'session/new':
        return this.newSession(request.params);
      case 'session/load':
        return this.loadSession(request.params);
      case 'session/prompt':
        return this.prompt(request.params);
      case 'session/set_mode':
        return this.setMode(request.params);
      default:
        throw new Error(`Method not found: ${request.method}`);
    }
  }

  private sendCodexRequest(method: string, params?: any): Promise<JsonRpcResponse> {
    if (this.disposed) return Promise.reject(new AdapterDisposedError());
    const id = ++this.requestId;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, this.requestTimeoutMs);
      this.pendingRequests.set(id, { resolve, reject, timeout });
      if (!this.proc.stdin?.write(payload)) {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(new Error('Codex app-server stdin is not writable'));
      }
    });
  }

  private handleStdout(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        this.handleCodexMessage(JSON.parse(trimmed));
      } catch (error) {
        this.emit('error', error);
      }
    }
  }

  private handleCodexMessage(message: any): void {
    if ('id' in message && this.pendingRequests.has(message.id)) {
      const pending = this.pendingRequests.get(message.id);
      if (!pending) return;
      this.pendingRequests.delete(message.id);
      clearTimeout(pending.timeout);
      pending.resolve(message);
      return;
    }
    if (typeof message.method !== 'string') return;
    if ('id' in message) {
      if (this.handleCodexServerRequest(message as JsonRpcRequest)) return;
      this.emit('codex:request', message);
      return;
    }
    this.handleCodexNotification(message as JsonRpcNotification);
  }

  private handleCodexNotification(notification: JsonRpcNotification): void {
    const params = notification.params || {};
    switch (notification.method) {
      case 'turn/started':
        this.setActiveTurn(params.threadId, params.turn?.id);
        break;
      case 'item/agentMessage/delta':
        this.emittedTextItems.add(params.itemId);
        this.emitSessionUpdate(params.threadId, {
          type: 'agent_message_chunk',
          content: { type: 'text', text: params.delta || '' },
        });
        break;
      case 'item/reasoning/textDelta':
      case 'item/reasoning/summaryTextDelta':
        this.emitSessionUpdate(params.threadId, {
          type: 'agent_thought_chunk',
          content: { type: 'text', text: params.delta || '' },
        });
        break;
      case 'item/started':
        this.emitToolCallFromItem(params.threadId, params.item);
        break;
      case 'item/completed':
        this.emitCompletedItem(params.threadId, params.item);
        break;
      case 'rawResponseItem/completed':
        this.emitRawResponseItem(params.threadId, params.item);
        break;
      case 'turn/completed':
        this.completeTurn(params.threadId, params.turn);
        break;
      case 'error':
        this.rejectActivePrompt(new Error(params.message || 'Codex app-server error'));
        break;
      case 'model/rerouted':
        this.emitDiagnostic(params.threadId, this.modelReroutedText(params));
        break;
      case 'configWarning':
        this.emitDiagnostic(this.resolveSessionId(params), this.configWarningText(params));
        break;
    }
  }

  private handleCodexServerRequest(request: JsonRpcRequest): boolean {
    if (!this.isApprovalRequest(request.method)) return false;
    const acpId = `codex-approval-${randomUUID()}`;
    this.pendingApprovalRequests.set(acpId, {
      codexId: request.id,
      codexMethod: request.method,
      codexParams: request.params || {},
    });
    const acpRequest: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: acpId,
      method: 'session/request_permission',
      params: this.toAcpPermissionParams(request.method, request.params || {}),
    };
    this.emit('request', acpRequest);
    this.emit('message', JSON.stringify(acpRequest));
    return true;
  }

  private handleAcpResponse(response: JsonRpcResponse): string | null {
    const pending = this.pendingApprovalRequests.get(response.id as JsonRpcId);
    if (!pending) return null;
    this.pendingApprovalRequests.delete(response.id as JsonRpcId);
    const codexResponse: JsonRpcResponse = response.error
      ? { jsonrpc: '2.0', id: pending.codexId, error: response.error }
      : {
          jsonrpc: '2.0',
          id: pending.codexId,
          result: this.toCodexApprovalResult(pending, response.result),
        };
    this.proc.stdin?.write(`${JSON.stringify(codexResponse)}\n`);
    return null;
  }

  private isApprovalRequest(method: string): boolean {
    return (
      method === 'applyPatchApproval' ||
      method === 'execCommandApproval' ||
      method === 'item/commandExecution/requestApproval' ||
      method === 'item/fileChange/requestApproval' ||
      method === 'item/permissions/requestApproval'
    );
  }

  private toAcpPermissionParams(method: string, params: any): any {
    const threadId = params.threadId || params.conversationId;
    const rawInput = this.approvalRawInput(method, params);
    return {
      sessionId: threadId,
      toolCall: {
        toolCallId:
          params.itemId || params.callId || params.approvalId || String(threadId || randomUUID()),
        title: this.approvalTitle(method, params),
        kind: this.approvalKind(method),
        rawInput,
      },
      title: this.approvalTitle(method, params),
      description: params.reason || `Codex requests approval for ${method}`,
      options: [
        { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'allow_session', name: 'Allow for session', kind: 'allow_always' },
        { optionId: 'reject_once', name: 'Reject', kind: 'reject_once', destructive: true },
      ],
      rawInput,
    };
  }

  private approvalTitle(method: string, params: any): string {
    switch (method) {
      case 'applyPatchApproval':
      case 'item/fileChange/requestApproval':
        return params.grantRoot
          ? `Allow Codex to edit ${params.grantRoot}`
          : 'Allow Codex file changes';
      case 'execCommandApproval':
      case 'item/commandExecution/requestApproval':
        return `Allow Codex command: ${this.commandText(params)}`;
      case 'item/permissions/requestApproval':
        return 'Allow Codex additional permissions';
      default:
        return 'Codex approval request';
    }
  }

  private approvalKind(method: string): string {
    if (method === 'execCommandApproval' || method === 'item/commandExecution/requestApproval') {
      return 'execute';
    }
    return 'edit';
  }

  private approvalRawInput(method: string, params: any): any {
    if (method === 'applyPatchApproval') {
      return { fileChanges: params.fileChanges || {}, grantRoot: params.grantRoot };
    }
    if (method === 'execCommandApproval') {
      return { command: params.command || [], cwd: params.cwd, parsedCmd: params.parsedCmd || [] };
    }
    if (method === 'item/commandExecution/requestApproval') {
      return {
        command: params.command,
        cwd: params.cwd,
        commandActions: params.commandActions || [],
      };
    }
    if (method === 'item/fileChange/requestApproval') {
      return { itemId: params.itemId, grantRoot: params.grantRoot };
    }
    return { cwd: params.cwd, permissions: params.permissions };
  }

  private toCodexApprovalResult(pending: PendingCodexApproval, acpResult: any): any {
    const optionId = acpResult?.outcome?.optionId || acpResult?.optionId || acpResult?.id;
    const allowed = acpResult?.outcome?.outcome === 'selected' && optionId !== 'reject_once';
    const sessionAllowed = allowed && optionId === 'allow_session';
    switch (pending.codexMethod) {
      case 'applyPatchApproval':
      case 'execCommandApproval':
        return {
          decision: allowed ? (sessionAllowed ? 'approved_for_session' : 'approved') : 'denied',
        };
      case 'item/commandExecution/requestApproval':
        return { decision: allowed ? (sessionAllowed ? 'acceptForSession' : 'accept') : 'decline' };
      case 'item/fileChange/requestApproval':
        return { decision: allowed ? (sessionAllowed ? 'acceptForSession' : 'accept') : 'decline' };
      case 'item/permissions/requestApproval':
        return {
          permissions: allowed ? this.grantedPermissions(pending.codexParams.permissions) : {},
          scope: sessionAllowed ? 'session' : 'turn',
          strictAutoReview: !allowed,
        };
      default:
        return {};
    }
  }

  private grantedPermissions(requested: any): any {
    const granted: any = {};
    if (requested?.network) granted.network = requested.network;
    if (requested?.fileSystem) granted.fileSystem = requested.fileSystem;
    return granted;
  }

  private emitDiagnostic(sessionId: string | undefined, text: string): void {
    if (!sessionId) return;
    this.emitSessionUpdate(sessionId, {
      type: 'agent_message_chunk',
      content: { type: 'text', text },
    });
  }

  private modelReroutedText(params: any): string {
    const reason =
      typeof params.reason === 'string' ? params.reason : JSON.stringify(params.reason || '');
    return `[Codex warning] Model rerouted from ${params.fromModel || 'unknown'} to ${params.toModel || 'unknown'}${reason ? `: ${reason}` : ''}`;
  }

  private configWarningText(params: any): string {
    const path = params.path ? ` (${params.path})` : '';
    const details = params.details ? ` ${params.details}` : '';
    return `[Codex warning] ${params.summary || 'Configuration warning'}${path}.${details}`;
  }

  private resolveSessionId(params: any): string | undefined {
    return (
      params?.threadId ||
      params?.conversationId ||
      params?.sessionId ||
      this.sessions.keys().next().value
    );
  }

  private emitToolCallFromItem(threadId: string, item: any): void {
    if (
      !item ||
      item.type === 'agentMessage' ||
      item.type === 'userMessage' ||
      item.type === 'reasoning'
    )
      return;
    const tool = this.toolInfo(item);
    this.emitSessionUpdate(threadId, {
      type: 'tool_call',
      toolCallId: item.id,
      title: tool.title,
      name: tool.name,
      kind: tool.kind,
      status: 'in_progress',
      rawInput: tool.input,
      content: { id: item.id, name: tool.name, input: tool.input },
    });
  }

  private emitCompletedItem(threadId: string, item: any): void {
    if (!item) return;
    if (item.type === 'agentMessage' && item.text && !this.emittedTextItems.has(item.id)) {
      this.emitSessionUpdate(threadId, {
        type: 'agent_message_chunk',
        content: { type: 'text', text: item.text },
      });
      return;
    }
    if (item.type === 'reasoning') return;
    const tool = this.toolInfo(item);
    this.emitSessionUpdate(threadId, {
      type: 'tool_call_update',
      toolCallId: item.id,
      title: tool.title,
      name: tool.name,
      status: tool.failed ? 'failed' : 'completed',
      rawOutput: tool.output,
      content: { toolCallId: item.id, result: tool.output },
    });
  }

  private emitRawResponseItem(threadId: string, item: any): void {
    if (item?.type !== 'message') return;
    const text = (item.content || [])
      .filter((part: any) => part?.type === 'output_text')
      .map((part: any) => part.text || '')
      .join('');
    if (text) {
      const itemId = item.id || randomUUID();
      if (this.emittedTextItems.has(itemId)) return;
      this.emittedTextItems.add(itemId);
      this.emitSessionUpdate(threadId, {
        type: 'agent_message_chunk',
        content: { type: 'text', text },
      });
    }
  }

  private completeTurn(threadId: string, turn: any): void {
    const turnId = turn?.id;
    const stopReason = this.toAcpStopReason(turn?.status);
    this.emitSessionUpdate(threadId, { type: 'done', stopReason });
    if (turnId && this.pendingPrompts.has(turnId)) {
      const pending = this.pendingPrompts.get(turnId);
      if (!pending) return;
      this.pendingPrompts.delete(turnId);
      pending.resolve(stopReason);
    } else if (turnId) {
      this.completedTurns.set(turnId, stopReason);
    }
    const session = this.sessions.get(threadId);
    if (session && session.activeTurnId === turnId) delete session.activeTurnId;
  }

  private emitSessionUpdate(sessionId: string, update: any): void {
    if (!sessionId) return;
    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method: 'session/update',
      params: { sessionId, sessionUpdate: { sessionUpdate: update.type, ...update } },
    };
    this.emit('notification', notification);
    this.emit('message', JSON.stringify(notification));
  }

  private toolInfo(item: any): {
    title: string;
    name: string;
    kind: string;
    input: any;
    output: string;
    failed: boolean;
  } {
    if (item.type === 'mcpToolCall') {
      return {
        title: `${item.server}:${item.tool}`,
        name: `${item.server}_${item.tool}`,
        kind: 'other',
        input: { server: item.server, tool: item.tool, arguments: item.arguments || {} },
        output: this.stringifyToolOutput(item.result || item.error || ''),
        failed: item.status === 'failed' || !!item.error,
      };
    }
    if (item.type === 'commandExecution') {
      return {
        title: item.command || 'Command',
        name: 'commandExecution',
        kind: 'execute',
        input: { command: item.command, cwd: item.cwd },
        output: item.aggregatedOutput || '',
        failed: item.status === 'failed' || (item.exitCode != null && item.exitCode !== 0),
      };
    }
    return {
      title: item.type || 'Tool',
      name: item.type || 'tool',
      kind: 'other',
      input: item.arguments || item.changes || {},
      output: this.stringifyToolOutput(item.result || item.error || item.aggregatedOutput || ''),
      failed: item.status === 'failed',
    };
  }

  private async rejectActivePrompt(error: Error): Promise<void> {
    for (const [turnId, pending] of this.pendingPrompts.entries()) {
      this.pendingPrompts.delete(turnId);
      pending.reject(error);
    }
    this.emit('error', error);
  }

  private setActiveTurn(threadId: string, turnId?: string): void {
    const session = this.sessions.get(threadId);
    if (session && turnId) session.activeTurnId = turnId;
  }

  private requireSession(sessionId: string): SessionState {
    const session = this.sessions.get(String(sessionId || ''));
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    return session;
  }

  private toCodexInput(prompt: any): any[] {
    const text = this.extractPromptText(prompt).trim();
    return [{ type: 'text', text, text_elements: [] }];
  }

  private extractPromptText(value: any): string {
    if (typeof value === 'string') return value;
    if (!Array.isArray(value)) return value?.text || value?.content || '';
    return value
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (entry?.type === 'text') return entry.text || entry.content || '';
        if (Array.isArray(entry?.content)) return this.extractPromptText(entry.content);
        return entry?.text || entry?.content || '';
      })
      .filter(Boolean)
      .join('\n');
  }

  private resolveCwd(params: any): string | undefined {
    return params?.cwd || params?.metadata?.workspacePath;
  }

  private resolveModel(params: any): string | undefined {
    return params?.model || params?.metadata?.model;
  }

  private resolveInstructions(params: any): string | undefined {
    return params?.metadata?.systemPrompt || params?.metadata?.instructions;
  }

  private stringifyToolOutput(value: any): string {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value ?? '');
    } catch {
      return String(value);
    }
  }

  private commandText(params: any): string {
    if (typeof params.command === 'string') return params.command;
    if (Array.isArray(params.command)) return params.command.join(' ');
    return 'command';
  }

  private toAcpStopReason(status: string | undefined): AcpStopReason {
    if (status === 'interrupted') return 'cancelled';
    if (status === 'failed') return 'refusal';
    return 'end_turn';
  }

  private modeState(currentModeId: string): any {
    return {
      currentModeId,
      availableModes: [
        { id: DEFAULT_MODE_ID, name: 'Default' },
        { id: 'bypassPermissions', name: 'Bypass Permissions' },
      ],
    };
  }

  private errorResponse(
    id: JsonRpcId | null,
    code: number,
    message: string,
    data?: unknown,
  ): JsonRpcResponse {
    return { jsonrpc: '2.0', id, error: { code, message, data } };
  }
}
