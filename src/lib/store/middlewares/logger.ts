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

type LazyLoggerPayload = {
  prevState: unknown;
  nextState: unknown;
  changes: StateDiff;
};

class LazyLoggerStatePayload implements LazyLoggerPayload {
  readonly #prevState: unknown;
  readonly #nextState: unknown;

  constructor(prevState: unknown, nextState: unknown) {
    this.#prevState = prevState;
    this.#nextState = nextState;
  }

  get prevState(): unknown {
    return this.#prevState;
  }

  get nextState(): unknown {
    return this.#nextState;
  }

  get changes(): StateDiff {
    return createStateDiff(this.#prevState, this.#nextState);
  }
}

let hasLoggedWelcomeMessage = false;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function appendObjectPath(basePath: string, key: string): string {
  return basePath ? `${basePath}.${key}` : key;
}

function appendArrayPath(basePath: string, index: number): string {
  return basePath ? `${basePath}[${index}]` : `[${index}]`;
}

function addStateDiff(changes: StateDiff, prevValue: unknown, nextValue: unknown, path: string): void {
  if (Object.is(prevValue, nextValue)) {
    return;
  }

  if (prevValue === undefined) {
    changes[path || "<root>"] = { prev: undefined, next: nextValue };
    return;
  }

  if (
    (Array.isArray(prevValue) || prevValue === undefined) &&
    (Array.isArray(nextValue) || nextValue === undefined)
  ) {
    const prevArray = Array.isArray(prevValue) ? prevValue : [];
    const nextArray = Array.isArray(nextValue) ? nextValue : [];
    const length = Math.max(prevArray.length, nextArray.length);

    if (length > 0) {
      for (let index = 0; index < length; index++) {
        addStateDiff(changes, prevArray[index], nextArray[index], appendArrayPath(path, index));
      }
      return;
    }
  }

  if (
    (isPlainRecord(prevValue) || prevValue === undefined) &&
    (isPlainRecord(nextValue) || nextValue === undefined)
  ) {
    const prevRecord = isPlainRecord(prevValue) ? prevValue : {};
    const nextRecord = isPlainRecord(nextValue) ? nextValue : {};
    const keys = new Set([...Object.keys(prevRecord), ...Object.keys(nextRecord)]);

    if (keys.size > 0) {
      for (const key of keys) {
        addStateDiff(changes, prevRecord[key], nextRecord[key], appendObjectPath(path, key));
      }
      return;
    }
  }

  changes[path || "<root>"] = { prev: prevValue, next: nextValue };
}

function createStateDiff(prevState: unknown, nextState: unknown): StateDiff {
  const changes: StateDiff = {};
  addStateDiff(changes, prevState, nextState, "");
  return changes;
}

function getLogLabelStyle(label: "prev state" | "action" | "next state" | "state" | "state (no changes)"): string {
  switch (label) {
    case "prev state":
      return "color: #9E9E9E; font-weight: bold";
    case "action":
      return "color: #03A9F4; font-weight: bold";
    case "next state":
    case "state":
      return "color: #4CAF50; font-weight: bold";
    case "state (no changes)":
      return "color: #9E9E9E; font-weight: lighter";
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
  %cstate%c       — lazy state/diff payload (expanded by default)
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
      "color: #4CAF50; font-weight: bold",
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
    const lazyPayload = new LazyLoggerStatePayload(prevState, nextState);

    console.groupCollapsed(`%c${title}`, getActionTitleStyle(stateChanged));
    console.log("%c action    ", getLogLabelStyle("action"), action);

    if (!stateChanged) {
      console.log("%c state (no changes)", getLogLabelStyle("state (no changes)"), lazyPayload);
    } else {
      console.log("%c state    ", getLogLabelStyle("state"), lazyPayload);
    }

    console.groupEnd();

    return result;
  };
}
