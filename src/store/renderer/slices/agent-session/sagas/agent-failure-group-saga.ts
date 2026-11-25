/**
 * Group toasts and the "Switch all…" dialog for the agent-failure toast saga
 * (see its docblock for the grouping rule). Toast-free: bulk results show in
 * the dialog or as a short note on the group toast, never as per-agent
 * toasts.
 */
import { buffers, channel } from 'redux-saga';
import { call, delay, fork, join, put, race, take, type SagaGenerator } from 'typed-redux-saga';

import {
  classifyAgentFailure,
  failureGroupKey,
  switchRowsForMembers,
  type AgentFailureGroup,
  type FailureClassifier,
} from '$features/agent/agent-failure-groups';
import {
  getAgentFailureEntry,
  getDelegatedAgentFailureEntry,
  listDelegatedAgentFailures,
  removeAgentFailure,
  type AgentFailureEntry,
} from '$features/agent/agent-failure-registry';
import { agentClient } from '$features/agent/agent.client';
import {
  runBulkProviderSwitch,
  runBulkRetry,
  type BulkAgentOutcome,
  type BulkSwitchDeps,
  type BulkSwitchItem,
} from '$features/agent/bulk-provider-switch';
import {
  getRememberedProviderSwitch,
  PROVIDER_SWITCH_SETTINGS_PATH,
  withRememberedProviderSwitches,
  type ProviderSwitchBag,
  resolveSwitchPrefill,
  unionTargets,
} from '$features/agent/provider-switch-targets';
import { appClient } from '$lib/client';
import type { AgentFailureGroupNotifyProps } from '$lib/components/patterns/notify';
import { createLogger } from '$lib/utils/client-logger';
import { formatInteger } from '$lib/i18n/format';
import { forwardToastWhenHidden } from '$lib/utils/machine-toast-forward';
import { m } from '$shared/paraglide/messages.js';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { AgentStatus } from '$shared/types';
import { chatErrorCleared } from '../../chat-state/chat-state-slice';
import { selectIsRailMachineShown } from '../../machine-rail/machine-rail-selectors';
import { getModelsForProvider } from '../../model/model-utils';
import { selectProviderModels } from '../../model/model-selectors';
import {
  selectProviderAuthErrorMatcher,
  selectProviderAuthFailureGuidance,
  selectProviderConfigurationLabel,
  selectProviderDisplayName,
  selectTerminalLoginProviderId,
} from '../../provider-catalog/provider-catalog-selectors';
import {
  ensureWorkspaceCatalogRequested,
  workspaceCatalogReadFailed,
  workspaceCatalogReceived,
} from '../../provider-catalog/provider-catalog-slice';
import {
  selectContextQuotaRetryProviderIds,
  selectWorkspaceCatalog,
} from '../../provider-catalog/workspace-catalog-selectors';
import { selectCurrentWorkspaceTabId } from '../../tab-state/tab-state-selectors';
import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import { selectAgentSession } from '../agent-session-selectors';
import { updateSession } from '../agent-session-slice';
import {
  providerSwitchAgentSettled,
  providerSwitchDialogOpened,
  providerSwitchRowsLoaded,
  providerSwitchRunFinished,
  providerSwitchRunStarted,
} from '../../provider-switch-dialog/provider-switch-dialog-slice';
import { selectCanAdministerHost } from '../../principal/principal-selectors';
import { selectProviderSwitchDialog } from '../../provider-switch-dialog/provider-switch-dialog-selectors';
import type {
  ProviderSwitchDialogAgent,
  ProviderSwitchDialogRow,
  ProviderSwitchTargetOption,
} from '../../provider-switch-dialog/provider-switch-dialog-types';

const logger = createLogger('AgentFailureGroupSaga');

/** Members listed on the toast before "+N more". */
const TOAST_MEMBER_LINES = 3;
const ERROR_SUMMARY_MAX_CHARS = 200;
/** Wait for unopened workspaces' provider catalogs before computing targets. */
const CATALOG_WAIT_MS = 5_000;

export interface GroupToastState {
  visible: boolean;
  retrying: boolean;
  retryNote?: string;
  /** Members when the user closed the toast; it re-shows on a NEW member. */
  dismissedMembers?: Set<string>;
  announcedMembers: Set<string>;
}

