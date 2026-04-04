import * as Sentry from "@sentry/electron/renderer";
import type { Middleware, UnknownAction } from "redux";

const MAX_SUMMARY_KEYS = 5;
const MAX_ARRAY_TYPE_SAMPLES = 3;

type BreadcrumbAction = UnknownAction & {
  payload?: unknown;
  meta?: unknown;
  error?: unknown;
  asyncActionType?: unknown;
  promise?: unknown;
};

function getValueKind(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  if (value instanceof Error) {
    return "error";
  }

  if (value instanceof Date) {
    return "date";
  }

  return typeof value;
}

function summarizeValue(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return {
      kind: "array",
      length: value.length,
      sampleKinds: [...new Set(value.slice(0, MAX_ARRAY_TYPE_SAMPLES).map(getValueKind))],
    };
  }

  if (value instanceof Error) {
    return {
      kind: "error",
      name: value.name,
    };
  }

  if (value instanceof Date) {
    return {
      kind: "date",
    };
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);

    return {
      kind: "object",
      keyCount: entries.length,
      keys: entries.slice(0, MAX_SUMMARY_KEYS).map(([key]) => key),
      valueKinds: [...new Set(entries.slice(0, MAX_SUMMARY_KEYS).map(([, entryValue]) => getValueKind(entryValue)))],
    };
  }

  if (typeof value === "function") {
    return {
      kind: "function",
      name: value.name || "anonymous",
    };
  }

  return {
    kind: typeof value,
  };
}

function getActionType(action: unknown): string {
  if (action && typeof action === "object" && typeof (action as { type?: unknown }).type === "string") {
    return (action as { type: string }).type;
  }

  if (typeof action === "function") {
    return "[function action]";
  }

  return "unknown-action";
}

function canInspectActionProperties(action: unknown): action is BreadcrumbAction {
  return action !== null && (typeof action === "object" || typeof action === "function");
}

function buildBreadcrumbData(action: unknown, actionType: string): Record<string, unknown> {
  const data: Record<string, unknown> = {
    actionType,
    actionKind: getValueKind(action),
  };

  if (action && typeof action === "object") {
    data.actionKeys = Object.keys(action as Record<string, unknown>).slice(0, MAX_SUMMARY_KEYS);
  }

  if (!canInspectActionProperties(action)) {
    return data;
  }

  if (typeof action.asyncActionType === "string") {
    data.asyncActionType = action.asyncActionType;
  }

  if ("payload" in action) {
    data.payload = summarizeValue(action.payload);
  }

  if ("meta" in action) {
    data.meta = summarizeValue(action.meta);
  }

  if ("error" in action) {
    data.error = summarizeValue(action.error);
  }

  if ("promise" in action) {
    const promiseLike = action.promise as PromiseLike<unknown> | null | undefined;
    data.hasPromise = typeof promiseLike?.then === "function";
  }

  return data;
}

/**
 * Sentry breadcrumbs middleware - records Redux actions as Sentry breadcrumbs.
 */
export function createSentryBreadcrumbsMiddleware(): Middleware {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (_store) => (next) => (action) => {
    try {
      const actionType = getActionType(action);

      Sentry.addBreadcrumb({
        category: "redux.action",
        message: actionType,
        level: "info",
        data: buildBreadcrumbData(action, actionType),
      });
    } catch {
      // Never block Redux dispatch if Sentry is unavailable or breadcrumb capture fails.
    }

    return next(action);
  };
}

