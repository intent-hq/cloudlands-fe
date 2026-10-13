import { call, race, take, type SagaGenerator } from 'typed-redux-saga';
import { settingsAuthorityRetired, settingsRecoveryInvalidated } from '../settings-events-slice';

/** Cancel held completions and discard queued edits when their owner retires. */
export function* settingsWorkScope(work: () => SagaGenerator<void>): SagaGenerator<void> {
  while (true) {
    const result = yield* race({
      work: call(work),
      retired: take([settingsAuthorityRetired, settingsRecoveryInvalidated]),
    });
    if ('work' in result) return;
  }
}
