import { shallowEqual } from "fast-equals";

type AccessedPath = (string | symbol)[];

const proxyValuesWeakMap = new WeakMap<object, unknown>();
const collectionFieldsSet = new Set(["idField", "ids", "map", "refsCount"]);

export type CachedSelector<STATE, R, ARGS extends unknown[] = []> = (
  state: STATE,
  ...args: ARGS
) => R;

export type CreateCachedSelectorOptions<STATE> = {
  lockUpdatesPredicate?: (state: STATE) => boolean;
};

export const getRawValue = <R>(maybeProxy: R): R => {
  if (maybeProxy === null || (typeof maybeProxy !== "object" && typeof maybeProxy !== "function")) {
    return maybeProxy;
  }

  return (proxyValuesWeakMap.get(maybeProxy as object) as R | undefined) ?? maybeProxy;
};

const isCollectionLike = (item: object): boolean => {
  const record = item as Record<string, unknown>;

  if (typeof record.idField !== "string") return false;
  if (!Array.isArray(record.ids)) return false;
  if (typeof record.map !== "object" || record.map === null || Array.isArray(record.map)) {
    return false;
  }
  if (
    typeof record.refsCount !== "object" ||
    record.refsCount === null ||
    Array.isArray(record.refsCount)
  ) {
    return false;
  }

  for (const itemKey of Object.keys(item)) {
    if (!collectionFieldsSet.has(itemKey)) {
      return false;
    }
  }

  return true;
};

export const createTrackingProxy = <T>(
  target: T,
  accessedPaths: Set<string>,
  parsedPaths: Map<string, AccessedPath>,
  currentPath: AccessedPath = []
): T => {
  if (target === null || target === undefined || typeof target !== "object") {
    return target;
  }

  const rawTarget = getRawValue(target);
  const proxy = new Proxy(rawTarget as object, {
    get(obj, prop) {
      const value = Reflect.get(obj, prop);
      if (!prop) {
        return value;
      }

      if (typeof prop === "string" && collectionFieldsSet.has(prop) && isCollectionLike(obj)) {
        return value;
      }

      const newPath = [...currentPath, prop];
      const pathString = JSON.stringify(newPath);
      parsedPaths.set(pathString, newPath);
      accessedPaths.add(pathString);

      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        !isCollectionLike(value)
      ) {
        return createTrackingProxy(value, accessedPaths, parsedPaths, newPath);
      }

      return value;
    },
  });

  proxyValuesWeakMap.set(proxy, rawTarget as object);

  return proxy as T;
};

const isValueChangedAtPath = <STATE>(
  prevState: STATE,
  nextState: STATE,
  path: AccessedPath
): boolean => {
  let currentPrev: any = prevState;
  let currentNext: any = nextState;

  for (const key of path) {
    currentPrev = currentPrev ? currentPrev[key] : undefined;
    currentNext = currentNext ? currentNext[key] : undefined;
    if (currentPrev === currentNext) {
      return false;
    }
  }

  return true;
};

export const hasStateChanged = <STATE>(
  oldState: STATE,
  newState: STATE,
  accessedPaths: Set<string>,
  parsedPaths: Map<string, AccessedPath>
): boolean => {
  for (const pathStr of accessedPaths) {
    const path = parsedPaths.get(pathStr);
    if (!path) {
      continue;
    }

    if (isValueChangedAtPath(oldState, newState, path)) {
      return true;
    }
  }

  return false;
};

export const createCachedSelector = <STATE, ARGS extends unknown[] = [], R = undefined>(
  selectorFunc: CachedSelector<STATE, R, ARGS>,
  options?: CreateCachedSelectorOptions<STATE>
): CachedSelector<STATE, R, ARGS> => {
  let previousSelectResult: R | undefined = undefined;
  let previousArgs: ARGS | undefined = undefined;
  let previousState: STATE | undefined = undefined;
  let accessedPaths: Set<string> = new Set();
  const parsedPaths = new Map<string, AccessedPath>();

  return (state: STATE, ...args: ARGS): R => {
    const rawValue = getRawValue(state);
    if (options?.lockUpdatesPredicate?.(rawValue) && previousSelectResult !== undefined) {
      return previousSelectResult;
    }

    const argsChanged = !previousArgs || !shallowEqual(args, previousArgs);
    const stateChanged =
      !argsChanged && previousState
        ? hasStateChanged(previousState, rawValue, accessedPaths, parsedPaths)
        : true;

    if (!argsChanged && !stateChanged && previousSelectResult !== undefined) {
      return previousSelectResult;
    }

    // If state is provided as proxy, don't cache it.
    if (rawValue !== state) {
      const result = selectorFunc(state, ...args);
      previousArgs = args;
      previousSelectResult = result;
      return result;
    }

    const newAccessedPaths = new Set<string>();
    const trackedState = createTrackingProxy(state, newAccessedPaths, parsedPaths);
    const maybeProxyResult = selectorFunc(trackedState, ...args);
    const result = getRawValue(maybeProxyResult);

    const finalResult =
      previousSelectResult !== undefined && shallowEqual(previousSelectResult, result)
        ? previousSelectResult
        : result;

    previousSelectResult = finalResult;
    previousArgs = args;
    previousState = rawValue;
    accessedPaths = newAccessedPaths;

    return finalResult;
  };
};