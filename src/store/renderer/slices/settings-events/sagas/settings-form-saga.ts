import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { captureSettingsWork } from '$features/settings/settings-recovery-lifetime';
import { collaborationMachineNameClient } from '$lib/components/settings/collaboration-machine-name.client';
import { validCollaborationMachineName } from '$shared/collaboration-machine-name';
import { all, call, cancelled, put, race, take, type SagaGenerator } from 'typed-redux-saga';
import { takeEveryByContextFIFO, takeLatestInContext } from '../../../utils/context-saga-effects';
import { appClient } from '$lib/client';
import type { SettingDefinitionWithValue } from '$lib/client/app-client';
import { notify } from '$lib/components/patterns/notify';
import { m } from '$shared/paraglide/messages.js';
import {
  settingsFormPaths as paths,
  isSettingsFormValue as isValue,
  catalogEntry,
} from '../settings-form-catalog';
import { refreshAutoCommitSettings } from '../../workspace-settings/workspace-settings-slice';
import {
  selectSettingsForm,
  selectSettingsFormEntry,
  selectSettingsFormRequestCurrent,
} from '../settings-events-selectors';
import {
  settingsFormClosed,
  settingsFormEntriesReceived,
  settingsFormLoadRequested,
  settingsFormRequestSettled,
  settingsFormSaveRequested,
  settingsFormSaveQueueFailed,
} from '../settings-events-slice';
import type {
  SettingsFormEntry,
  SettingsFormKind,
  SettingsFormRequest,
  SettingsFormValue,
} from '../settings-events-types';

function loadError(kind: SettingsFormKind, error: string) {
  switch (kind) {
    case 'collaboration-machine-name':
      return m.settings_machineName_load_error();
    case 'agent-backend':
      return m.settings_agentBackend_loadError();
    case 'git-workspace':
      return m.settings_gitWorkspace_loadError();
    case 'agent-features':
      return m.settings_agentFeatures_loadError({ error });
    default:
      return m.settings_workspaceApi_loadError({ error });
  }
}

function saveError(kind: SettingsFormKind, resource: string, error: string, rollback: boolean) {
  if (kind === 'collaboration-machine-name') return m.settings_machineName_save_error();
  if (kind === 'agent-backend') return m.settings_agentBackend_saveError();
  if (kind === 'git-workspace') return m.settings_gitWorkspace_saveError();
  if (kind === 'agent-features')
    return rollback
      ? m.settings_agentFeatures_rollbackError()
      : m.settings_agentFeatures_saveError({ error });
  if (rollback) {
    switch (resource) {
      case 'workspaceApi.toonOutput':
        return m.settings_workspaceApi_toonOutput_rollbackError();
      case 'workspaceApi.maxOutputChars':
        return m.settings_workspaceApi_maxOutputChars_rollbackError();
      case 'agents.historyReplayToolContentChars':
        return m.settings_workspaceApi_replayChars_rollbackError();
      default:
        return m.settings_workspaceApi_retentionDays_rollbackError();
    }
  }
  return resource === 'workspaceApi.toonOutput'
    ? m.settings_workspaceApi_toonOutput_error({ error })
    : m.settings_workspaceApi_saveError({ error });
}

function savedMessage(resource: string) {
  switch (resource) {
    case 'workspaceApi.maxOutputChars':
      return m.settings_workspaceApi_maxOutputChars_saved();
    case 'agents.historyReplayToolContentChars':
      return m.settings_workspaceApi_replayChars_saved();
    case 'agents.toolPayloadRetentionDays':
      return m.settings_workspaceApi_retentionDays_saved();
    default:
      return null;
  }
}

function* optionalSetting(path: string): SagaGenerator<SettingDefinitionWithValue | null> {
  try {
    return yield* call([appClient.settings, appClient.settings.get], path);
  } catch {
    return null;
  }
}