export interface GroupEmitter {
  switchAll(groupKey: string): void;
  retryAll(groupKey: string): void;
  runLogin(providerId: string): void;
  close(groupKey: string): void;
}

/**
 * Members of an in-flight bulk run. They get no per-agent toast until the
 * run ends, so a group shrinking one agent at a time does not flash
 * per-agent toasts for its last member.
 */
export interface BulkHold {
  hold(agentIds: string[]): void;
  release(agentIds: string[]): void;
}

export function groupToastId(groupKey: string): string {
  return `agent-failure-group:${groupKey}`;
}

function truncate(text: string): string {
  return text.length > ERROR_SUMMARY_MAX_CHARS
    ? `${text.slice(0, ERROR_SUMMARY_MAX_CHARS - 1)}…`
    : text;
}

/** Classifier over the current store: quota from the entry, sign-in from the catalog patterns. */
export function* currentClassifier(): SagaGenerator<FailureClassifier> {
  const isAuthError = yield* selectProviderAuthErrorMatcher.effect();
  return (entry) => classifyAgentFailure(entry, isAuthError);
}

function* agentLabel(
  entry: AgentFailureEntry,
): SagaGenerator<{ name: string; workspace?: string }> {
  const session = yield* selectAgentSession.effect(entry.agentId);
  const name =
    (session?.name && session.name.length > 0 ? session.name : entry.agentName) ||
    m.agent_failureGroupToast_unknownAgent_label();
  const workspace = yield* selectWorkspaceById.effect(entry.workspaceId);
  const rawWorkspaceName = workspace?.title || workspace?.name;
  return {
    name,
    ...(typeof rawWorkspaceName === 'string' && rawWorkspaceName.length > 0
      ? { workspace: rawWorkspaceName }
      : {}),
  };
}

function* buildGroupToastProps(
  group: AgentFailureGroup,
  state: GroupToastState,
  emit: GroupEmitter,
): SagaGenerator<AgentFailureGroupNotifyProps> {
  const provider = yield* selectProviderDisplayName.effect(group.baseProviderId);
  const count = formatInteger(group.members.length);
  const title =
    group.kind === 'quota'
      ? m.agent_failureGroupToast_quotaTitle_label({ provider, count })
      : m.agent_failureGroupToast_authTitle_label({ provider, count });
  const newest = group.members[group.members.length - 1];
  const members: string[] = [];
  for (const entry of group.members.slice(0, TOAST_MEMBER_LINES)) {
    const label = yield* call(agentLabel, entry);
    members.push(label.workspace ? `${label.name} / ${label.workspace}` : label.name);
  }
  let loginCommandHint: string | undefined;
  let loginProviderId: string | null = null;
  if (group.kind === 'auth') {
    for (const entry of group.members) {
      const guidance = yield* selectProviderAuthFailureGuidance.effect(
        entry.provider,
        entry.model,
        entry.error,
      );
      if (!guidance) continue;
      loginCommandHint ??= guidance.loginCommandHint;
      const session = yield* selectAgentSession.effect(entry.agentId);
      loginProviderId = yield* selectTerminalLoginProviderId.effect(session, guidance.providerId);
      if (loginProviderId) break;
    }
  }
  const runLoginProviderId = loginProviderId;
  return {
    title,
    errorSummary: truncate(newest.error),
    members,
    moreCount: Math.max(0, group.members.length - TOAST_MEMBER_LINES),
    ...(loginCommandHint ? { loginCommandHint } : {}),
    ...(runLoginProviderId ? { onRunLogin: () => emit.runLogin(runLoginProviderId) } : {}),
    retrying: state.retrying,
    ...(state.retryNote ? { retryNote: state.retryNote } : {}),
    onSwitchAll: () => emit.switchAll(group.key),
    onRetryAll: () => emit.retryAll(group.key),
    onClose: () => emit.close(group.key),
  };
}

async function loadNotify() {
  const { notify } = await import('$lib/components/patterns/notify');
  return notify;
}

