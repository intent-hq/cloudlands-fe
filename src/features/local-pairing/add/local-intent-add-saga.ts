/**
 * Add machine → Intent on this computer (requester side of local code
 * pairing). While the form is open the discovery folder is re-read every
 * couple of seconds (the contract allows at most once a second); a submitted
 * code is redeemed by the main process, which saves the machine. The saga then
 * highlights the new row and opens it.
 */
import {
  call,
  delay,
  put,
  race,
  take,
  takeLatest,
  takeLeading,
  type SagaGenerator,
} from 'typed-redux-saga';
import { store } from '$store/renderer/store';
import { setLabsLocalPairingEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { openConnectionRequested } from '$store/renderer/slices/connections/connections-slice';
import { rowHighlighted } from '$features/nodes/nodes-slice';
import { localIntentsApi as api } from './local-intent-add-client';
import { localRedeemErrorSpendsCode } from './local-intent-add-errors';
import {
  localIntentAddClosed,
  localIntentAddOpened,
  localIntentAdded,
  localIntentRedeemFailed,
  localIntentRedeemSubmitted,
  localIntentsListed,
  takeLocalCode,
} from './local-intent-add-slice';

const LOCAL_INTENTS_POLL_MS = 2_000;

const addState = () => store.state.localIntentAdd;

function* readList(): SagaGenerator<void> {
  const result = yield* call([api, api.list]);
  yield* put(localIntentsListed(result.ok ? result.intents : null));
}

function* pollList(): SagaGenerator<void> {
  for (;;) {
    if (addState().phase === 'ready') yield* call(readList);
    yield* delay(LOCAL_INTENTS_POLL_MS);
  }
}

function* whileOpen(): SagaGenerator<void> {
  yield* race({ poll: call(pollList), closed: take(localIntentAddClosed) });
}

function* redeem(): SagaGenerator<void> {
  const code = takeLocalCode();
  if (addState().phase !== 'redeeming') return;
  const { selectedId, intents } = addState();
  const target = intents?.find((intent) => intent.instanceId === selectedId);
  if (!code || !target) {
    yield* put(localIntentRedeemFailed({ code: code ? 'gone' : 'code-format' }, false));
    return;
  }
  const result = yield* call([api, api.redeem], target.instanceId, code);
  if (!result.ok) {
    yield* put(localIntentRedeemFailed(result.error, localRedeemErrorSpendsCode(result.error)));
    if (result.error.code === 'gone') yield* call(readList);
    return;
  }
  const { connection } = result;
  yield* put(localIntentAdded(connection.label || target.displayName));
  yield* put(rowHighlighted(connection.id));
  yield* put(openConnectionRequested(connection.id));
}

function* labsChanged(action: ReturnType<typeof setLabsLocalPairingEnabled>): SagaGenerator<void> {
  if (action.payload[0] === false && addState().phase !== 'closed')
    yield* put(localIntentAddClosed());
}

export function* localIntentAddSaga(): SagaGenerator<void> {
  yield* takeLatest(localIntentAddOpened, whileOpen);
  yield* takeLeading(localIntentRedeemSubmitted, redeem);
  yield* takeLatest(setLabsLocalPairingEnabled, labsChanged);
}
