import type { Buffer } from 'redux-saga';
import { actionChannel } from 'typed-redux-saga';

/** Filter before buffering or waking a taker, preserving the original owner and buffer. */
export function* ownedActionChannel<Action extends { type: string }>(
  types: readonly string[],
  belongsToOwner: (action: Action) => boolean,
  buffer: Buffer<Action>,
) {
  return yield* actionChannel(
    (action: { type: string }): action is Action =>
      types.includes(action.type) && belongsToOwner(action as Action),
    buffer,
  );
}