export function* dismissGroupToast(groupKey: string): SagaGenerator<void> {
  const notify = yield* call(loadNotify);
  notify.dismiss(groupToastId(groupKey));
}

export function* renderGroup(
  group: AgentFailureGroup,
  state: GroupToastState,
  emit: GroupEmitter,
): SagaGenerator<void> {
  if (state.dismissedMembers) {
    if (group.members.every((entry) => state.dismissedMembers?.has(entry.agentId))) return;
    state.dismissedMembers = undefined;
  }
  const notify = yield* call(loadNotify);
  const componentProps = yield* call(buildGroupToastProps, group, state, emit);
  const currentWorkspaceId = yield* selectCurrentWorkspaceTabId.effect();
  const machineShown = yield* selectIsRailMachineShown.effect();
  const elsewhere = group.members.some(
    (entry) => !machineShown || entry.workspaceId !== currentWorkspaceId,
  );
  if (!elsewhere) {
    if (state.visible) notify.dismiss(groupToastId(group.key));
    state.visible = false;
    return;
  }
  const announce = group.members.some((entry) => !state.announcedMembers.has(entry.agentId));
  state.announcedMembers = new Set(group.members.map((entry) => entry.agentId));
  if (announce) forwardToastWhenHidden('error', componentProps.title);
  notify.agentFailureGroup(componentProps, {
    id: groupToastId(group.key),
    duration: Number.POSITIVE_INFINITY,
  });
  state.visible = true;
}

export function closeGroupToastState(group: AgentFailureGroup | undefined, state: GroupToastState) {
  state.dismissedMembers = new Set(group?.members.map((entry) => entry.agentId) ?? []);
  state.visible = false;
}

const bulkDeps: Pick<BulkSwitchDeps, 'setModel' | 'retry'> = {
  async setModel(agentId, modelId, workspaceId, providerId) {
    const result = await agentClient.setModel(agentId, modelId, workspaceId, providerId);
    if (!result.ok) return { ok: false, error: result.error };
    if (!result.data.success) {
      return {
        ok: false,
        error: result.data.error ?? m.agent_chatSend_retryProviderSwitchRejected_error(),
      };
    }
    return { ok: true };
  },
  async retry(agentId, workspaceId) {
    return appClient.agents.retry(agentId, workspaceId);
  },
};

/** Drop a restarted or deleted agent's entry, unless it re-failed meanwhile. */
function settleEntry(outcome: BulkAgentOutcome, snapshots: Map<string, AgentFailureEntry>) {
  if (outcome.status !== 'switched' && outcome.status !== 'retried' && outcome.status !== 'gone') {
    return;
  }
  const snapshot = snapshots.get(outcome.agentId);
  if (snapshot && getAgentFailureEntry(outcome.agentId) === snapshot) {
    removeAgentFailure(outcome.agentId);
  }
}

/** Clear the chat error of restarted agents, as `redriveRequeuedTurn` does. */
function* convergeRestarted(outcomes: BulkAgentOutcome[]): SagaGenerator<void> {
  for (const outcome of outcomes) {
    if (outcome.status === 'gone') {
      yield* put(chatErrorCleared(outcome.agentId));
      continue;
    }
    if (outcome.status !== 'switched' && outcome.status !== 'retried') continue;
    yield* put(chatErrorCleared(outcome.agentId));
    yield* put(
      updateSession(outcome.agentId, {
        status: outcome.redriven === false ? AgentStatus.RuntimeIdle : AgentStatus.Pending,
        stopReason: null,
      }),
    );
  }
}

/** "Retry all" from the group toast: `agent.retry` per member, no provider change. */
export function* retryAllFromToast(
  group: AgentFailureGroup,
  state: GroupToastState,
  bulkHold: BulkHold,
): SagaGenerator<void> {
  if (state.retrying) return;
  state.retrying = true;
  state.retryNote = undefined;
  const memberIds = group.members.map((entry) => entry.agentId);
  bulkHold.hold(memberIds);
  const snapshots = new Map(group.members.map((entry) => [entry.agentId, entry]));
  try {
    const outcomes = yield* call(
      runBulkRetry,
      group.members.map(({ agentId, workspaceId }) => ({ agentId, workspaceId })),
      {
        retry: bulkDeps.retry,
        onAgentDone: (outcome: BulkAgentOutcome) => settleEntry(outcome, snapshots),
      },
    );
    yield* call(convergeRestarted, outcomes);
    const failed = outcomes.filter((outcome) => outcome.status === 'failed').length;
    if (failed > 0) {
      state.retryNote =
        failed === 1
          ? m.agent_failureGroupToast_retryAllFailed_one({ count: formatInteger(failed) })
          : m.agent_failureGroupToast_retryAllFailed_many({ count: formatInteger(failed) });
    }
  } finally {
    state.retrying = false;
    bulkHold.release(memberIds);
  }
}

