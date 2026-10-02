import { randomUUID } from 'node:crypto';
import type {
  DesktopAction,
  DesktopDisplay,
  DesktopDisplayList,
  DesktopEndReason,
  DesktopScreenshotResult,
} from '../../../shared/types/desktop';
import { ReverseRpcHandlerError } from '../../backend/main/json-rpc-client';
import { desktopFailure, parseDesktopRequest, type DesktopRequest } from './desktop-validation';

export interface DesktopLocalSession {
  backendId: string;
  workspaceId: string;
  agentId: string;
  agentName: string;
  sessionId: string;
  computerName: string;
  computerId: string;
}
export interface DesktopOverlay {
  activate(
    session: DesktopLocalSession,
    stop: () => void,
    invalidate: (reason: DesktopEndReason) => void,
  ): Promise<void>;
  deactivate(sessionId: string): Promise<void>;
  pulse(sessionId: string): void;
  excludedWindows(): string[];
}
export interface DesktopNative {
  identity(): Promise<{ computerId: string; computerName: string; platform: 'macos' | 'windows' }>;
  acquire(signal: AbortSignal): Promise<void>;
  release(): Promise<void>;
  check(): Promise<void>;
  validateExclusion(excludedWindows: string[]): Promise<void>;
  layout(): Promise<DesktopDisplay[]>;
  capture(
    excludedWindows: string[],
    signal: AbortSignal,
    display: DesktopDisplay,
    layout: DesktopDisplay[],
  ): Promise<(DesktopDisplay & { data: string })[]>;
  input(
    action: DesktopAction,
    display: DesktopDisplay | undefined,
    check: (executed?: boolean) => void,
    signal: AbortSignal,
    layout?: DesktopDisplay[],
  ): Promise<void>;
}
export interface DesktopCredential {
  backendId: string;
  workspaceId: string;
  agentId: string;
  principalId: string;
  sessionId: string;
  computerId: string;
  connectionEpoch: string;
  stopReportToken: string;
}
export interface DesktopStopReports {
  retain(credential: DesktopCredential): Promise<void>;
  queue(credential: DesktopCredential): Promise<void>;
}
export interface DesktopConnection {
  backendId: string;
  saveAsset(params: {
    workspaceId: string;
    data: string;
    mimeType: 'image/png';
    originalName: string;
  }): Promise<{ assetId: string; url: string }>;
  revoke(params: { workspaceId: string; sessionId: string; reason: string }): Promise<unknown>;
}
type Start = Extract<DesktopRequest, { operation: 'startControl' }>;
interface Ticket {
  commandId: string;
  sequence: number;
  deadlineId: string;
  deadline: number;
  action: DesktopAction;
  layout?: DesktopDisplayList;
  display?: DesktopDisplay;
}
interface Session {
  request: Start;
  connection: DesktopConnection;
  abort: AbortController;
  lease: number;
  phase: 'starting' | 'active';
  sequence: number;
  commandIds: Set<string>;
  expiredTickets: Map<string, { commandId: string; sequence: number }>;
  ticket?: Ticket;
  executing: boolean;
  layout?: { id: string; displays: DesktopDisplay[] };
}
const bindingKeys = ['workspaceId', 'agentId', 'principalId', 'connectionEpoch'] as const;

/** One instance in Electron main for ALL pooled backend connections. Native acquire
 * also takes the OS-wide lock, covering other running Intent installations. */
