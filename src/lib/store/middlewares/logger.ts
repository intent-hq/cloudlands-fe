import type { Middleware } from "redux";
import { createLogger } from "redux-logger";

function isPrimitive(value: unknown): value is string | number | bigint | boolean | symbol | null | undefined {
  return value === null || (typeof value !== "object" && typeof value !== "function");
}

function getInlinePayloadSuffix(action: unknown): string {
  const hasPayload = typeof action === "object" && action !== null && "payload" in action;

  if (!hasPayload) {
    return "";
  }

  const { payload } = action;

  if (Array.isArray(payload) && payload.length === 1 && isPrimitive(payload[0])) {
    return ` ${String(payload[0])}`;
  } else if (isPrimitive(payload)) {
    return ` ${String(payload)}`;
  }

  return "";
}

/**
 * Logger middleware - logs dispatched actions and state changes.
 * Only active when debug flag is enabled in localStorage.
 */
export function createLoggerMiddleware(_webviewName?: string): Middleware {
  return createLogger({
    collapsed: true,
    titleFormatter: (action) => {
      const payloadSuffix = getInlinePayloadSuffix(action);

      return `${String(action.type)}${payloadSuffix}`;
    },
  });
}