function catalogContext(workspaceId: string): string | undefined {
  return workspaceId === CHIEF_WORKSPACE_ID ? undefined : workspaceId;
}

/** Ask for unopened workspaces' provider catalogs and wait briefly for them. */
function* ensureCatalogs(workspaceIds: string[]): SagaGenerator<void> {
  const pending = new Set<string>();
  for (const id of workspaceIds) {
    if (!(yield* selectWorkspaceCatalog.effect(id))) pending.add(id);
  }
  for (const id of pending) yield* put(ensureWorkspaceCatalogRequested(id));
  const deadline = Date.now() + CATALOG_WAIT_MS;
  while (pending.size > 0) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const { action } = yield* race({
      action: take([workspaceCatalogReceived, workspaceCatalogReadFailed]),
      timeout: delay(remaining),
    });
    if (!action) break;
    pending.delete((action as { payload: [string] }).payload[0]);
  }
}

/**
 * Read the remembered choices. An older daemon without the setting, or a
 * failed read, gives an empty bag: the dialog falls back to default prefills.
 */
async function readProviderSwitchBag(): Promise<ProviderSwitchBag | null> {
  try {
    const setting = await appClient.settings.get(PROVIDER_SWITCH_SETTINGS_PATH);
    const value = setting?.value;
    if (setting === null) return null;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as ProviderSwitchBag)
      : {};
  } catch (error) {
    logger.warn('Remembered provider switch choices unavailable', { error });
    return null;
  }
}

/** Remember each row's chosen target in the daemon (read-modify-write). Never throws. */
function* rememberChoices(rows: ProviderSwitchDialogRow[]): SagaGenerator<void> {
  const entries = rows.flatMap((row) =>
    row.selection
      ? [{ providerRef: row.providerRef, model: row.model, target: row.selection }]
      : [],
  );
  if (entries.length === 0 || !(yield* selectCanAdministerHost.effect())) return;
  const bag = yield* call(readProviderSwitchBag);
  if (bag === null) return;
  try {
    yield* call(
      [appClient.settings, appClient.settings.update],
      [
        {
          path: PROVIDER_SWITCH_SETTINGS_PATH,
          value: withRememberedProviderSwitches(bag, entries, Date.now()),
        },
      ],
    );
  } catch (error) {
    logger.warn('Failed to remember provider switch choices', { error });
  }
}

