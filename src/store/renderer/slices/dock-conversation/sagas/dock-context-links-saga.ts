import { buffers } from 'redux-saga';
import {
  actionChannel,
  call,
  fork,
  put,
  take,
  takeEvery,
  takeLatest,
  type SagaGenerator,
} from 'typed-redux-saga';
import { takeLatestFromSelector } from '@themislib/themis/saga';
import { store as appStore } from '../../../store';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  contextAsShortcut,
  defaultDockContextLinkKey,
  dockContextLinkKeys,
  dockContextStorageKey,
  isDockForegroundObservation,
  parseDockContextPreferences,
  type DockForegroundObservation,
  type DockContextLinkPreferences,
  type DockLinkedContextSnapshot,
} from '$shared/dock-context-links';
import type { DockServiceOwner } from '$shared/dock-shortcuts';
import {
  getPrincipalActionContext,
  getPrincipalDraftProvenance,
} from '../../principal/principal-context';
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
import { selectWorkspaceListLoadedForBackend } from '../../workspace/workspace-selectors';
import {
  scriptSnapshotReceived,
  updateRuntimeState,
  removeScript,
} from '../../scripts/scripts-slice';
import { getLocalStorageJSON, setLocalStorageJSON } from '../../../utils/safe-local-storage-saga';
import { takeEveryFromElectronChannel } from '../../../utils/ipc-channel';
import { selectDockShortcutWorkspaces } from '../dock-conversation-selectors';
import {
  dockLinkedContextChanged,
  dockContextObservationReceived,
  dockContextRefreshRequested,
  dockContextServiceReceived,
  dockContextLinkRequested,
  dockContextUnlinkRequested,
  dockContextFollowed,
  dockContextDismissed,
  dockContextAutoDecisionRequested,
} from '../dock-conversation-slice';
import { findDockService, isDockServiceCurrent } from './dock-service-routing';

/** One canonical principal-scoped format, also consumed by global shortcut routing. */
export function* readDockSavedLinks(): SagaGenerator<Record<string, string>> {
  const authority = getPrincipalActionContext(appStore.state),
    provenance = getPrincipalDraftProvenance(appStore.state);
  if (!authority || !provenance) return {};
  const value = yield* call(getLocalStorageJSON, dockContextStorageKey(provenance));
  if (authority !== getPrincipalActionContext(appStore.state)) return {};
  return Object.fromEntries(
    Object.entries(parseDockContextPreferences(value).links).map(([key, row]) => [
      key,
      row.workspaceId,
    ]),
  );
}
const selectContextWorkspaces = appStore.createSelector((state) =>
  JSON.stringify([
    selectWorkspaceListLoadedForBackend.select(state, state.connections.windowBackendId),
    selectDockShortcutWorkspaces
      .select(state)
      .map((row) => String(row.id))
      .sort(),
  ]),
);
type Request =
  | ReturnType<typeof dockContextObservationReceived>
  | ReturnType<typeof dockContextRefreshRequested>
  | ReturnType<typeof dockContextServiceReceived>
  | ReturnType<typeof dockContextLinkRequested>
  | ReturnType<typeof dockContextUnlinkRequested>
  | ReturnType<typeof dockContextFollowed>
  | ReturnType<typeof dockContextDismissed>
  | ReturnType<typeof dockContextAutoDecisionRequested>;

