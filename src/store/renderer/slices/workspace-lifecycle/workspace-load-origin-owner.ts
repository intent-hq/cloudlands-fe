// Resource ownership only; the canonical cleanup saga owns preparation and publication.
import { workspaceLoadRequested } from './workspace-lifecycle-slice';
import type {
  WorkspaceLoadReadScope,
  WorkspaceLoadRequestLifetime,
} from './workspace-load-admission-types';
import type {
  PreparedWorkspaceLoadOrigin,
  WorkspaceLoadAction,
  WorkspaceLoadOriginIntent,
  WorkspaceLoadOriginOwner,
  WorkspaceOriginAuthority,
  WorkspaceOriginState,
} from './workspace-load-origin-types';

export function createWorkspaceLoadOriginOwner(
  readState: () => WorkspaceOriginState,
): WorkspaceLoadOriginOwner {
  let disposed = false;
  let associations = new WeakMap<WorkspaceLoadAction, WorkspaceLoadOriginIntent>();
  const entries = new Set<WorkspaceLoadOriginIntent>();
  const published = new WeakSet<WorkspaceLoadOriginIntent>();
  // Runtime resource bindings, created only for submitted accepted tab/authority pairs.
  // They are not a tab-membership mirror; every authority check reads canonical ordinals.
  type Binding = {
    serial: number;
    authority: WorkspaceOriginAuthority;
    isCurrent(): boolean;
    retire(): void;
  };
  const bindings = new Map<string, Binding>();

  function readJointIdentity(workspaceId: string): object | undefined {
    const binding = bindings.get(workspaceId);
    if (!binding) return undefined;
    if (binding.isCurrent()) return binding;
    // Retirement can synchronously submit a successor from an abort callback.
    return bindings.has(workspaceId) ? readJointIdentity(workspaceId) : undefined;
  }

  function bind(
    workspaceId: string,
    serial: number,
    authority: WorkspaceOriginAuthority,
  ): Binding | null {
    const previous = bindings.get(workspaceId);
    const previousIdentity = previous?.authority.identity;
    const authorityIdentity = authority.identity;
    const authoritySignal = authority.signal;
    const authorityAborted = authoritySignal.aborted;
    if (
      disposed ||
      authorityAborted ||
      bindings.get(workspaceId) !== previous ||
      readAcceptedSerial(workspaceId) !== serial
    )
      return null;
    if (previous?.serial === serial && previousIdentity === authorityIdentity) return previous;
    let retired = false;
    const binding: Binding = {
      serial,
      authority,
      isCurrent() {
        if (retired || disposed) return false;
        const authorityCurrent = authority.isCurrent();
        const authorityAborted = authority.signal.aborted;
        // External callbacks/getters may retire or replace us while returning true.
        const current =
          authorityCurrent &&
          !authorityAborted &&
          !retired &&
          !disposed &&
          bindings.get(workspaceId) === binding &&
          readAcceptedSerial(workspaceId) === serial;
        if (!current) binding.retire();
        return current;
      },
      retire() {
        if (retired) return;
        retired = true;
        if (bindings.get(workspaceId) === binding) bindings.delete(workspaceId);
        authoritySignal.removeEventListener('abort', binding.retire);
        for (const entry of [...entries]) if (entry.jointIdentity === binding) entry.retire();
      },
    };
    // Install successor first. Old abort/release reentrance cannot erase this slot.
    bindings.set(workspaceId, binding);
    authoritySignal.addEventListener('abort', binding.retire, { once: true });
    previous?.retire();
    return binding;
  }

  function readAcceptedSerial(workspaceId: string): number | undefined {
    const tabs = readState().tabState;
    const serials = tabs.workspaceTabAcquisitions.serialByWorkspaceId;
    if (
      !Object.hasOwn(serials, workspaceId) ||
      !Object.hasOwn(tabs.openTabs, workspaceId) ||
      tabs.openTabs[workspaceId] !== true
    )
      return undefined;
    const serial = serials[workspaceId];
    return Number.isSafeInteger(serial) && serial > 0 ? serial : undefined;
  }

  function begin(
    workspaceId: string,
    authority: WorkspaceOriginAuthority,
    expectedSerial?: number,
  ): WorkspaceLoadOriginIntent | null {
    if (disposed || authority.signal.aborted || !authority.isCurrent()) return null;
    const serial = readAcceptedSerial(workspaceId);
    if (serial === undefined || (expectedSerial !== undefined && serial !== expectedSerial))
      return null;
    const candidateBinding = bind(workspaceId, serial, authority);
    if (!candidateBinding || !candidateBinding.isCurrent()) return null;
    const binding: Binding = candidateBinding;
    const existing = [...entries].find(
      (item) => item.action.payload[0] === workspaceId && item.jointIdentity === binding,
    );
    if (existing) return existing.lifetime.isCurrent() ? existing : null;

    const controller = new AbortController();
    const identity = {};
    let retired = false;
    let prepared: PreparedWorkspaceLoadOrigin | undefined;
    let activeScope: WorkspaceLoadReadScope | undefined;
    let acquired = false;
    const action = workspaceLoadRequested(workspaceId);

    function retire() {
      if (retired) return;
      retired = true;
      entries.delete(intent);
      associations.delete(action);
      authority.signal.removeEventListener('abort', retire);
      prepared?.signal.removeEventListener('abort', retire);
      // Change ownership first; abort listeners may dispatch, release, or submit a replacement.
      controller.abort();
      activeScope?.release();
      prepared?.release();
    }
    function isCurrent() {
      if (retired) return false;
      const value = prepared;
      const preparedCurrent = !value || (value.isCurrent() && !value.signal.aborted);
      const bindingCurrent = binding.isCurrent();
      const current = preparedCurrent && bindingCurrent && !retired && prepared === value;
      if (!current) retire();
      return current;
    }
    const lifetime: WorkspaceLoadRequestLifetime = {
      identity,
      workspaceId,
      signal: controller.signal,
      isCurrent,
      acquireReadScope(context) {
        if (!isCurrent() || !prepared || acquired) return null;
        acquired = true;
        const scope = prepared.acquireReadScope(context);
        if (!scope) {
          retire();
          return null;
        }
        // Snapshot all external scope fields/callbacks BEFORE the final local ownership check.
        const workspaceClient = scope.workspaceClient;
        const appClient = scope.appClient;
        const signal = scope.signal;
        const scopeCurrent = scope.isCurrent;
        const releaseScope = scope.release;
        const requestIdentity = scope.requestIdentity;
        const scopeContext = scope.context;
        const accepted = scopeCurrent.call(scope);
        const aborted = signal.aborted;
        if (
          !accepted ||
          aborted ||
          requestIdentity !== identity ||
          scopeContext !== context ||
          !isCurrent() ||
          retired
        ) {
          releaseScope.call(scope);
          retire();
          return null;
        }
        let released = false;
        const owned: WorkspaceLoadReadScope = {
          workspaceClient,
          appClient,
          signal,
          requestIdentity,
          context: scopeContext,
          isCurrent() {
            if (released) return false;
            const scopeAccepted = scopeCurrent.call(scope);
            const requestAccepted = isCurrent();
            const scopeAborted = signal.aborted;
            return scopeAccepted && requestAccepted && !scopeAborted && !released && !retired;
          },
          release() {
            if (released) return;
            released = true;
            try {
              releaseScope.call(scope);
            } finally {
              retire();
            }
          },
        };
        activeScope = owned;
        return owned;
      },
    };
    const intent: WorkspaceLoadOriginIntent = {
      action,
      serial,
      jointIdentity: binding,
      authority,
      lifetime,
      retire,
      installPrepared(value) {
        const accepted = value.isCurrent();
        const requestIdentity = value.requestIdentity;
        const signal = value.signal;
        const aborted = signal.aborted;
        if (
          !accepted ||
          aborted ||
          requestIdentity !== identity ||
          !isCurrent() ||
          prepared ||
          retired
        ) {
          value.release();
          return false;
        }
        prepared = value;
        signal.addEventListener('abort', retire, { once: true });
        return isCurrent();
      },
      authorizePublication() {
        if (!prepared || !isCurrent()) return false;
        published.add(intent);
        return true;
      },
    };
    entries.add(intent);
    associations.set(action, intent);
    authority.signal.addEventListener('abort', retire, { once: true });
    return isCurrent() ? intent : null;
  }

  return {
    begin,
    readAcceptedSerial,
    readJointIdentity,
    captureRequest(action) {
      if (action.type !== workspaceLoadRequested.type) return null;
      const intent = associations.get(action);
      return intent &&
        published.has(intent) &&
        intent.lifetime.workspaceId === action.payload[0] &&
        intent.lifetime.isCurrent()
        ? intent.lifetime
        : null;
    },
    observeAcceptedState() {
      for (const binding of [...bindings.values()]) binding.isCurrent();
      for (const intent of [...entries]) intent.lifetime.isCurrent();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      associations = new WeakMap();
      for (const binding of [...bindings.values()]) binding.retire();
      for (const intent of [...entries]) intent.retire();
    },
  };
}