function* buildRows(
  group: AgentFailureGroup,
  classify: FailureClassifier,
): SagaGenerator<ProviderSwitchDialogRow[]> {
  const workspaceIds = [
    ...new Set(
      group.members.map((entry) => catalogContext(entry.workspaceId)).filter(Boolean) as string[],
    ),
  ];
  yield* call(ensureCatalogs, workspaceIds);
  const remembered = (yield* call(readProviderSwitchBag)) ?? {};
  const configuredModels = yield* selectProviderModels.effect();
  const modelCache = new Map<string, Promise<ProviderSwitchTargetOption['models']>>();
  const loadModels = (providerId: string, workspaceId: string | undefined) => {
    const key = `${providerId}|${workspaceId ?? ''}`;
    let pending = modelCache.get(key);
    if (!pending) {
      pending = getModelsForProvider(providerId, workspaceId)
        .then((models) => models.map((model) => ({ ...model, label: model.label || model.value })))
        .catch((error: unknown) => {
          logger.warn('Model catalog unavailable for switch target', { providerId, error });
          return [];
        });
      modelCache.set(key, pending);
    }
    return pending;
  };

  const rows: ProviderSwitchDialogRow[] = [];
  for (const row of switchRowsForMembers(group.members, classify)) {
    const agents: ProviderSwitchDialogAgent[] = [];
    let workerCount = 0;
    for (const agentId of row.agentIds) {
      const entry = group.members.find((member) => member.agentId === agentId);
      if (!entry) continue;
      const label = yield* call(agentLabel, entry);
      const eligibleProviderIds = yield* selectContextQuotaRetryProviderIds.effect(
        row.providerRef,
        catalogContext(entry.workspaceId),
      );
      agents.push({
        agentId,
        name: label.name,
        ...(label.workspace ? { workspaceName: label.workspace } : {}),
        eligibleProviderIds,
      });
      workerCount += workersFor(entry, group.key, classify).length;
    }
    const targetIds = unionTargets(agents.map((agent) => agent.eligibleProviderIds));
    const targets: ProviderSwitchTargetOption[] = [];
    for (const providerId of targetIds) {
      const host = row.agentIds
        .map((id) => group.members.find((member) => member.agentId === id))
        .find((entry) =>
          agents
            .find((agent) => agent.agentId === entry?.agentId)
            ?.eligibleProviderIds.includes(providerId),
        );
      const context = host ? catalogContext(host.workspaceId) : undefined;
      const models = yield* call(loadModels, providerId, context);
      if (models.length === 0) continue;
      const label = yield* selectProviderConfigurationLabel.effect(providerId, context);
      targets.push({ providerId, label, models });
    }
    const sourceModels = row.model
      ? yield* call(loadModels, row.providerRef, catalogContext(group.members[0].workspaceId))
      : [];
    const sourceProvider = yield* selectProviderConfigurationLabel.effect(row.providerRef);
    const sourceModel = row.model
      ? (sourceModels.find((model) => model.value === row.model)?.label ?? row.model)
      : undefined;
    const pickerHost = row.agentIds
      .map((id) => group.members.find((member) => member.agentId === id))
      .find(
        (entry) =>
          agents.find((agent) => agent.agentId === entry?.agentId)?.eligibleProviderIds.length,
      );
    const pickerWorkspaceId = pickerHost ? catalogContext(pickerHost.workspaceId) : undefined;
    rows.push({
      ...(pickerWorkspaceId ? { pickerWorkspaceId } : {}),
      key: row.key,
      providerRef: row.providerRef,
      model: row.model,
      label: sourceModel ? `${sourceProvider} · ${sourceModel}` : sourceProvider,
      agents,
      workerCount,
      targets,
      selection: resolveSwitchPrefill({
        remembered: getRememberedProviderSwitch(remembered, row.providerRef, row.model),
        targets,
        configuredModels,
      }),
    });
  }
  return rows;
}

/** Tracked failed workers of a coordinator in the same failure group. */
function workersFor(
  coordinator: AgentFailureEntry,
  groupKey: string,
  classify: FailureClassifier,
): AgentFailureEntry[] {
  return listDelegatedAgentFailures(coordinator.agentId).filter((worker) => {
    const classification = classify(worker);
    return (
      classification !== null &&
      failureGroupKey(classification.kind, classification.baseProviderId) === groupKey
    );
  });
}

/**
 * Run a bulk worker with per-agent progress in the dialog. The worker's
 * callbacks are plain functions, so outcomes go through a channel that a
 * forked loop turns into dialog actions and registry updates.
 */
function* runWithDialogProgress(
  run: (onAgentDone: (outcome: BulkAgentOutcome) => void) => Promise<BulkAgentOutcome[]>,
  snapshots: Map<string, AgentFailureEntry>,
): SagaGenerator<BulkAgentOutcome[]> {
  const settled = channel<BulkAgentOutcome>(buffers.expanding());
  const relay = yield* fork(function* () {
    while (true) {
      const outcome = yield* take(settled);
      settleEntry(outcome, snapshots);
      yield* put(providerSwitchAgentSettled(outcome));
    }
  });
  try {
    return yield* call(run, (outcome: BulkAgentOutcome) => settled.put(outcome));
  } finally {
    settled.close();
    yield* join(relay);
  }
}

