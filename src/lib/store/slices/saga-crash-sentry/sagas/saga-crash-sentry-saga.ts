import {
  call,
  takeEvery,
  type SagaGenerator,
} from "typed-redux-saga";

import {
  SAGA_MANAGER_ADD_CRASH_TYPE,
  type SagaCrashAction,
  type SentryLoader,
  type SerializedSagaCrashReport,
} from "../saga-crash-sentry-types";

const defaultSentryLoader: SentryLoader = async () => {
  const Sentry = await import("@sentry/electron/renderer");
  return {
    captureException: (error, context) => {
      Sentry.captureException(error, context);
    },
  };
};

let sentryLoader: SentryLoader = defaultSentryLoader;

export function __setSagaCrashSentryLoaderForTests(loader: SentryLoader | null): void {
  sentryLoader = loader ?? defaultSentryLoader;
}

export function isSagaCrashAction(action: unknown): action is SagaCrashAction {
  if (!action || typeof action !== "object") {
    return false;
  }

  const candidate = action as { type?: unknown; payload?: unknown };
  if (candidate.type !== SAGA_MANAGER_ADD_CRASH_TYPE || !Array.isArray(candidate.payload)) {
    return false;
  }

  const [sagaName, report] = candidate.payload;
  return (
    typeof sagaName === "string" &&
    !!report &&
    typeof report === "object" &&
    typeof (report as SerializedSagaCrashReport).crashedAtTs === "number" &&
    !!(report as SerializedSagaCrashReport).error &&
    typeof (report as SerializedSagaCrashReport).error.message === "string"
  );
}

function toSagaCrashError(report: SerializedSagaCrashReport): Error {
  const error = new Error(report.error.message);
  error.name = report.error.name || "Error";
  if (typeof report.error.stack === "string") {
    error.stack = report.error.stack;
  }
  return error;
}

export function* forwardSagaCrashToSentry(action: SagaCrashAction): SagaGenerator<void> {
  const [sagaName, report] = action.payload;
  const error = toSagaCrashError(report);

  try {
    const Sentry = yield* call(sentryLoader);
    yield* call(Sentry.captureException, error, {
      tags: {
        type: "sagaCrash",
        sagaName,
      },
      extra: {
        sagaName,
        crashedAtTs: report.crashedAtTs,
        source: "svelte-redux-toolkit",
        actionType: SAGA_MANAGER_ADD_CRASH_TYPE,
      },
    });
  } catch {
    // Never crash the observer saga if telemetry is unavailable.
  }
}

export function* sagaCrashSentrySaga(): SagaGenerator<void> {
  yield* takeEvery(isSagaCrashAction, forwardSagaCrashToSentry);
}