export class DesktopExecutor {
  private session?: Session;
  private readonly inFlight = new Set<Session>();
  private readonly prepared = new Map<DesktopConnection, Set<string>>();
  private readonly generations = new WeakMap<DesktopConnection, number>();
  private readonly stopped = new Map<
    string,
    { credential: DesktopCredential; connection: DesktopConnection }
  >();
  private cleanup: Promise<void> | undefined;
  private lastClock = -Infinity;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private readonly native: DesktopNative,
    private readonly overlay: DesktopOverlay,
    private readonly reports: DesktopStopReports,
    private readonly now = () => performance.now(),
  ) {}

  private clock(): number {
    const value = this.now();
    if (!Number.isFinite(value) || value < this.lastClock) {
      void this.invalidate('executor_failed').catch(() => {});
      throw desktopFailure(
        'desktop-deadline-unavailable',
        'The local monotonic clock changed',
        'not_started',
      );
    }
    this.lastClock = value;
    return value;
  }
  private key(p: DesktopRequest): string {
    return JSON.stringify(bindingKeys.map((k) => p[k]));
  }
  private credential(s: Session): DesktopCredential {
    const p = s.request;
    return {
      backendId: s.connection.backendId,
      workspaceId: p.workspaceId,
      agentId: p.agentId,
      principalId: p.principalId,
      sessionId: p.sessionId,
      computerId: p.computerId,
      connectionEpoch: p.connectionEpoch,
      stopReportToken: p.stopReportToken,
    };
  }
  private check(s: Session, ticket?: Ticket, started = false): void {
    const execution = started ? 'partial' : 'not_started';
    if (this.session !== s || s.abort.signal.aborted)
      throw desktopFailure('desktop-not-active', 'Desktop control is no longer active', execution);
    const now = this.clock();
    if (now >= s.lease) {
      void this.invalidate('lease_expired').catch(() => {});
      throw desktopFailure('desktop-not-active', 'The local desktop lease expired', execution);
    }
    if (ticket && now >= ticket.deadline)
      throw desktopFailure('desktop-command-expired', 'The command ticket expired', execution);
  }
  private armLease(s: Session): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        if (this.session === s) void this.invalidate('lease_expired').catch(() => {});
      },
      Math.max(0, s.lease - this.clock()),
    );
    this.timer.unref?.();
  }
  async handle(connection: DesktopConnection, raw: unknown): Promise<unknown> {
    const p = parseDesktopRequest(raw);
    if (p.operation === 'prepare') {
      const generation = this.generations.get(connection) ?? 0;
      const identity = await this.native.identity();
      if (generation !== (this.generations.get(connection) ?? 0))
        throw desktopFailure(
          'desktop-offline',
          'The execution connection changed during preparation',
        );
      let bindings = this.prepared.get(connection);
      if (!bindings) this.prepared.set(connection, (bindings = new Set()));
      bindings.add(this.key(p));
      return identity;
    }
    if (p.operation === 'startControl') return this.start(connection, p);
    const s = this.session;
    if (!s) {
      if (p.operation === 'endControl' && this.prepared.get(connection)?.has(this.key(p)))
        return { ended: false, sessionId: p.sessionId };
      throw desktopFailure('desktop-not-active', 'No local desktop session', 'not_started');
    }
    if (
      s.connection !== connection ||
      this.key(p) !== this.key(s.request) ||
      p.computerId !== s.request.computerId ||
      p.sessionId !== s.request.sessionId
    )
      throw desktopFailure(
        'forbidden',
        'The command does not own the local desktop session',
        'not_started',
      );
    this.check(s);
    if (p.operation === 'endControl') {
      await this.invalidate('agent_end', false);
      return { ended: true, sessionId: p.sessionId };
    }
    if (s.phase !== 'active')
      throw desktopFailure('desktop-not-active', 'Local readiness is not complete', 'not_started');
    if (p.operation === 'renew') {
      try {
        await this.native.check();
        this.check(s);
      } catch (error) {
        await this.invalidate('os_permission_lost').catch(() => {});
        throw error;
      }
      s.lease = this.clock() + 15000;
      this.armLease(s);
      return { renewed: true, sessionId: p.sessionId };
    }
    if (p.operation === 'prepareCommand') {
      if (p.sequence <= s.sequence || s.commandIds.has(p.commandId))
        throw desktopFailure(
          'desktop-stale-command',
          'Command sequence was already used',
          'not_started',
        );
      if (s.executing || (s.ticket && this.clock() < s.ticket.deadline))
        throw desktopFailure('desktop-busy', 'A desktop command is already pending', 'not_started');
      s.sequence = p.sequence;
      s.commandIds.add(p.commandId);
      if (s.ticket)
        s.expiredTickets.set(s.ticket.deadlineId, {
          commandId: s.ticket.commandId,
          sequence: s.ticket.sequence,
        });
      s.ticket = {
        commandId: p.commandId,
        sequence: p.sequence,
        deadlineId: randomUUID(),
        deadline: this.clock() + 10000,
        action: p.action,
      };
      const ticket = s.ticket;
      try {
        if (p.action.kind === 'screenshot' || 'layoutId' in p.action) {
          const displays = await this.native.layout();
          this.check(s, ticket);
          const previous = s.layout;
          const layout =
            !previous || JSON.stringify(previous.displays) !== JSON.stringify(displays)
              ? { id: randomUUID(), displays }
              : previous;
          s.layout = layout;
          ticket.layout = { layoutId: layout.id, displays: layout.displays };
          if (
            'layoutId' in p.action &&
            p.action.layoutId !== undefined &&
            p.action.layoutId !== ticket.layout.layoutId
          )
            throw desktopFailure(
              'desktop-stale-layout',
              'List displays again after a display change',
              'not_started',
            );
          const selected = p.action.displayId;
          if (
            !displays.length ||
            (selected !== undefined && !displays.some((d) => d.displayId === selected))
          )
            throw desktopFailure(
              'desktop-display-unavailable',
              'The selected display is unavailable; call ws.desktop.listDisplay()',
              'not_started',
            );
          if (selected === undefined && displays.length > 1)
            throw desktopFailure(
              'desktop-display-selection-required',
              'Multiple displays are available. Call ws.desktop.listDisplay() and ask the user which screen to use, then retry with displayId.',
              'not_started',
            );
          const target =
            selected === undefined ? displays[0] : displays.find((d) => d.displayId === selected);
          if (!target)
            throw desktopFailure(
              'desktop-display-unavailable',
              'The selected display is unavailable',
              'not_started',
            );
          ticket.display = target;
          if (p.action.kind !== 'screenshot') {
            const points = p.action.kind === 'drag' ? [p.action.from, p.action.to] : [p.action];
            if (points.some((pt) => pt.x >= target.width || pt.y >= target.height))
              throw desktopFailure(
                'invalid-params',
                'Coordinates are outside the selected display',
                'not_started',
              );
          }
        }
      } catch (error) {
        if (s.ticket === ticket) s.ticket = undefined;
        throw error;
      }
      return {
        commandId: p.commandId,
        sequence: p.sequence,
        deadlineId: ticket.deadlineId,
        expiresInMs: 10000,
      };
    }
    const expired = s.expiredTickets.get(p.deadlineId);
    if (expired?.commandId === p.commandId && expired.sequence === p.sequence)
      throw desktopFailure('desktop-command-expired', 'The command ticket expired', 'not_started');
    const ticket = s.ticket;
    if (
      !ticket ||
      ticket.commandId !== p.commandId ||
      ticket.sequence !== p.sequence ||
      ticket.deadlineId !== p.deadlineId
    )
      throw desktopFailure(
        'desktop-stale-command',
        'Unknown or consumed command ticket',
        'not_started',
      );
    if (this.clock() >= ticket.deadline) {
      s.expiredTickets.set(ticket.deadlineId, {
        commandId: ticket.commandId,
        sequence: ticket.sequence,
      });
      s.ticket = undefined;
      throw desktopFailure('desktop-command-expired', 'The command ticket expired', 'not_started');
    }
    s.ticket = undefined;
    this.check(s, ticket);
    s.executing = true;
    this.inFlight.add(s);
    let started = false;
    const guard = () => this.check(s, ticket, started);
    const deadlineTimer = setTimeout(
      () => {
        if (this.session === s) void this.invalidate('executor_failed').catch(() => {});
      },
      Math.max(0, ticket.deadline - this.clock()),
    );
    try {
      await this.native.check();
      guard();
      const action = ticket.action;
      let result: DesktopScreenshotResult | DesktopDisplayList | { ok: true };
      const checkLayout = async () => {
        if (!ticket.layout) return;
        const current = await this.native.layout();
        guard();
        if (JSON.stringify(current) !== JSON.stringify(ticket.layout.displays))
          throw desktopFailure(
            'desktop-stale-layout',
            'List displays again after a display change',
            started ? 'partial' : 'not_started',
          );
      };
      await checkLayout();
      if (action.kind === 'listDisplay') {
        const displays = await this.native.layout();
        guard();
        if (!s.layout || JSON.stringify(s.layout.displays) !== JSON.stringify(displays))
          s.layout = { id: randomUUID(), displays };
        result = { layoutId: s.layout.id, displays };
      } else if (action.kind === 'screenshot') {
        const selected = ticket.display;
        const layout = ticket.layout;
        if (!selected || !layout)
          throw desktopFailure(
            'desktop-stale-command',
            'Screenshot selection was not prepared',
            'not_started',
          );
        started = true;
        const captures = await this.native.capture(
          this.overlay.excludedWindows(),
          s.abort.signal,
          selected,
          layout.displays,
        );
        guard();
        await checkLayout();
        if (
          captures.length !== 1 ||
          JSON.stringify(captures.map(({ data: _data, ...d }) => d)) !== JSON.stringify([selected])
        )
          throw desktopFailure(
            'desktop-execution-failed',
            'Native capture did not return exactly the selected display',
            'partial',
          );
        const { data, ...display } = captures[0];
        const asset = await connection.saveAsset({
          workspaceId: p.workspaceId,
          data,
          mimeType: 'image/png',
          originalName: 'desktop.png',
        });
        guard();
        await checkLayout();
        if (!asset.assetId || asset.url !== `workspace-asset://${p.workspaceId}/${asset.assetId}`)
          throw desktopFailure(
            'desktop-execution-failed',
            'Asset persistence returned an invalid screenshot reference',
            'partial',
          );
        result = {
          capturedAt: new Date().toISOString(),
          layoutId: layout.layoutId,
          displays: [{ ...display, ...asset, mimeType: 'image/png' }],
        };
        guard();
        this.overlay.pulse(p.sessionId);
      } else {
        guard();
        await this.native.input(
          action,
          ticket.display,
          (executed = false) => {
            if (executed) started = true;
            guard();
          },
          s.abort.signal,
          ticket.layout?.displays,
        );
        guard();
        await checkLayout();
        result = { ok: true };
      }
      return { commandId: p.commandId, sequence: p.sequence, result };
    } catch (error) {
      const code =
        error instanceof ReverseRpcHandlerError
          ? (error.data as { code?: string })?.code
          : undefined;
      if (
        started ||
        !(error instanceof ReverseRpcHandlerError) ||
        code === 'desktop-os-permission-required' ||
        code === 'desktop-unsupported-operation' ||
        code === 'desktop-not-active'
      )
        await this.invalidate(
          code === 'desktop-os-permission-required' ? 'os_permission_lost' : 'executor_failed',
        ).catch(() => {});
      if (error instanceof ReverseRpcHandlerError) throw error;
      throw desktopFailure(
        'desktop-execution-failed',
        'Native desktop execution failed',
        started ? 'unknown' : 'not_started',
      );
    } finally {
      clearTimeout(deadlineTimer);
      s.executing = false;
      this.inFlight.delete(s);
    }
  }
  private async start(connection: DesktopConnection, p: Start): Promise<unknown> {
    if (!this.prepared.get(connection)?.has(this.key(p)))
      throw desktopFailure('forbidden', 'Desktop connection was not prepared');
    if (this.session || this.cleanup || this.inFlight.size)
      throw desktopFailure('desktop-busy', 'This desktop is already controlled');
    if (this.stopped.has(p.sessionId))
      throw desktopFailure(
        'desktop-stale-request',
        'A desktop session identifier cannot be reused',
      );
    const s: Session = {
      request: p,
      connection,
      abort: new AbortController(),
      lease: this.clock() + 15000,
      phase: 'starting',
      sequence: 0,
      commandIds: new Set(),
      expiredTickets: new Map(),
      executing: false,
    };
    this.session = s;
    this.inFlight.add(s);
    this.armLease(s);
    try {
      const identity = await this.native.identity();
      this.check(s);
      if (identity.computerId !== p.computerId)
        throw desktopFailure('forbidden', 'Desktop identity changed');
      await this.native.acquire(s.abort.signal);
      this.check(s);
      await this.native.check();
      this.check(s);
      const credential = this.credential(s);
      await this.reports.retain(credential);
      this.check(s);
      this.stopped.set(p.sessionId, { credential, connection });
      await this.overlay.activate(
        {
          backendId: connection.backendId,
          workspaceId: p.workspaceId,
          agentId: p.agentId,
          agentName: p.agentName,
          sessionId: p.sessionId,
          computerId: p.computerId,
          computerName: identity.computerName,
        },
        () => {
          void this.stop(p.sessionId).catch(() => {});
        },
        (reason) => {
          void this.invalidate(reason, true, p.sessionId).catch(() => {});
        },
      );
      this.check(s);
      await this.native.validateExclusion(this.overlay.excludedWindows());
      this.check(s);
      s.phase = 'active';
      return { ready: true, sessionId: p.sessionId, computerId: p.computerId };
    } catch (error) {
      await this.invalidate('executor_failed', false).catch(() => {});
      if (error instanceof ReverseRpcHandlerError) throw error;
      throw desktopFailure('desktop-execution-failed', 'Local desktop readiness failed');
    } finally {
      this.inFlight.delete(s);
    }
  }
  /** Invalidate synchronously, before disk/network/overlay teardown awaits. */
  invalidate(reason: DesktopEndReason, report = true, expectedSessionId?: string): Promise<void> {
    const s = this.session;
    if (expectedSessionId && s?.request.sessionId !== expectedSessionId) return Promise.resolve();
    if (!s) return this.cleanup ?? Promise.resolve();
    this.session = undefined;
    s.abort.abort();
    s.ticket = undefined;
    clearTimeout(this.timer);
    this.cleanup = (async () => {
      const results = await Promise.allSettled([
        this.native.release(),
        this.overlay.deactivate(s.request.sessionId),
      ]);
      if (report && reason !== 'disconnected')
        void s.connection
          .revoke({ workspaceId: s.request.workspaceId, sessionId: s.request.sessionId, reason })
          .catch(() => {});
      if (results.some((r) => r.status === 'rejected'))
        throw desktopFailure(
          'desktop-execution-failed',
          'Local desktop cleanup could not be confirmed',
        );
    })().finally(() => {
      this.cleanup = undefined;
    });
    return this.cleanup;
  }
  async stop(sessionId: string): Promise<void> {
    const record = this.stopped.get(sessionId);
    if (!record) return;
    const cleanup =
      this.session?.request.sessionId === sessionId
        ? this.invalidate('user_stop', false)
        : Promise.resolve();
    const outcomes = await Promise.allSettled([this.reports.queue(record.credential), cleanup]);
    const failure = outcomes.find((r) => r.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }
  disconnect(connection: DesktopConnection): void {
    this.generations.set(connection, (this.generations.get(connection) ?? 0) + 1);
    this.prepared.delete(connection);
    if (this.session?.connection === connection)
      void this.invalidate('disconnected', false).catch(() => {});
  }
}