export function* openSwitchDialog(group: AgentFailureGroup): SagaGenerator<void> {
  if ((yield* selectProviderSwitchDialog.effect()).running) return;
  const providerLabel = yield* selectProviderDisplayName.effect(group.baseProviderId);
  yield* put(providerSwitchDialogOpened({ groupKey: group.key, kind: group.kind, providerLabel }));
  const classify = yield* call(currentClassifier);
  const rows = yield* call(buildRows, group, classify);
  yield* put(providerSwitchRowsLoaded(group.key, rows));
}

/** Agents still failed for the group the dialog was built from. */
function liveDialogAgents(
  rows: ProviderSwitchDialogRow[],
  groupKey: string,
  classify: FailureClassifier,
) {
  return rows.flatMap((row) =>
    row.agents.flatMap((agent) => {
      const entry = getAgentFailureEntry(agent.agentId);
      const classification = entry ? classify(entry) : null;
      if (
        !entry ||
        !classification ||
        failureGroupKey(classification.kind, classification.baseProviderId) !== groupKey
      ) {
        return [];
      }
      return [{ row, agent, entry }];
    }),
  );
}

/** Confirm in the dialog: switch every live member per its row, then restart it. */
export function* confirmSwitchDialog(bulkHold: BulkHold): SagaGenerator<void> {
  const dialog = yield* selectProviderSwitchDialog.effect();
  if (!dialog.open || dialog.running || dialog.loading || dialog.finished || !dialog.groupKey) {
    return;
  }
  const groupKey = dialog.groupKey;
  const classify = yield* call(currentClassifier);
  const live = liveDialogAgents(dialog.rows, groupKey, classify);
  yield* fork(rememberChoices, dialog.rows);
  const items: BulkSwitchItem[] = live.map(({ row, agent, entry }) => ({
    agentId: entry.agentId,
    workspaceId: entry.workspaceId,
    target:
      row.selection && agent.eligibleProviderIds.includes(row.selection.providerId)
        ? row.selection
        : null,
    workers: workersFor(entry, groupKey, classify).map(({ agentId, workspaceId }) => ({
      agentId,
      workspaceId,
    })),
  }));
  const snapshots = new Map(live.map(({ entry }) => [entry.agentId, entry]));
  const heldIds = [...snapshots.keys()];
  bulkHold.hold(heldIds);
  yield* put(providerSwitchRunStarted(items.length));
  try {
    const outcomes = yield* call(
      runWithDialogProgress,
      (onAgentDone: (outcome: BulkAgentOutcome) => void) =>
        runBulkProviderSwitch(items, {
          ...bulkDeps,
          onAgentDone,
          onWorkerSwitched: (workerId: string) => {
            if (getDelegatedAgentFailureEntry(workerId)) removeAgentFailure(workerId);
          },
        }),
      snapshots,
    );
    yield* call(convergeRestarted, outcomes);
  } finally {
    yield* put(providerSwitchRunFinished());
    bulkHold.release(heldIds);
  }
}

/** "Retry all" in the dialog: no provider change; results per agent in the dialog. */
export function* retryAllFromDialog(bulkHold: BulkHold): SagaGenerator<void> {
  const dialog = yield* selectProviderSwitchDialog.effect();
  if (!dialog.open || dialog.running || dialog.finished || !dialog.groupKey) return;
  const classify = yield* call(currentClassifier);
  const live = liveDialogAgents(dialog.rows, dialog.groupKey, classify);
  const snapshots = new Map(live.map(({ entry }) => [entry.agentId, entry]));
  const heldIds = [...snapshots.keys()];
  bulkHold.hold(heldIds);
  yield* put(providerSwitchRunStarted(live.length));
  try {
    const outcomes = yield* call(
      runWithDialogProgress,
      (onAgentDone: (outcome: BulkAgentOutcome) => void) =>
        runBulkRetry(
          live.map(({ entry }) => ({ agentId: entry.agentId, workspaceId: entry.workspaceId })),
          { retry: bulkDeps.retry, onAgentDone },
        ),
      snapshots,
    );
    yield* call(convergeRestarted, outcomes);
  } finally {
    yield* put(providerSwitchRunFinished());
    bulkHold.release(heldIds);
  }
}
