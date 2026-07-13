import { shallowEqual } from 'fast-equals';

const INTERNAL_STORE_UTILITY_DOMAIN = '@internal_storeUtility';

export const areStoreUpdatesLocked = (state: any): boolean => {
  if (state === null || typeof state !== 'object') return false;
  return state[INTERNAL_STORE_UTILITY_DOMAIN]?.updatesLocked === true;
};

const proxyValuesWeakMap = new WeakMap<object, any>();
const collectionFieldsSet = new Set(['idField', 'ids', 'map', 'refsCount']);

const getRawValue = (maybeProxy: any): any => {
  if (maybeProxy === null || (typeof maybeProxy !== 'object' && typeof maybeProxy !== 'function'))
    return maybeProxy;
  return proxyValuesWeakMap.get(maybeProxy) ?? maybeProxy;
};

const isCollectionLike = (item: any): boolean => {
  const record = item;
  if (typeof record.idField !== 'string') return false;
  if (!Array.isArray(record.ids)) return false;
  if (typeof record.map !== 'object' || record.map === null || Array.isArray(record.map))
    return false;
  if (
    typeof record.refsCount !== 'object' ||
    record.refsCount === null ||
    Array.isArray(record.refsCount)
  )
    return false;
  for (const itemKey of Object.keys(item)) if (!collectionFieldsSet.has(itemKey)) return false;
  return true;
};

const createTrackingProxy = (
  target: any,
  accessedPaths: Set<string>,
  parsedPaths: Map<string, any[]>,
  currentPath: any[] = [],
): any => {
  if (target === null || target === void 0 || typeof target !== 'object') return target;
  const rawTarget = getRawValue(target);
  const proxy = new Proxy(rawTarget, {
    get(obj, prop) {
      const value = Reflect.get(obj, prop);
      if (!prop) return value;
      if (typeof prop === 'string' && collectionFieldsSet.has(prop) && isCollectionLike(obj))
        return value;
      const newPath = [...currentPath, prop];
      const pathString = JSON.stringify(newPath);
      parsedPaths.set(pathString, newPath);
      accessedPaths.add(pathString);
      if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        !isCollectionLike(value)
      )
        return createTrackingProxy(value, accessedPaths, parsedPaths, newPath);
      return value;
    },
  });
  proxyValuesWeakMap.set(proxy, rawTarget);
  return proxy;
};

const isValueChangedAtPath = (prevState: any, nextState: any, path: any[]): boolean => {
  let currentPrev = prevState;
  let currentNext = nextState;
  for (const key of path) {
    currentPrev = currentPrev ? currentPrev[key] : void 0;
    currentNext = currentNext ? currentNext[key] : void 0;
    if (currentPrev === currentNext) return false;
  }
  return true;
};

const hasStateChanged = (
  oldState: any,
  newState: any,
  accessedPaths: Set<string>,
  parsedPaths: Map<string, any[]>,
): boolean => {
  for (const pathStr of accessedPaths) {
    const path = parsedPaths.get(pathStr);
    if (!path) continue;
    if (isValueChangedAtPath(oldState, newState, path)) return true;
  }
  return false;
};

type CachedSelectorOptions = {
  lockUpdatesPredicate?: (state: any) => boolean;
};

export const createCachedSelector = (
  selectorFunc: (state: any, ...args: any[]) => any,
  options?: CachedSelectorOptions,
) => {
  let previousSelectResult: any = void 0;
  let previousArgs: any[] | undefined = void 0;
  let previousState: any = void 0;
  let accessedPaths = new Set<string>();
  const parsedPaths = new Map<string, any[]>();
  return (state: any, ...args: any[]) => {
    const rawValue = getRawValue(state);
    if (options?.lockUpdatesPredicate?.(rawValue) && previousSelectResult !== void 0)
      return previousSelectResult;
    const argsChanged = !previousArgs || !shallowEqual(args, previousArgs);
    const stateChanged =
      !argsChanged && previousState
        ? hasStateChanged(previousState, rawValue, accessedPaths, parsedPaths)
        : true;
    if (!argsChanged && !stateChanged && previousSelectResult !== void 0)
      return previousSelectResult;
    if (rawValue !== state) {
      const result = selectorFunc(state, ...args);
      previousArgs = args;
      previousSelectResult = result;
      return result;
    }
    const newAccessedPaths = new Set<string>();
    const result = getRawValue(
      selectorFunc(createTrackingProxy(state, newAccessedPaths, parsedPaths), ...args),
    );
    const finalResult =
      previousSelectResult !== void 0 && shallowEqual(previousSelectResult, result)
        ? previousSelectResult
        : result;
    previousSelectResult = finalResult;
    previousArgs = args;
    previousState = rawValue;
    accessedPaths = newAccessedPaths;
    return finalResult;
  };
};