function* loadForm(request: SettingsFormRequest): SagaGenerator<void> {
  const work = captureSettingsWork();
  if (!work.isSameScope()) {
    yield* put(settingsFormRequestSettled(request, { status: 'cancelled' }));
    return;
  }

  const form = yield* selectSettingsForm.effect(request);
  if (!form || !(form.kind in paths) || !(yield* selectSettingsFormRequestCurrent.effect(request)))
    return;
  const wanted = paths[form.kind as keyof typeof paths];
  try {
    let settings: SettingDefinitionWithValue[];
    if (form.kind === 'collaboration-machine-name') {
      const result = yield* call(collaborationMachineNameClient.read);
      if (!work.isSameScope()) return;
      if (!(yield* selectSettingsFormRequestCurrent.effect(request))) return;
      yield* put(
        settingsFormRequestSettled(request, {
          status: 'succeeded',
          entries: [{ path: 'sharing.machineName', value: result.name }],
          values: { fallback: result.fallback },
        }),
      );
      return;
    }
    if (form.kind === 'agent-backend' && typeof appClient.settings.get === 'function') {
      const entries = yield* all(
        wanted.map((path) =>
          path === 'agents.maxConcurrent'
            ? call([appClient.settings, appClient.settings.get], path)
            : call(optionalSetting, path),
        ),
      );
      if (!work.isSameScope()) return;
      if (!entries[0]) throw new Error('Settings unavailable');
      settings = entries.filter((entry): entry is SettingDefinitionWithValue => entry !== null);
    } else {
      settings = yield* call([appClient.settings, appClient.settings.list]);
      if (!work.isSameScope()) return;
      if (settings.length === 0) throw new Error('Settings unavailable');
    }
    const values: Record<string, SettingsFormValue> = {};
    if (form.kind === 'git-workspace') {
      const caps = yield* call([appClient.system, appClient.system.capabilities]);
      if (!work.isSameScope()) return;
      values.cowSupported = caps.cowSupported === true;
    }
    const currentForm = yield* selectSettingsForm.effect(request);
    const entries = settings
      .filter((entry) => wanted.includes(entry.path))
      .map((entry) => {
        const current = currentForm && getItem(currentForm.entries, entry.path);
        return current && current !== getItem(form.entries, entry.path)
          ? current
          : catalogEntry(entry);
      });
    if (form.kind === 'agent-backend') {
      for (const entry of entries)
        values[`${entry.path}:loadedValue`] = entry.value ?? entry.defaultValue ?? 0;
      const idle = entries.find(({ path }) => path === 'agents.idleReapMinutes');
      values.idleReapResumeMinutes =
        typeof idle?.value === 'number' && idle.value > 0
          ? idle.value
          : typeof idle?.defaultValue === 'number' && idle.defaultValue > 0
            ? idle.defaultValue
            : 1;
    }
    yield* put(settingsFormRequestSettled(request, { status: 'succeeded', entries, values }));
  } catch (error) {
    if (!work.isSameScope()) return;
    if (!(yield* selectSettingsFormRequestCurrent.effect(request))) return;
    const message = loadError(form.kind, error instanceof Error ? error.message : String(error));
    yield* put(settingsFormRequestSettled(request, { status: 'failed', error: message }));
    if (form.kind === 'agent-features' || form.kind === 'workspace-api')
      yield* call(notify.error, message);
    if (!work.isSameScope()) return;
  } finally {
    if ((yield* cancelled()) || !work.isSameScope())
      yield* put(settingsFormRequestSettled(request, { status: 'cancelled' }));
  }
}

function* waitForClose(request: SettingsFormRequest): SagaGenerator<void> {
  while (true) {
    const {
      payload: [identity],
    } = yield* take(settingsFormClosed);
    if (identity.formId === request.formId && identity.sessionId === request.sessionId) return;
  }
}

function* readForm(action: ReturnType<typeof settingsFormLoadRequested>): SagaGenerator<void> {
  const [request] = action.payload;
  yield* race({
    read: call(loadForm, request),
    closed: call(waitForClose, request),
  });
}

type SaveAction = ReturnType<typeof settingsFormSaveRequested>;

