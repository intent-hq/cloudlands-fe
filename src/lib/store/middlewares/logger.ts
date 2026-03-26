import type { Middleware } from "redux";

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

function getActionTitle(action: unknown): string {
  const actionType = typeof action === "object" && action !== null && "type" in action ? action.type : action;
  const payloadSuffix = getInlinePayloadSuffix(action);

  return `${String(actionType)}${payloadSuffix}`;
}

function getActionTitleStyle(stateChanged: boolean): string {
  return stateChanged ? "color: inherit; font-weight: 600" : "color: #9E9E9E; font-weight: 300";
}

type StateDiff = Record<string, { prev: unknown; next: unknown }>;

let hasLoggedWelcomeMessage = false;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function createLazyStateDiff(prevState: unknown, nextState: unknown): { diff: StateDiff } {
  const prevRecord = asRecord(prevState);
  const nextRecord = asRecord(nextState);
  const lazyDiff: { diff?: StateDiff } = {};

  Object.defineProperty(lazyDiff, "diff", {
    get() {
      const changes: StateDiff = {};

      for (const key of new Set([...Object.keys(prevRecord), ...Object.keys(nextRecord)])) {
        if (prevRecord[key] !== nextRecord[key]) {
          changes[key] = { prev: prevRecord[key], next: nextRecord[key] };
        }
      }

      return changes;
    },
    enumerable: true,
  });

  return lazyDiff as { diff: StateDiff };
}

function getLogLabelStyle(label: "prev state" | "action" | "next state" | "state (no changes)" | "changes"): string {
  switch (label) {
    case "prev state":
      return "color: #9E9E9E; font-weight: bold";
    case "action":
      return "color: #03A9F4; font-weight: bold";
    case "next state":
      return "color: #4CAF50; font-weight: bold";
    case "state (no changes)":
      return "color: #9E9E9E; font-weight: lighter";
    case "changes":
      return "color: #FF9800; font-weight: bold";
  }
}

/**
 * Logger middleware - logs dispatched actions and state changes.
 * Only active when debug flag is enabled in localStorage.
 */
export function createLoggerMiddleware(_webviewName?: string): Middleware {
  if (!hasLoggedWelcomeMessage) {
    hasLoggedWelcomeMessage = true;

    console.log(
      `%c🔧 Redux Logger Active%c

%cLegend:%c
  %c■%c State changed (bold title)
  %c■%c No state change (gray title)

%cLog labels:%c
  %cprev state%c  — state before action
  %caction%c      — dispatched action
  %cnext state%c  — state after action
  %cchanges%c     — lazily-computed diff (click to expand)
  %cstate (no changes)%c — state unchanged

%cConsole API:%c
  %cwindow.intent.enableReduxLogging()%c  — enable logging (reload required)
  %cwindow.intent.disableReduxLogging()%c — disable logging (reload required)`,
      "color: #03A9F4; font-weight: bold; font-size: 14px",
      "",
      "color: #888; font-weight: bold",
      "",
      "color: inherit; font-weight: 600",
      "",
      "color: #9E9E9E; font-weight: 300",
      "",
      "color: #888; font-weight: bold",
      "",
      "color: #9E9E9E; font-weight: bold",
      "",
      "color: #03A9F4; font-weight: bold",
      "",
      "color: #4CAF50; font-weight: bold",
      "",
      "color: #FF9800; font-weight: bold",
      "",
      "color: #9E9E9E; font-weight: lighter",
      "",
      "color: #888; font-weight: bold",
      "",
      "color: #4CAF50; font-family: monospace",
      "",
      "color: #F44336; font-family: monospace",
      ""
    );
  }

  return (storeApi) => (next) => (action) => {
    const prevState = storeApi.getState();
    const result = next(action);
    const nextState = storeApi.getState();
    const stateChanged = prevState !== nextState;
    const title = getActionTitle(action);

    console.groupCollapsed(`%c${title}`, getActionTitleStyle(stateChanged));

    if (!stateChanged) {
      console.log("%c action    ", getLogLabelStyle("action"), action);
      console.log("%c state (no changes)", getLogLabelStyle("state (no changes)"), nextState);
    } else {
      console.log("%c prev state", getLogLabelStyle("prev state"), prevState);
      console.log("%c action    ", getLogLabelStyle("action"), action);
      console.log("%c next state", getLogLabelStyle("next state"), nextState);
      console.log("%c changes  ", getLogLabelStyle("changes"), createLazyStateDiff(prevState, nextState));
    }

    console.groupEnd();

    return result;
  };
}

