import * as Sentry from "@sentry/electron/renderer";
import { call, delay, race } from "typed-redux-saga";

export class StreamTimeoutError extends Error {
  constructor() {
    super("Stream timed out");
    this.name = "StreamTimeoutError";
  }
}

/*
  Converts async generator into saga.
  This is useful for handling async generators in sagas, since redux-saga uses sync generators only
*/
export function* wrapStreamingGenerator<R>(
  generator: AsyncGenerator<R, any, any>,
  onEvent: (chunk: R) => Generator<any, any, any>,
  timeoutMs?: number
) {
  function* streamLoop() {
    let result = yield* call([generator, "next"]);
    while (result.done === false) {
      yield* onEvent(result.value);
      result = yield* call([generator, "next"]);
    }
    if (result.value !== undefined && result.value !== null) {
      yield* onEvent(result.value);
    }
  }

  try {
    if (timeoutMs != null) {
      const { timedOut } = yield* race({
        stream: call(streamLoop),
        timedOut: delay(timeoutMs),
      });
      if (timedOut) {
        throw new StreamTimeoutError();
      }
    } else {
      yield* streamLoop();
    }
  } catch (error) {
    console.error(error);
    Sentry.captureException(error);
    throw error;
  }
}
