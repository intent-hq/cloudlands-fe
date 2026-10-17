import { call, race, take, type SagaGenerator } from 'typed-redux-saga';
import {
  settingsAuthorityRetired,
  settingsRecoveryInvalidated,
  mcpRecoveryInvalidated,
} from '../settings-events-slice';

/** Cancel held completions and discard queued edits when their owner retires. */
export function* settingsWorkScope(
  work: () => SagaGenerator<void>,
  resource: 'settings' | 'mcp' = 'settings',
): SagaGenerator<void> {
  while (true) {
    const result = yield* race({
      work: call(work),
      retired:
        resource === 'mcp'
          ? take([settingsAuthorityRetired, mcpRecoveryInvalidated])
          : take([settingsAuthorityRetired, settingsRecoveryInvalidated]),
    });
    if ('work' in result) return;
  }
}
