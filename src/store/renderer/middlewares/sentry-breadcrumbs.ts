import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";

type EventWithBreadcrumbs = { breadcrumbs?: Array<unknown> };

const MAX_BUFFERED_ACTIONS = 500;
const MAX_SUMMARY_KEYS = 5;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIXED_UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let primary: unknown[] = [];
let backup: unknown[] = [];

function isUuidLike(value: string): boolean {
  return UUID_REGEX.test(value) || PREFIXED_UUID_REGEX.test(value);
}

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

function formatValue(value: unknown): string {
  if (typeof value === "string" && isUuidLike(value)) {
    return value.slice(-12);
  }

  return getValueKind(value);
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

function formatPayload(payload: unknown): string {
  if (payload === undefined) {
    return "";
  }

  if (payload === null || typeof payload !== "object" || Array.isArray(payload) || payload instanceof Error || payload instanceof Date) {
    return formatValue(payload);
  }

  const entries = Object.entries(payload as Record<string, unknown>);

  if (entries.length === 0) {
    return "";
  }

  const truncated = entries.length > MAX_SUMMARY_KEYS;
  const visible = entries.slice(0, MAX_SUMMARY_KEYS);
  const parts = visible.map(([key, value]) => `${key}=${formatValue(value)}`);

  if (truncated) {
    parts.push("...");
  }

  return parts.join(", ");
}

function formatAction(action: unknown): string {
  const actionType = getActionType(action);

  if (action === null || typeof action !== "object") {
    return `${actionType}: []`;
  }

  if (!("payload" in (action as Record<string, unknown>))) {
    return `${actionType}: []`;
  }

  const payload = (action as { payload?: unknown }).payload;
  return `${actionType}: [${formatPayload(payload)}]`;
}

/**
 * Flush any buffered Redux actions as a single Sentry breadcrumb.
 *
 * Intended to be called from Sentry's `beforeSend` hook. Mutates the outgoing
 * event by appending a single summarized breadcrumb to `event.breadcrumbs` so
 * the actions ride along with that specific event (Sentry has already
 * snapshotted scope breadcrumbs by the time `beforeSend` runs). Buffered raw
 * actions are summarized into compact strings here (cold path) so only type
 * labels and truncated UUIDs reach Sentry — raw payload values never do.
 */
export function flushReduxActionBreadcrumbs(event: EventWithBreadcrumbs): void {
  if (primary.length === 0 && backup.length === 0) {
    return;
  }

  const raw = backup.concat(primary).slice(-MAX_BUFFERED_ACTIONS);
  backup = [];
  primary = [];

  try {
    const actions = raw.map((a) => formatAction(a));
    const breadcrumb = {
      category: "redux.action",
      level: "info",
      message: `${actions.length} redux actions`,
      data: { actions },
      timestamp: Date.now() / 1000,
    };
    if (event.breadcrumbs === undefined) {
      event.breadcrumbs = [];
    }
    event.breadcrumbs.push(breadcrumb);
  } catch {
    // Buffers are already cleared above to avoid unbounded growth if formatting throws.
  }
}

/** Test-only helper; not for production callers. */
export function __resetReduxActionBreadcrumbsBufferForTests(): void {
  primary = [];
  backup = [];
}

/**
 * Sentry breadcrumbs middleware - buffers raw Redux actions in a
 * double-buffer that retains the last `MAX_BUFFERED_ACTIONS` and flushes them
 * as a single summarized breadcrumb when `flushReduxActionBreadcrumbs()` is
 * called (typically from Sentry's `beforeSend` hook). No formatting happens on
 * the dispatch path.
 */
export function createSentryBreadcrumbsMiddleware(): StoreMiddleware {
   
  return (_store) => (next) => (action) => {
    try {
      primary.push(action);
      if (primary.length >= MAX_BUFFERED_ACTIONS) {
        backup = primary;
        primary = [];
      }
    } catch {
      // Never block Redux dispatch if capture fails.
    }

    return next(action);
  };
}
