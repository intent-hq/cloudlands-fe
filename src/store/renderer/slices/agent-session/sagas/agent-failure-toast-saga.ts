import { buffers, eventChannel, type EventChannel } from 'redux-saga';
import { all, call, cancelled, fork, take, type SagaGenerator } from 'typed-redux-saga';

import {
  getAgentFailureEntry,
  listAgentFailureGroups,
  removeAgentFailure,
  subscribeToAgentFailures,
  type AgentFailureEntry,
  type AgentFailureGroup,
} from '$features/agent/agent-failure-registry';
import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import { selectAgentSession } from '../agent-session-selectors';

const logger = createLogger('AgentFailureToastSaga');
const ERROR_SUMMARY_MAX_CHARS = 200;
const MAX_DETAIL_LINES = 5;
const WRAPPER_CLASS = '!border-destructive/50';

interface GroupState {
  visible: boolean;
  retrying: boolean;
  retryNote?: string;
  dismissedThroughAt?: number;
}

type FailureMessage =
  | { kind: 'snapshot'; groups: AgentFailureGroup[] }
  | { kind: 'retry'; groupKey: string }
  | { kind: 'close'; groupKey: string };

type FailureEmitter = (message: FailureMessage) => void;

function toastId(groupKey: string): string {
  return `agent-failure:${groupKey}`;
}

function newestAt(group: AgentFailureGroup): number {
  return group.entries[group.entries.length - 1]?.at ?? 0;
}

function truncate(text: string): string {
  return text.length > ERROR_SUMMARY_MAX_CHARS
    ? `${text.slice(0, ERROR_SUMMARY_MAX_CHARS - 1)}…`
    : text;
}

async function loadToastArtifacts() {
  const [{ toast }, component] = await Promise.all([
    import('svelte-sonner'),
    import('$lib/components/ui/toast/AgentFailureToast.svelte'),
  ]);
  return { toast, AgentFailureToast: component.default };
}

function createFailureChannel(): {
  channel: EventChannel<FailureMessage>;
  emit: FailureEmitter;
} {
  let emit: FailureEmitter = () => {};
  const channel = eventChannel<FailureMessage>((emitter) => {
    emit = emitter;
    const unsubscribe = subscribeToAgentFailures((groups) => emitter({ kind: 'snapshot', groups }));
    emitter({ kind: 'snapshot', groups: listAgentFailureGroups() });
    return unsubscribe;
  }, buffers.expanding());
  return { channel, emit: (message) => emit(message) };
}

function* buildToastProps(
  group: AgentFailureGroup,
  state: GroupState,
  emit: FailureEmitter,
): SagaGenerator<Record<string, unknown>> {
  const count = group.entries.length;
  const first = yield* selectAgentSession.effect(group.entries[0].agentId);
  const title =
    count === 1
      ? first?.name
        ? m.agent_failureToast_agentFailed_title({ name: first.name })
        : m.agent_failureToast_agentsFailed_one()
      : m.agent_failureToast_agentsFailed_many({ count });
  const retryLabel =
    count === 1
      ? first?.name
        ? m.agent_failureToast_retryAgent_label({ name: first.name })
        : m.agent_failureToast_retry_label()
      : m.agent_failureToast_retryAll_label({ count });
  const detailLines: Array<{ key: string; label: string }> = [];
  for (const entry of group.entries.slice(0, MAX_DETAIL_LINES)) {
    const session = yield* selectAgentSession.effect(entry.agentId);
    if (!session?.name) continue;
    const workspace = yield* selectWorkspaceById.effect(entry.workspaceId);
    const workspaceName = workspace?.title || workspace?.name;
    detailLines.push({
      key: entry.agentId,
      label: workspaceName
        ? m.agent_failureToast_agentWorkspace_label({
            agent: session.name,
            workspace: workspaceName,
          })
        : session.name,
    });
  }
  const unlistedCount = count - detailLines.length;
  if (detailLines.length > 0 && unlistedCount > 0) {
    detailLines.push({
      key: '__more__',
      label: m.agent_failureToast_moreCount_label({ count: unlistedCount }),
    });
  }
  return {
    title,
    errorSummary: truncate(group.error),
    detailLines,
    retryLabel,
    retrying: state.retrying,
    retryNote: state.retryNote,
    onRetry: () => emit({ kind: 'retry', groupKey: group.groupKey }),
    onClose: () => emit({ kind: 'close', groupKey: group.groupKey }),
  };
}

