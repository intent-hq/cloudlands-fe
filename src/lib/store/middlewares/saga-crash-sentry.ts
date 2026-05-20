import type { Middleware } from "redux";

const SAGA_MANAGER_ADD_CRASH_TYPE = "sagaManager/addCrash";

type SerializedSagaCrashReport = {
  crashedAtTs: number;
  error: {
    name: string;
    message: string;
    stack?: string;
  };
};

type SagaCrashAction = {
  type: typeof SAGA_MANAGER_ADD_CRASH_TYPE;
  payload: [sagaName: string, report: SerializedSagaCrashReport];
};

type SentryRenderer = {
  captureException: (error: unknown, context?: unknown) => void;
};

type SentryLoader = () => Promise<SentryRenderer>;

const defaultSentryLoader: SentryLoader = async () => {
  const Sentry = await import("@sentry/electron/renderer");
  return {
    captureException: (error, context) => {
      Sentry.captureException(error, context as Parameters<typeof Sentry.captureException>[1]);
    },
  };
};

let sentryLoader: SentryLoader = defaultSentryLoader;

function isSagaCrashAction(action: unknown): action is SagaCrashAction {
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

function reportSagaCrash(action: SagaCrashAction): void {
  const [sagaName, report] = action.payload;
  const error = toSagaCrashError(report);

  void sentryLoader()
    .then((Sentry) => {
      Sentry.captureException(error, {
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
    })
    .catch(() => {
      // Never block Redux dispatch or crash recovery if telemetry is unavailable.
    });
}

/** Test-only helper; not for production callers. */
export function __setSagaCrashSentryLoaderForTests(loader: SentryLoader | null): void {
  sentryLoader = loader ?? defaultSentryLoader;
}

/**
 * Observes package-provided saga crash reports and forwards them to Sentry.
 *
 * `svelte-redux-toolkit` owns saga restart/crash storage. The app only observes
 * the serialized crash action emitted by that package-owned manager.
 */
export function createSagaCrashSentryMiddleware(): Middleware {
  return (_store) => (next) => (action) => {
    const result = next(action);

    try {
      if (isSagaCrashAction(action)) {
        reportSagaCrash(action);
      }
    } catch {
      // Never block Redux dispatch or package saga crash handling.
    }

    return result;
  };
}