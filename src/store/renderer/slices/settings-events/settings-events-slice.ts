/**
 * Settings events and mount-scoped, correlated settings-form outcomes.
 *
 * Holds the typed FE action that mirrors the daemon's `settings:changed`
 * notification (PROTOCOL §6.5). The boot-hydration service and the daemon
 * events bridge both dispatch this action so panels can observe BE-owned
 * settings changes without polling. Form state is transient: closing a form
 * removes its snapshot and makes late acknowledgements inert.
 */
import { createAction } from '@augmentcode/themis/utils/store/create-action';
import type { AppliedSettingChange } from '$lib/client/app-client';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import {
  createCollection,
  getItem,
  upsertItem,
  removeItem,
} from '@augmentcode/themis/utils/collections/collection-utils';
import type {
  SettingsEventsState,
  SettingsForm,
  SettingsFormChange,
  SettingsFormEntry,
  SettingsFormIdentity,
  SettingsFormKind,
  SettingsFormOperation,
  SettingsFormOutcome,
  SettingsFormRequest,
  SettingsFormValue,
} from './settings-events-types';

/**
 * Typed counterpart to the wire `settings:changed` event (§6.5). The payload
 * mirrors `data.changes` on the daemon notification — an applied
 * `{ path, value }` list with sensitive values pre-redacted by the BE. Boot
 * hydration synthesizes the action from the full `settings.list()` snapshot so
 * panels see one consistent action regardless of source.
 */
export const settingsChanged = createAction<[changes: AppliedSettingChange[]]>('settings/changed');

/** Raw daemon notification routed by daemonEventsSaga and consumed in order. */
export const settingsChangesReceived = createAction<
  [changes: AppliedSettingChange[], revision?: number]
>('settings/changesReceived');

export const settingsFormOpened =
  createAction<[identity: SettingsFormIdentity, kind: SettingsFormKind]>('settings/formOpened');
export const settingsFormClosed =
  createAction<[identity: SettingsFormIdentity]>('settings/formClosed');
export const settingsFormRequestStarted = createAction<[request: SettingsFormRequest]>(
  'settings/formRequestStarted',
);
export const settingsFormRequestSettled = createAction<
  [request: SettingsFormRequest, outcome: SettingsFormOutcome]
>('settings/formRequestSettled');
export const settingsFormRequestProgressed = createAction<
  [request: SettingsFormRequest, values: Record<string, SettingsFormValue>]
>('settings/formRequestProgressed');
export const settingsFormLoadRequested = createAction<[request: SettingsFormRequest]>(
  'settings/formLoadRequested',
);
export const settingsFormSaveRequested = createAction<
  [request: SettingsFormRequest, changes: SettingsFormChange[]]
>('settings/formSaveRequested');
export const settingsFormSaveQueueFailed = createAction<
  [request: SettingsFormRequest, paths: string[], error: string]
>('settings/formSaveQueueFailed');
export const settingsFormDraftChanged = createAction<
  [identity: SettingsFormIdentity, path: string, value: SettingsFormValue]
>('settings/formDraftChanged');
export const settingsFormEntriesReceived = createAction<
  [
    identity: SettingsFormIdentity,
    entries: SettingsFormEntry[],
    values?: Record<string, SettingsFormValue>,
  ]
>('settings/formEntriesReceived');

export const settingsEventsReducer = createReducer<SettingsEventsState>({
  forms: createCollection<SettingsForm, 'formId'>('formId'),
});

settingsEventsReducer.with(settingsFormOpened, (state, { payload: [identity, kind] }) => ({
  ...state,
  forms: upsertItem(state.forms, {
    ...identity,
    kind,
    entries: createCollection<SettingsFormEntry, 'path'>('path'),
    operations: createCollection<SettingsFormOperation, 'resource'>('resource'),
    values: {},
    drafts: {},
    mutationVersion: 0,
    readVersion: 0,
    loaded: false,
  }),
}));

settingsEventsReducer.with(settingsFormClosed, (state, { payload: [identity] }) => {
  const form = getItem(state.forms, identity.formId);
  if (form?.sessionId !== identity.sessionId) return state;
  return { ...state, forms: removeItem(state.forms, identity.formId) };
});

