import { type EventChannel } from "redux-saga";
import {
  call,
  race,
  take,
  delay,
} from "typed-redux-saga";
import { type StoreSelector } from "../../../types";
import { createChannelFromSelector } from "../../../utils/selector-channel-effects";

const checkValueSaga = function* <R, T extends { payload: R; prevPayload: R | undefined | null }>(
  channel: EventChannel<T>,
  isExpectedValue: (value: R, prevVal: R | undefined | null) => boolean
) {
  while (true) {
    const { payload: val, prevPayload: prevVal } = yield* take(channel);
    if (isExpectedValue(val, prevVal)) {
      return true;
    }
  }
};

export function* waitFor<ARGS extends any[], R>(
  selector: StoreSelector<R, ARGS>,
  args: ARGS,
  isExpectedValue: (value: R, prevVal: R | undefined | null) => boolean,
  timeoutMs?: number
) {
  const value = yield* selector.effect(...args);
  if (isExpectedValue(value, undefined)) {
    return true;
  }
  const channel = yield* createChannelFromSelector(selector, ...args);
  const callEffect = call(checkValueSaga, channel, isExpectedValue);
  try {
    if (timeoutMs && timeoutMs > 0) {
      const { value } = yield* race({
        value: callEffect,
        timeout: delay(timeoutMs),
      });
      return value || false;
    } else {
      yield* callEffect;
    }
    // Value received successfully
    return true;
  } finally {
    channel.close();
  }
}
