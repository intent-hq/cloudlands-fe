import type {
  StoreDispatch,
  StoreSelectorEffect,
  StoreSelectorSelect,
} from '@themislib/themis/types';
import type { connectionStatusChanged } from '../daemon-health/daemon-health-slice';
import type { AcquiredTabState } from '../tab-state/tab-state-acquisition-types';
import type { workspaceLoadRequested } from './workspace-lifecycle-slice';
import type {
  WorkspaceLoadReadScope,
  WorkspaceLoadRequestLifetime,
} from './workspace-load-admission-types';

export type WorkspaceOriginState = { tabState: AcquiredTabState };
export type WorkspaceLoadAction = ReturnType<typeof workspaceLoadRequested>;

/** Required real route adapter; its production binding is not implemented here. */
export type PreparedWorkspaceLoadOrigin = {
  readonly requestIdentity: object;
  readonly signal: AbortSignal;
  isCurrent(): boolean;
  /** Synchronous, single acquisition of fresh real canonical clients on the prepared route. */
  acquireReadScope(context: string): WorkspaceLoadReadScope | null;
  /** Idempotent and non-throwing; releases this prepared route and its owned clients. */
  release(): void;
};

export type WorkspaceOriginAuthority = {
  readonly identity: object;
  readonly signal: AbortSignal;
  /** Direct, non-throwing currentness of the ALREADY captured ready physical anchor. */
  isCurrent(): boolean;
  /** Invoked by the sole saga worker, never by submit or a component. */
  prepare(request: WorkspaceLoadRequestLifetime): Promise<PreparedWorkspaceLoadOrigin | null>;
};

/** Original physical capture; the async acquisition owner must transfer or release it. */
export type OwnedWorkspaceOriginAuthority = WorkspaceOriginAuthority & {
  /** Non-throwing, idempotent; releases only this captured origin. */
  release(): void;
};

/** The only port given to producers and the b0 loader. No action/dispatch/publish capability. */
export type WorkspaceLoadOriginPort = {
  /** Existing synchronous producer port; optional async mode refuses external submissions. */
  submit(workspaceId: string, capturedAuthority: WorkspaceOriginAuthority): boolean;
  captureRequest(action: WorkspaceLoadAction): WorkspaceLoadRequestLifetime | null;
};

/** Internal resource record passed only between the canonical saga and its resource owner. */
export type WorkspaceLoadOriginIntent = {
  readonly action: WorkspaceLoadAction;
  readonly serial: number;
  readonly jointIdentity: object;
  readonly authority: WorkspaceOriginAuthority;
  readonly lifetime: WorkspaceLoadRequestLifetime;
  installPrepared(prepared: PreparedWorkspaceLoadOrigin): boolean;
  authorizePublication(): boolean;
  retire(): void;
};

export type WorkspaceLoadOriginOwner = {
  readAcceptedSerial(workspaceId: string): number | undefined;
  readJointIdentity(workspaceId: string): object | undefined;
  begin(
    workspaceId: string,
    authority: WorkspaceOriginAuthority,
    expectedSerial?: number,
  ): WorkspaceLoadOriginIntent | null;
  captureRequest(action: WorkspaceLoadAction): WorkspaceLoadRequestLifetime | null;
  observeAcceptedState(): void;
  dispose(): void;
};

export type SourceWorkspaceTabCleanupOptions = {
  kind?: 'source';
  selectCurrentWorkspaceTabId: { effect: StoreSelectorEffect<string | null> };
  selectActiveWorkspaceIds: { effect: StoreSelectorEffect<string[]> };
  selectIsWorkspaceSessionLive: {
    effect: StoreSelectorEffect<boolean, [wsId: string]>;
  };
};

export type OriginWorkspaceTabCleanupOptions<State extends WorkspaceOriginState> = {
  kind: 'origin';
  selectIsWorkspaceSessionLive: {
    select: StoreSelectorSelect<boolean, [wsId: string], State>;
  };
  /** Pure synchronous lookup only when observation is omitted. No lazy capture, await or I/O. */
  readReadyAuthority(workspaceId: string): WorkspaceOriginAuthority | null;
  /** Opt-in observation; omitted preserves the existing synchronous option. */
  observation?: {
    /** Accepted cancellation API: prompt null on abort, original invocation drained. */
    observe(signal: AbortSignal): Promise<OwnedWorkspaceOriginAuthority | null>;
    /** Existing status action is only a wake hint, never physical authority. */
    wakeAction: typeof connectionStatusChanged;
    /** Pure canonical principal context. Freshness fence only; loader owns read admission. */
    readCurrentContext(): string | null;
  };
  /** Root-owned binding; disposer detaches producer access. A retained port refuses after teardown. */
  bind(port: WorkspaceLoadOriginPort): () => void;
};

export type WorkspaceOriginQueueItem =
  | {
      kind: 'cleanup';
      workspaceId: string;
      successorSerial: number | undefined;
      jointIdentity: object | undefined;
    }
  | { kind: 'load'; intent: WorkspaceLoadOriginIntent }
  | { kind: 'prepared'; intent: WorkspaceLoadOriginIntent }
  | {
      kind: 'preparationFailed';
      intent: WorkspaceLoadOriginIntent;
      error: unknown;
    };

export type WorkspaceOriginReduxContext<State> = {
  getState(): State;
  dispatch: StoreDispatch;
  subscribe(callback: () => void): () => void;
};