function* saveForm(action: SaveAction): SagaGenerator<void> {
  const [request, changes] = action.payload;
  const work = captureSettingsWork();
  if (!work.isCurrent()) {
    yield* put(settingsFormRequestSettled(request, { status: 'cancelled' }));
    return;
  }

  const form = yield* selectSettingsForm.effect(request);
  if (!form || !(yield* selectSettingsFormRequestCurrent.effect(request))) return;
  if (!form.loaded) {
    yield* put(
      settingsFormRequestSettled(request, { status: 'failed', error: loadError(form.kind, '') }),
    );
    return;
  }
  try {
    if (
      form.kind === 'collaboration-machine-name' &&
      (changes.length !== 1 ||
        changes[0].path !== 'sharing.machineName' ||
        typeof changes[0].value !== 'string' ||
        !validCollaborationMachineName(changes[0].value))
    ) {
      yield* put(
        settingsFormRequestSettled(request, {
          status: 'failed',
          error: m.settings_machineName_invalid_error(),
        }),
      );
      return;
    }
    const applied =
      form.kind === 'collaboration-machine-name'
        ? [
            {
              path: 'sharing.machineName',
              value: yield* call(collaborationMachineNameClient.save, String(changes[0].value)),
            },
          ]
        : yield* call([appClient.settings, appClient.settings.update], changes);
    if (!work.isCurrent()) return;
    if (
      form.kind === 'collaboration-machine-name' &&
      !(yield* selectSettingsFormRequestCurrent.effect(request))
    )
      return;
    const entries: SettingsFormEntry[] = [];
    const values: Record<string, SettingsFormValue> = {};
    let rollback = false;
    for (const change of changes) {
      const entry = applied.find((entry) => entry.path === change.path);
      const previous = yield* selectSettingsFormEntry.effect(request, change.path);
      if (form.kind === 'agent-backend') {
        const value =
          change.path === 'agents.maxConcurrent' && !entry ? change.value : entry?.value;
        const valid = typeof value === 'number' && Number.isFinite(value);
        if (!valid) rollback = true;
        else {
          entries.push({ ...previous, path: change.path, value: value as SettingsFormValue });
          if (change.path === 'agents.idleReapMinutes' && typeof value === 'number' && value > 0) {
            values.idleReapResumeMinutes = value;
          }
        }
      } else if (entry && isValue(entry.value))
        entries.push({ ...previous, path: change.path, value: entry.value });
      if (form.kind === 'workspace-api') {
        if (!entry || !isValue(entry.value)) rollback = true;
      }
      if (form.kind === 'agent-features' || form.kind === 'workspace-api') {
        if (entry && entry.value !== change.value) rollback = true;
      }
      if (!entry && (form.kind === 'agent-features' || form.kind === 'git-workspace')) {
        entries.push({ ...previous, ...change });
      }
    }
    yield* put(settingsFormEntriesReceived(request, entries, values));
    if (form.kind === 'git-workspace') yield* put(refreshAutoCommitSettings());
    if (rollback && form.kind === 'agent-backend') {
      yield* put(
        settingsFormSaveQueueFailed(
          request,
          changes.map(({ path }) => path),
          saveError(form.kind, request.resource, '', true),
        ),
      );
      return;
    }
    if (!(yield* selectSettingsFormRequestCurrent.effect(request))) return;
    if (rollback) {
      const error = saveError(form.kind, request.resource, '', true);
      yield* put(settingsFormRequestSettled(request, { status: 'failed', error }));
      if (form.kind === 'agent-features' || form.kind === 'workspace-api')
        yield* call(notify.error, error);
      if (!work.isCurrent()) return;
    } else {
      yield* put(settingsFormRequestSettled(request, { status: 'succeeded' }));
      const message = form.kind === 'workspace-api' ? savedMessage(request.resource) : null;
      if (message) yield* call(notify.success, message);
      if (!work.isCurrent()) return;
    }
  } catch (error) {
    if (!work.isCurrent()) return;
    if (form.kind === 'agent-backend') {
      yield* put(
        settingsFormSaveQueueFailed(
          request,
          changes.map(({ path }) => path),
          saveError(form.kind, request.resource, '', false),
        ),
      );
      return;
    }
    if (!(yield* selectSettingsFormRequestCurrent.effect(request))) return;
    const message = saveError(
      form.kind,
      request.resource,
      error instanceof Error ? error.message : String(error),
      false,
    );
    yield* put(settingsFormRequestSettled(request, { status: 'failed', error: message }));
    if (form.kind === 'agent-features' || form.kind === 'workspace-api')
      yield* call(notify.error, message);
    if (!work.isCurrent()) return;
  } finally {
    if ((yield* cancelled()) || !work.isCurrent())
      yield* put(settingsFormRequestSettled(request, { status: 'cancelled' }));
  }
}

function* discardWrite(action: SaveAction): SagaGenerator<void> {
  yield* put(settingsFormRequestSettled(action.payload[0], { status: 'cancelled' }));
}

/** Composed by settingsHydrationSaga; no second root registration. */
export function* settingsFormSaga(): SagaGenerator<void> {
  yield* all([
    takeLatestInContext(settingsFormLoadRequested, (action) => action.payload[0].formId, readForm),
    takeEveryByContextFIFO(
      settingsFormSaveRequested,
      (action) => action.payload[0].resource,
      saveForm,
      {
        onDiscardPending: discardWrite,
      },
    ),
  ]);
}
