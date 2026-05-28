import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { runSaga } from "redux-saga";

vi.mock("typed-redux-saga", async () => await import("./test-helpers/typed-redux-saga-mock"));

import { retryWithTimeout } from "./retry-with-timeout";
import { call } from "typed-redux-saga";

function runToCompletion(saga: () => Generator<any, any, any>) {
  return runSaga({ dispatch: () => {}, getState: () => ({}) }, saga).toPromise();
}

describe("retryWithTimeout", () => {
  it("returns 'success' when function succeeds on first attempt", async () => {
    const fn = vi.fn();
    const result = await runToCompletion(function* () {
      return yield* retryWithTimeout(

        function* () {
          fn();
        },
        { maxRetries: 2, timeoutMs: 5000 }
      );
    });

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and returns 'success' when a later attempt succeeds", async () => {
    let attempt = 0;
    const onAttemptError = vi.fn();
    const result = await runToCompletion(function* () {
      return yield* retryWithTimeout(

        function* () {
          attempt++;
          if (attempt < 3) {
            throw new Error(`fail ${attempt}`);
          }
        },
        {
          maxRetries: 2,
          timeoutMs: 10_000,
          getDelayMs: () => 1, // minimal delay for test speed
          onAttemptError,
        }
      );
    });

    expect(result).toBe("success");
    expect(attempt).toBe(3);
    expect(onAttemptError).toHaveBeenCalledTimes(2);
    expect(onAttemptError).toHaveBeenCalledWith(expect.any(Error), 0, 3);
    expect(onAttemptError).toHaveBeenCalledWith(expect.any(Error), 1, 3);
  });

  it("returns 'retries-exhausted' when all attempts fail", async () => {
    const onAttemptError = vi.fn();
    const result = await runToCompletion(function* () {
      return yield* retryWithTimeout(

        function* () {
          throw new Error("always fails");
        },
        {
          maxRetries: 1,
          timeoutMs: 10_000,
          getDelayMs: () => 1,
          onAttemptError,
        }
      );
    });

    expect(result).toBe("retries-exhausted");
    expect(onAttemptError).toHaveBeenCalledTimes(2); // 1 + 1 retry = 2 total
  });

  it("returns 'timeout' when overall timeout is exceeded", async () => {
    const result = await runToCompletion(function* () {
      return yield* retryWithTimeout(
        function* () {
          // Simulate slow work by calling a saga that takes forever
          yield* call(function* () {
            yield* call(() => new Promise(() => {})); // never resolves
          });
        },
        {
          maxRetries: 0,
          timeoutMs: 50, // very short timeout
        }
      );
    });

    expect(result).toBe("timeout");
  });

  it("calls onAttemptError with correct arguments", async () => {
    const onAttemptError = vi.fn();
    const testError = new Error("test error");

    await runToCompletion(function* () {
      return yield* retryWithTimeout(

        function* () {
          throw testError;
        },
        {
          maxRetries: 0,
          timeoutMs: 5000,
          onAttemptError,
        }
      );
    });

    expect(onAttemptError).toHaveBeenCalledTimes(1);
    expect(onAttemptError).toHaveBeenCalledWith(testError, 0, 1);
  });

  it("continues retrying even if onAttemptError throws", async () => {
    let attempts = 0;
    const result = await runToCompletion(function* () {
      return yield* retryWithTimeout(

        function* () {
          attempts++;
          if (attempts < 3) {
            throw new Error("fail");
          }
        },
        {
          maxRetries: 2,
          timeoutMs: 10_000,
          getDelayMs: () => 1,
          onAttemptError: () => {
            throw new Error("callback bug");
          },
        }
      );
    });

    expect(result).toBe("success");
    expect(attempts).toBe(3);
  });

  it("clamps negative maxRetries to 0 and still runs one attempt", async () => {
    const fn = vi.fn();
    const result = await runToCompletion(function* () {
      return yield* retryWithTimeout(

        function* () {
          fn();
        },
        { maxRetries: -5, timeoutMs: 5000 }
      );
    });

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("returns 'retries-exhausted' with negative maxRetries when fn throws", async () => {
    const result = await runToCompletion(function* () {
      return yield* retryWithTimeout(

        function* () {
          throw new Error("fail");
        },
        { maxRetries: -1, timeoutMs: 5000 }
      );
    });

    expect(result).toBe("retries-exhausted");
  });
});