function startRequest(
  state: SettingsEventsState,
  request: SettingsFormRequest,
  changes: SettingsFormChange[] = [],
  requiresLoaded = false,
) {
  const form = getItem(state.forms, request.formId);
  if (form?.sessionId !== request.sessionId) return state;
  const previous = getItem(form.operations, request.resource);
  if (
    form.kind === 'agent-backend' &&
    previous?.status === 'pending' &&
    changes.length > 0 &&
    Object.keys(previous.submittedValues ?? {}).length === changes.length &&
    changes.every(({ path, value }) => previous.submittedValues?.[path] === value)
  )
    return state;
  return {
    ...state,
    forms: upsertItem(state.forms, {
      ...form,
      ...(request.resource === 'load'
        ? { readVersion: form.mutationVersion }
        : (requiresLoaded && !form.loaded) ||
            (form.kind === 'websocket-api' &&
              (request.resource === 'copy' || request.resource === 'qr'))
          ? {}
          : { mutationVersion: form.mutationVersion + 1 }),
      operations: upsertItem(form.operations, {
        resource: request.resource,
        requestId: request.requestId,
        status: 'pending',
        error: null,
        submittedValues: Object.fromEntries(changes.map(({ path, value }) => [path, value])),
        submittedDrafts: Object.fromEntries(
          changes
            .flatMap(({ path }) => [path, `${path}:slider`])
            .filter((path) => path in form.drafts)
            .map((path) => [path, form.drafts[path]]),
        ),
      }),
    }),
  };
}

settingsEventsReducer.with(settingsFormRequestStarted, (state, { payload: [request] }) =>
  startRequest(state, request),
);
settingsEventsReducer.with(settingsFormLoadRequested, (state, { payload: [request] }) =>
  startRequest(state, request),
);
// saveForm rejects unloaded saves. Track their outcome without invalidating the initial read.
settingsEventsReducer.with(settingsFormSaveRequested, (state, { payload: [request, changes] }) =>
  startRequest(state, request, changes, true),
);

settingsEventsReducer.with(
  settingsFormSaveQueueFailed,
  (state, { payload: [request, paths, error] }) => {
    const form = getItem(state.forms, request.formId);
    if (form?.sessionId !== request.sessionId || form.kind !== 'agent-backend') return state;
    const operation = getItem(form.operations, request.resource);
    if (operation?.status !== 'pending') return state;
    const drafts = { ...form.drafts };
    for (const path of paths) {
      delete drafts[path];
      delete drafts[`${path}:slider`];
    }
    return {
      ...state,
      forms: upsertItem(state.forms, {
        ...form,
        drafts,
        operations: upsertItem(form.operations, { ...operation, status: 'failed', error }),
      }),
    };
  },
);

settingsEventsReducer.with(
  settingsFormDraftChanged,
  (state, { payload: [identity, path, value] }) => {
    const form = getItem(state.forms, identity.formId);
    if (form?.sessionId !== identity.sessionId || form.drafts[path] === value) return state;
    return {
      ...state,
      forms: upsertItem(state.forms, { ...form, drafts: { ...form.drafts, [path]: value } }),
    };
  },
);

settingsEventsReducer.with(
  settingsFormEntriesReceived,
  (state, { payload: [identity, incoming, values] }) => {
    const form = getItem(state.forms, identity.formId);
    if (form?.sessionId !== identity.sessionId) return state;
    let entries = form.entries;
    for (const entry of incoming) entries = upsertItem(entries, entry);
    if (entries === form.entries && !values) return state;
    return {
      ...state,
      forms: upsertItem(state.forms, { ...form, entries, values: { ...form.values, ...values } }),
    };
  },
);

settingsEventsReducer.with(
  settingsFormRequestProgressed,
  (state, { payload: [request, values] }) => {
    const form = getItem(state.forms, request.formId);
    if (form?.sessionId !== request.sessionId) return state;
    const operation = getItem(form.operations, request.resource);
    if (operation?.requestId !== request.requestId || operation.status !== 'pending') return state;
    if (request.resource === 'load' && form.readVersion !== form.mutationVersion) return state;
    return {
      ...state,
      forms: upsertItem(state.forms, { ...form, values: { ...form.values, ...values } }),
    };
  },
);

settingsEventsReducer.with(settingsFormRequestSettled, (state, { payload: [request, outcome] }) => {
  const form = getItem(state.forms, request.formId);
  if (form?.sessionId !== request.sessionId) return state;
  const operation = getItem(form.operations, request.resource);
  if (operation?.requestId !== request.requestId || operation.status !== 'pending') return state;
  const staleRead = request.resource === 'load' && form.readVersion !== form.mutationVersion;
  let entries = form.entries;
  if (!staleRead) {
    for (const entry of outcome.entries ?? []) entries = upsertItem(entries, entry);
  }
  const drafts = { ...form.drafts };
  if (outcome.status === 'succeeded' || form.kind !== 'git-workspace') {
    for (const [path, value] of Object.entries(operation.submittedDrafts ?? {})) {
      if (drafts[path] === value) delete drafts[path];
    }
  }
  return {
    ...state,
    forms: upsertItem(state.forms, {
      ...form,
      entries,
      drafts,
      values: staleRead ? form.values : { ...form.values, ...outcome.values },
      loaded: form.loaded || (request.resource === 'load' && outcome.status === 'succeeded'),
      operations: upsertItem(form.operations, {
        ...operation,
        status: outcome.status,
        error: outcome.error ?? null,
      }),
    }),
  };
});
