import { buffers, channel, type Channel } from 'redux-saga';
import {
  call,
  cancelled,
  delay,
  put,
  race,
  take,
  takeEvery,
  takeLatest,
  type SagaGenerator,
} from 'typed-redux-saga';
import { appClient } from '$lib/client';
import { formatInteger } from '$lib/i18n/format';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { selectAgentRulesEditor } from '../user-preferences-selectors';
import {
  agentRulesContentChanged,
  agentRulesEditorClosed,
  agentRulesEditorOpened,
  agentRulesErrorCleared,
  agentRulesFailed,
  agentRulesLoaded,
  agentRulesSaved,
  agentRulesSaveStarted,
  agentRulesSaveStatusCleared,
  saveAgentRules,
  undoAgentRulesChanges,
} from '../user-preferences-slice';

const logger = createLogger('AgentRulesSaga');
const RULE_TYPE = 'base-system-prompt';
const MAX_RULES_LENGTH = 50000;
type RulesCommand = { generation: number; operation: 'load' | 'save' };

function* loadRules(generation: number): SagaGenerator<void> {
  try {
    const { rule, invalidated } = yield* race({
      rule: call([appClient.settings, appClient.settings.getUserRule], RULE_TYPE),
      invalidated: take([agentRulesEditorOpened, agentRulesEditorClosed, agentRulesContentChanged]),
    });
    if (invalidated) return;
    if (rule === null) {
      yield* put(agentRulesFailed(generation, m.settings_agentRules_loadError()));
    } else if (rule) {
      yield* put(agentRulesLoaded(generation, rule.content));
    }
  } catch (error) {
    logger.warn('Failed to load rules', { error });
    yield* put(agentRulesFailed(generation, m.settings_agentRules_loadError()));
  }
}

function* saveRules(generation: number): SagaGenerator<void> {
  while (true) {
    const editor = yield* selectAgentRulesEditor.effect();
    if (!editor.active || editor.generation !== generation || editor.loading) return;
    const content = editor.content.trim();
    if (editor.content.length > MAX_RULES_LENGTH) {
      yield* put(
        agentRulesFailed(
          generation,
          m.settings_agentRules_overLimitError({
            max: formatInteger(MAX_RULES_LENGTH),
            excess: formatInteger(editor.content.length - MAX_RULES_LENGTH),
          }),
        ),
      );
      return;
    }
    if (content === editor.persistedContent) {
      yield* put(agentRulesSaved(generation, content));
      return;
    }
    yield* put(agentRulesSaveStarted(generation));
    let errorMessage: string | null = null;
    try {
      const result = yield* call(
        [appClient.settings, appClient.settings.updateUserRule],
        RULE_TYPE,
        content,
      );
      if (result.success) yield* put(agentRulesSaved(generation, content));
      else errorMessage = result.error || m.settings_agentRules_saveErrorShort();
    } catch (error) {
      logger.warn('Failed to save rules', { error });
      errorMessage = m.settings_agentRules_saveError();
    }
    const latest = yield* selectAgentRulesEditor.effect();
    if (!latest.active || latest.generation !== generation) return;
    // A stale completion must neither clobber the draft nor claim it was saved.
    // Finish the active write before reconciling the latest draft (including Undo).
    if (latest.content.trim() !== content) continue;
    if (errorMessage) yield* put(agentRulesFailed(generation, errorMessage));
    return;
  }
}

function* consumeRulesCommands(queue: Channel<RulesCommand>): SagaGenerator<void> {
  while (true) {
    const command = yield* take(queue);
    const editor = yield* selectAgentRulesEditor.effect();
    if (!editor.active || editor.generation !== command.generation) continue;
    if (command.operation === 'load') yield* call(loadRules, command.generation);
    else yield* call(saveRules, command.generation);
  }
}

/** One resource queue survives editor remounts: a new read waits for an old write. */
export function* agentRulesSaga(): SagaGenerator<void> {
  const queue = channel<RulesCommand>(buffers.expanding());
  try {
    yield* takeEvery(agentRulesEditorOpened, function* () {
      const editor = yield* selectAgentRulesEditor.effect();
      yield* put(queue, { generation: editor.generation, operation: 'load' });
    });
    yield* takeLatest(agentRulesContentChanged, function* () {
      const editor = yield* selectAgentRulesEditor.effect();
      if (!editor.active) return;
      const { invalidated } = yield* race({
        elapsed: delay(1000),
        invalidated: take([
          agentRulesEditorOpened,
          agentRulesEditorClosed,
          undoAgentRulesChanges,
          saveAgentRules,
        ]),
      });
      if (!invalidated) yield* put(queue, { generation: editor.generation, operation: 'save' });
    });
    yield* takeEvery([undoAgentRulesChanges, saveAgentRules], function* () {
      const editor = yield* selectAgentRulesEditor.effect();
      if (editor.active) yield* put(queue, { generation: editor.generation, operation: 'save' });
    });
    yield* takeLatest(agentRulesFailed, function* (action) {
      const editor = yield* selectAgentRulesEditor.effect();
      if (action.payload[0] !== editor.generation || !editor.active) return;
      const { invalidated } = yield* race({
        elapsed: delay(5000),
        invalidated: take([agentRulesEditorOpened, agentRulesEditorClosed]),
      });
      if (!invalidated) yield* put(agentRulesErrorCleared(editor.generation));
    });
    yield* takeLatest(agentRulesSaved, function* (action) {
      const editor = yield* selectAgentRulesEditor.effect();
      if (
        action.payload[0] !== editor.generation ||
        !editor.active ||
        editor.saveStatus !== 'saved'
      )
        return;
      const { invalidated } = yield* race({
        elapsed: delay(2000),
        invalidated: take([
          agentRulesEditorOpened,
          agentRulesEditorClosed,
          agentRulesContentChanged,
          undoAgentRulesChanges,
          saveAgentRules,
        ]),
      });
      if (!invalidated) yield* put(agentRulesSaveStatusCleared(editor.generation));
    });
    yield* call(consumeRulesCommands, queue);
  } finally {
    queue.close();
    if ((yield* cancelled()) && (yield* selectAgentRulesEditor.effect())?.active) {
      yield* put(agentRulesEditorClosed());
    }
  }
}