function* renderGroup(
  group: AgentFailureGroup,
  state: GroupState,
  emit: FailureEmitter,
): SagaGenerator<void> {
  const { toast, AgentFailureToast } = yield* call(loadToastArtifacts);
  const componentProps = yield* call(buildToastProps, group, state, emit);
  toast.custom(AgentFailureToast, {
    id: toastId(group.groupKey),
    componentProps,
    duration: Number.POSITIVE_INFINITY,
    class: WRAPPER_CLASS,
  });
  state.visible = true;
}

function* renderSnapshot(
  groups: AgentFailureGroup[],
  states: Map<string, GroupState>,
  emit: FailureEmitter,
): SagaGenerator<void> {
  const liveKeys = new Set(groups.map((group) => group.groupKey));
  for (const [groupKey, state] of states) {
    if (liveKeys.has(groupKey)) continue;
    if (state.visible) {
      const { toast } = yield* call(loadToastArtifacts);
      toast.dismiss(toastId(groupKey));
    }
    states.delete(groupKey);
  }
  for (const group of groups) {
    let state = states.get(group.groupKey);
    if (!state) {
      state = { visible: false, retrying: false };
      states.set(group.groupKey, state);
    }
    if (state.dismissedThroughAt !== undefined) {
      if (newestAt(group) <= state.dismissedThroughAt) continue;
      state.dismissedThroughAt = undefined;
    }
    yield* call(renderGroup, group, state, emit);
  }
}

function* retryEntry(
  entry: AgentFailureEntry,
): SagaGenerator<{ entry: AgentFailureEntry; ok: boolean }> {
  try {
    const result = yield* call(
      [appClient.agents, appClient.agents.retry],
      entry.agentId,
      entry.workspaceId,
    );
    return { entry, ok: result.ok === true };
  } catch (error) {
    logger.error('agent.retry threw', { agentId: entry.agentId, error });
    return { entry, ok: false };
  }
}

function* retryGroup(
  groupKey: string,
  states: Map<string, GroupState>,
  emit: FailureEmitter,
): SagaGenerator<void> {
  const group = listAgentFailureGroups().find((candidate) => candidate.groupKey === groupKey);
  const state = states.get(groupKey);
  if (!group || !state || state.retrying) return;
  state.retrying = true;
  state.retryNote = undefined;
  yield* call(renderGroup, group, state, emit);
  try {
    const results = yield* all(group.entries.map((entry) => call(retryEntry, entry)));
    const failedCount = results.filter((result) => !result.ok).length;
    state.retrying = false;
    state.retryNote =
      failedCount === 0
        ? undefined
        : failedCount === 1
          ? m.agent_failureToast_retryFailed_one()
          : m.agent_failureToast_retryFailed_many({ count: failedCount });
    let removedAny = false;
    for (const result of results) {
      if (!result.ok || getAgentFailureEntry(result.entry.agentId) !== result.entry) continue;
      removedAny = removeAgentFailure(result.entry.agentId) || removedAny;
    }
    if (!removedAny) {
      const current = listAgentFailureGroups().find((candidate) => candidate.groupKey === groupKey);
      if (current) yield* call(renderGroup, current, state, emit);
    }
  } finally {
    if (yield* cancelled()) state.retrying = false;
  }
}

function* closeGroup(groupKey: string, states: Map<string, GroupState>): SagaGenerator<void> {
  const state = states.get(groupKey);
  if (!state) return;
  const group = listAgentFailureGroups().find((candidate) => candidate.groupKey === groupKey);
  state.dismissedThroughAt = group ? newestAt(group) : Date.now();
  state.visible = false;
  const { toast } = yield* call(loadToastArtifacts);
  toast.dismiss(toastId(groupKey));
}

export function* agentFailureToastSaga(): SagaGenerator<void> {
  const states = new Map<string, GroupState>();
  const { channel, emit } = createFailureChannel();
  try {
    while (true) {
      const message: FailureMessage = yield* take(channel);
      if (message.kind === 'snapshot') {
        yield* call(renderSnapshot, message.groups, states, emit);
      } else if (message.kind === 'retry') {
        yield* fork(retryGroup, message.groupKey, states, emit);
      } else {
        yield* call(closeGroup, message.groupKey, states);
      }
    }
  } finally {
    channel.close();
    if (states.size > 0) {
      const { toast } = yield* call(loadToastArtifacts);
      for (const groupKey of states.keys()) toast.dismiss(toastId(groupKey));
    }
    states.clear();
  }
}