export function* dockContextLinksSaga(): SagaGenerator<void> {
  let observation: DockForegroundObservation | null = null;
  let authority: string | null = null,
    provenance: string | null = null;
  let preferences: DockContextLinkPreferences = { version: 1, links: {} };
  let owned: { version: string; authority: string; service: DockServiceOwner } | null = null;
  const dismissed = new Set<string>();
  let storageError: 'storage-unavailable' | null = null;
  const requests = yield* actionChannel(
    [
      dockContextObservationReceived,
      dockContextRefreshRequested,
      dockContextServiceReceived,
      dockContextLinkRequested,
      dockContextUnlinkRequested,
      dockContextFollowed,
      dockContextDismissed,
      dockContextAutoDecisionRequested,
    ],
    buffers.expanding(),
  );
  function admitted(value: DockForegroundObservation | null) {
    return (
      value &&
      value.backendId === appStore.state.connections.windowBackendId &&
      authority &&
      authority === getPrincipalActionContext(appStore.state)
    );
  }
  function version(value: DockForegroundObservation) {
    return JSON.stringify([authority, value.contextVersion]);
  }
  function* receive(value: unknown): SagaGenerator<void> {
    if (
      !isDockForegroundObservation(value) ||
      value.backendId !== appStore.state.connections.windowBackendId ||
      value.self
    )
      return;
    if (observation?.backendId === value.backendId && observation.sequence >= value.sequence)
      return;
    observation = value;
    yield* put(dockContextObservationReceived(value));
  }
  function* refresh(reason: 'authority' | 'workspaces' | 'services'): SagaGenerator<void> {
    yield* put(dockContextRefreshRequested(reason));
  }
  function* enrich(): SagaGenerator<void> {
    const value = observation,
      context = getPrincipalActionContext(appStore.state);
    if (
      !value ||
      !context ||
      value.backendId !== appStore.state.connections.windowBackendId ||
      !value.url ||
      value.workspaceId ||
      !selectWorkspaceListLoadedForBackend.select(appStore.state, value.backendId)
    )
      return;
    const service = yield* call(
      findDockService,
      contextAsShortcut(value),
      selectDockShortcutWorkspaces.select(appStore.state).map((row) => String(row.id)),
    );
    if (observation !== value || context !== getPrincipalActionContext(appStore.state)) return;
    if (service && !(yield* call(isDockServiceCurrent, service))) return;
    if (observation !== value || context !== getPrincipalActionContext(appStore.state)) return;
    yield* put(dockContextServiceReceived(value.contextVersion, context, service));
  }
  function* save(next: DockContextLinkPreferences): SagaGenerator<boolean> {
    if (!provenance || authority !== getPrincipalActionContext(appStore.state)) return false;
    const key = dockContextStorageKey(provenance),
      owner = authority;
    yield* call(setLocalStorageJSON, key, next);
    const confirmed = yield* call(getLocalStorageJSON, key);
    if (owner !== getPrincipalActionContext(appStore.state)) return false;
    if (JSON.stringify(parseDockContextPreferences(confirmed)) !== JSON.stringify(next)) {
      storageError = 'storage-unavailable';
      return false;
    }
    storageError = null;
    preferences = next;
    return true;
  }
  function* publish(): SagaGenerator<void> {
    const value = observation;
    if (!admitted(value) || !value) {
      yield* put(dockLinkedContextChanged(null, null));
      return;
    }
    const loaded = selectWorkspaceListLoadedForBackend.select(appStore.state, value.backendId);
    const ids = selectDockShortcutWorkspaces.select(appStore.state).map((row) => String(row.id));
    const key = loaded
      ? dockContextLinkKeys(value, preferences).find((key) =>
          ids.includes(preferences.links[key].workspaceId),
        )
      : undefined;
    const record = key ? preferences.links[key] : null;
    const service =
      owned?.version === value.contextVersion && owned.authority === authority
        ? owned.service
        : null;
    const inferred = value.workspaceId ?? service?.workspaceId;
    const destination =
      record?.workspaceId ?? (inferred && ids.includes(inferred) && loaded ? inferred : null);
    let label = value.appName ?? '';
    if (value.url)
      try {
        label = new URL(value.url).hostname;
      } catch {
        /* Unknown remains app-only. */
      }
    const snapshot: DockLinkedContextSnapshot = {
      contextVersion: version(value),
      identityKey: value.identityKey,
      identityKind: value.identityKind,
      phase: value.identityKind === 'unknown' ? 'unavailable' : 'ready',
      label,
      icon: value.icon,
      url: value.url,
      appId: value.appId,
      linkable: loaded && !!defaultDockContextLinkKey(value),
      linkedWorkspaceId: destination,
      linkKey: key ?? null,
      linkRevision: record?.revision ?? 0,
      policy: record?.policy ?? { follows: 0, decision: 'unasked' },
      dismissed: dismissed.has(JSON.stringify([value.identityKey, record?.revision ?? 0])),
      // Desktop-app auto-switch remains a separate capability pending the product decision.
      autoSwitchEligible:
        !!record && value.identityKind !== 'app' && value.identityKind !== 'unknown',
      error: storageError,
    };
    yield* put(dockLinkedContextChanged(snapshot, authority));
  }
  yield* takeEveryFromElectronChannel<DockForegroundObservation>(
    IPC_CHANNELS.DOCK_CONTEXT.CHANGED,
    receive,
  );
  yield* takeLatestFromSelector(selectPrincipalActionContext, function* () {
    yield* refresh('authority');
  });
  yield* takeLatestFromSelector(selectContextWorkspaces, function* () {
    yield* refresh('workspaces');
  });
  yield* takeEvery([scriptSnapshotReceived, updateRuntimeState, removeScript], function* () {
    yield* refresh('services');
  });
  yield* takeLatest([dockContextObservationReceived, dockContextRefreshRequested], enrich);
  yield* fork(function* (): SagaGenerator<void> {
    if (typeof window === 'undefined' || !window.electronAPI) return;
    if (document.readyState !== 'complete')
      yield* call(
        () =>
          new Promise<void>((resolve) =>
            window.addEventListener('load', () => resolve(), { once: true }),
          ),
      );
    try {
      const value = yield* call(() => window.electronAPI.invoke(IPC_CHANNELS.DOCK_CONTEXT.GET, {}));
      yield* receive(value);
    } catch {
      /* Unknown native context stays unknown. */
    }
  });
  try {
    while (true) {
      const action = (yield* take(requests)) as Request;
      const nextAuthority = getPrincipalActionContext(appStore.state),
        nextProvenance = getPrincipalDraftProvenance(appStore.state);
      if (authority !== nextAuthority || provenance !== nextProvenance) {
        authority = nextAuthority;
        provenance = nextProvenance;
        owned = null;
        dismissed.clear();
        storageError = null;
        preferences =
          authority && provenance
            ? parseDockContextPreferences(
                yield* call(getLocalStorageJSON, dockContextStorageKey(provenance)),
              )
            : { version: 1, links: {} };
      }
      if (action.type === dockContextRefreshRequested.type && action.payload[0] === 'services')
        owned = null;
      if (action.type === dockContextServiceReceived.type) {
        const [entry, owner, service] = (action as ReturnType<typeof dockContextServiceReceived>)
          .payload;
        if (service && observation?.contextVersion === entry && authority === owner)
          owned = { version: entry, authority: owner, service };
        else if (observation?.contextVersion === entry && authority === owner) owned = null;
      }
      if (!admitted(observation) || !observation) {
        yield* publish();
        continue;
      }
      const ids = selectDockShortcutWorkspaces.select(appStore.state).map((row) => String(row.id));
      const loaded = selectWorkspaceListLoadedForBackend.select(
        appStore.state,
        observation.backendId,
      );
      if (loaded) {
        const links = Object.fromEntries(
          Object.entries(preferences.links).filter(([, row]) => ids.includes(row.workspaceId)),
        );
        if (Object.keys(links).length !== Object.keys(preferences.links).length)
          yield* save({ version: 1, links });
      }
      if (
        [
          dockContextLinkRequested.type,
          dockContextUnlinkRequested.type,
          dockContextFollowed.type,
          dockContextDismissed.type,
          dockContextAutoDecisionRequested.type,
        ].includes(action.type)
      ) {
        const value = observation,
          basedOn = action.payload[0];
        if (
          !loaded ||
          basedOn !== version(value) ||
          authority !== getPrincipalActionContext(appStore.state)
        )
          continue;
        const keys = dockContextLinkKeys(value, preferences),
          matched = keys[0];
        const record = matched ? preferences.links[matched] : null;
        if (action.type === dockContextDismissed.type)
          dismissed.add(JSON.stringify([value.identityKey, record?.revision ?? 0]));
        else if (
          action.type === dockContextLinkRequested.type ||
          action.type === dockContextUnlinkRequested.type
        ) {
          const links = { ...preferences.links };
          for (const key of keys) delete links[key];
          if (action.type === dockContextLinkRequested.type) {
            const [, workspaceId] = (action as ReturnType<typeof dockContextLinkRequested>).payload;
            const key = defaultDockContextLinkKey(value);
            if (!key || !ids.includes(workspaceId)) continue;
            links[key] = {
              workspaceId,
              revision: Math.max(
                Date.now(),
                ...Object.values(preferences.links).map((row) => row.revision + 1),
              ),
              policy: { follows: 0, decision: 'unasked' },
            };
          }
          if (yield* save({ version: 1, links }))
            for (const item of dismissed)
              if (JSON.parse(item)[0] === value.identityKey) dismissed.delete(item);
        } else if (record && matched) {
          const policy = { ...record.policy };
          if (action.type === dockContextFollowed.type)
            policy.follows = Math.min(2, policy.follows + 1);
          else if (policy.follows >= 2 && policy.decision === 'unasked')
            policy.decision = (
              action as ReturnType<typeof dockContextAutoDecisionRequested>
            ).payload[1];
          yield* save({
            version: 1,
            links: { ...preferences.links, [matched]: { ...record, policy } },
          });
        }
      }
      yield* publish();
    }
  } finally {
    requests.close();
    yield* put(dockLinkedContextChanged(null, null));
  }
}
