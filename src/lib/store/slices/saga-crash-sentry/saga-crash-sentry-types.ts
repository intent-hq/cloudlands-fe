export const SAGA_MANAGER_ADD_CRASH_TYPE = "sagaManager/addCrash";

export type SerializedSagaCrashReport = {
  crashedAtTs: number;
  error: {
    name: string;
    message: string;
    stack?: string;
  };
};

export type SagaCrashAction = {
  type: typeof SAGA_MANAGER_ADD_CRASH_TYPE;
  payload: [sagaName: string, report: SerializedSagaCrashReport];
};

export type SentryCaptureContext = Parameters<typeof import("@sentry/electron/renderer").captureException>[1];

export type SentryRenderer = {
  captureException: (error: unknown, context?: SentryCaptureContext) => void;
};

export type SentryLoader = () => Promise<SentryRenderer>;