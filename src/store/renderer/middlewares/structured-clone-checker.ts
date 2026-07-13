import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";

const MAX_DEPTH = 15;

/**
 * Check whether a value is a plain object (not a class instance).
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

interface Violation {
  path: string;
  typeName: string;
}

function getTypeName(value: unknown): string {
  return value !== null && typeof value === "object"
    ? (value as object).constructor?.name ?? typeof value
    : typeof value;
}

/**
 * Walk a state tree and collect violations (non-serializable values)
 * into the provided array. Skips paths already in `reportedPaths`.
 */
function collectViolations(
  obj: unknown,
  path: string,
  depth: number,
  violations: Violation[],
  reportedPaths: Set<string> = new Set(),
): void {
  if (depth > MAX_DEPTH) return;

  if (obj === null || obj === undefined) return;
  const t = typeof obj;
  if (t === "string" || t === "number" || t === "boolean") return;

  if (t === "function" || t === "symbol" || t === "bigint") {
    if (!reportedPaths.has(path)) {
      reportedPaths.add(path);
      violations.push({ path, typeName: getTypeName(obj) });
    }
    return;
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      collectViolations(obj[i], `${path}[${i}]`, depth + 1, violations, reportedPaths);
    }
    return;
  }

  if (!isPlainObject(obj)) {
    if (!reportedPaths.has(path)) {
      reportedPaths.add(path);
      violations.push({ path, typeName: getTypeName(obj) });
    }
    return;
  }

  for (const key of Object.keys(obj)) {
    collectViolations(obj[key], `${path}.${key}`, depth + 1, violations, reportedPaths);
  }
}

const CHECK_INTERVAL_MS = 500;

/**
 * Debug middleware that verifies state is structuredClone-safe (serializable).
 *
 * Instead of checking on every action, it batches: actions and changed slice
 * keys are accumulated, then every 500ms the state is walked and all
 * violations are reported together with the list of actions that fired.
 *
 * Each offending path is reported at most once per session.
 */
export function createStructuredCloneCheckerMiddleware(): StoreMiddleware {
  const pendingActionTypes: string[] = [];
  const pendingChangedKeys = new Set<string>();
  const reportedPaths = new Set<string>();
  let timerHandle: ReturnType<typeof setTimeout> | null = null;
  let latestState: Record<string, unknown> = {};

  function flush(): void {
    timerHandle = null;

    if (pendingChangedKeys.size === 0) {
      return;
    }

    const changedKeys = new Set(pendingChangedKeys);
    const actionTypes = [...pendingActionTypes];
    pendingChangedKeys.clear();
    pendingActionTypes.length = 0;

    const violations: Violation[] = [];
    for (const key of changedKeys) {
      collectViolations(latestState[key], key, 0, violations, reportedPaths);
    }

    if (violations.length > 0) {
      // --- Group violations by top-level slice ---
      const bySlice = new Map<string, Violation[]>();
      for (const v of violations) {
        const sliceName = v.path.replace(/[.[].*/u, "");
        let list = bySlice.get(sliceName);
        if (!list) {
          list = [];
          bySlice.set(sliceName, list);
        }
        list.push(v);
      }

      // --- Deduplicate actions with counts ---
      const actionCounts = new Map<string, number>();
      for (const a of actionTypes) {
        actionCounts.set(a, (actionCounts.get(a) ?? 0) + 1);
      }

      const sliceNames = [...bySlice.keys()];
      const uniqueActions = [...actionCounts.keys()];

      // Top-level header (console.error so it stands out)
      console.error(
        `[structured-clone-checker] ${violations.length} violation(s) found`,
      );

      // Collapsible slice sections
      for (const [slice, sliceViolations] of bySlice) {
        console.group(`  Slice: "${slice}"`);
        for (const v of sliceViolations) {
          console.warn(`    ✗ ${v.path} → ${v.typeName}`);
        }
        console.groupEnd();
      }

      // Collapsible actions section
      console.group(`  Actions in this batch (${actionTypes.length} dispatches):`);
      for (const [actionType, count] of actionCounts) {
        console.warn(`    ${actionType}${count > 1 ? ` ×${count}` : ""}`);
      }
      console.groupEnd();

      // Copy-pasteable summary
      const pathList = violations
        .map((v) => `${v.path} (${v.typeName})`)
        .join(", ");
      console.warn(
        `  Summary: ${violations.length} non-serializable values in slices [${sliceNames.join(", ")}] after actions [${uniqueActions.join(", ")}]. Paths: ${pathList}`,
      );
    }
  }

  return (store) => (next) => (action) => {
    const prevState = store.getState() as Record<string, unknown>;
    const result = next(action);
    const nextState = store.getState() as Record<string, unknown>;

    latestState = nextState;
    const actionType = (action as { type?: string }).type ?? "unknown";
    pendingActionTypes.push(actionType);

    // Track which top-level slices changed by reference
    for (const key of Object.keys(nextState)) {
      if (prevState[key] !== nextState[key]) {
        pendingChangedKeys.add(key);
      }
    }

    // Schedule a flush if one isn't already pending
    if (timerHandle === null) {
      timerHandle = setTimeout(flush, CHECK_INTERVAL_MS);
    }

    return result;
  };
}

/**
 * Exposed for testing only — force an immediate flush of pending checks.
 */
export { CHECK_INTERVAL_MS };

