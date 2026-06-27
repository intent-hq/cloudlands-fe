/**
 * App Events Slice
 *
 * Saga-only slice (no reducer) for app-level lifecycle/system events.
 * Actions: app:*, auth:*, system:*, log:events-updated
 *
 * These are NOT workspace-scoped — they affect global UI elements.
 * Zod validation is intentionally dropped: Redux actions are already typed
 * at compile time, and runtime validation added overhead with no consumers.
 */

import { createAction } from "@augmentcode/ag-redux-toolkit/utils/store/create-action";
import type {
  DomainEvent,
  DomainEventPayloads,
} from "../../../../features/events/types";

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

export interface AppStartupPayload {
  version: string;
  environment?: "development" | "production";
  startupTimeMs?: number;
}

export interface AppShutdownPayload {
  reason?: "user" | "update" | "crash" | "system";
  graceful?: boolean;
}

export interface AppSettingsChangedPayload {
  setting: string;
  oldValue?: unknown;
  newValue: unknown;
}

export interface AppUpdateAvailablePayload {
  version: string;
  releaseNotes?: string;
}

export interface AuthLoginPayload {
  userId: string;
  method?: "email" | "github" | "google" | "sso" | "token";
}

export interface AuthLogoutPayload {
  userId?: string;
  reason?: "user" | "session-expired" | "forced";
}

export interface AuthTokenRefreshedPayload {
  userId?: string;
}

export interface AuthRequiredPayload {
  provider?: string;
  reason?: string;
}

export interface SystemMemoryWarningPayload {
  usedMB: number;
  totalMB: number;
  threshold: number;
}

export interface SystemDiskSpaceLowPayload {
  availableMB: number;
  threshold: number;
}

export interface SystemErrorPayload {
  error: string;
  stack?: string;
  fatal?: boolean;
}

// ---------------------------------------------------------------------------
// App actions
// ---------------------------------------------------------------------------

export const appStartup = createAction<[data: AppStartupPayload]>(
  "appEvents/appStartup",
);

export const appShutdown = createAction<[data: AppShutdownPayload]>(
  "appEvents/appShutdown",
);

export const appSettingsChanged = createAction<[data: AppSettingsChangedPayload]>(
  "appEvents/appSettingsChanged",
);

export const appUpdateAvailable = createAction<[data: AppUpdateAvailablePayload]>(
  "appEvents/appUpdateAvailable",
);

export const authLogin = createAction<[data: AuthLoginPayload]>(
  "appEvents/authLogin",
);

export const authLogout = createAction<[data: AuthLogoutPayload]>(
  "appEvents/authLogout",
);

export const authTokenRefreshed = createAction<[data: AuthTokenRefreshedPayload]>(
  "appEvents/authTokenRefreshed",
);

export const authRequired = createAction<[data: AuthRequiredPayload]>(
  "appEvents/authRequired",
);

export const systemMemoryWarning = createAction<[data: SystemMemoryWarningPayload]>(
  "appEvents/systemMemoryWarning",
);

export const systemDiskSpaceLow = createAction<[data: SystemDiskSpaceLowPayload]>(
  "appEvents/systemDiskSpaceLow",
);

export const systemError = createAction<[data: SystemErrorPayload]>(
  "appEvents/systemError",
);

// ---------------------------------------------------------------------------
// Log events (merged here — single action, not worth its own slice)
// ---------------------------------------------------------------------------

export const logEventsUpdated = createAction<
  [data: DomainEventPayloads["log:events-updated"]]
>("domainEvents/logEventsUpdated");

// ---------------------------------------------------------------------------
// Domain event → action mapping (for broadcast saga)
// ---------------------------------------------------------------------------

export const APP_EVENT_ACTION_MAP: Partial<{
  [E in DomainEvent]: { actionCreator: { type: string; (...args: any[]): any }; ipcChannel: E };
}> = {
  "log:events-updated": { actionCreator: logEventsUpdated, ipcChannel: "log:events-updated" },
};

// ---------------------------------------------------------------------------
// All action types (for takeEvery matching)
// ---------------------------------------------------------------------------

export const APP_EVENT_TYPES = Object.values(APP_EVENT_ACTION_MAP).flatMap((entry) =>
  entry ? [entry.actionCreator.type] : [],
);

