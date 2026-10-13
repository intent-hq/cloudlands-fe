import type { StoreMiddleware } from '@themislib/themis/types';
import type { RecoveryLifetime } from '$shared/event-recovery/resource';
import type { AdmittedEventLifetimes } from '$features/events/event-recovery-coordinator';

// Receipts stay outside Redux data and survive a saga scheduler's delayed put.
const receipts = new WeakMap<object, RecoveryLifetime>();
const admissions = new WeakMap<object, AdmittedEventLifetimes>();

type ActionIngress = (action: object) => (() => void) | undefined;
const ingressObservers = new Set<ActionIngress>();
/** Root-owned command observers install only for an admitted renderer lifetime. */
export function observeRecoveryActionIngress(observer: ActionIngress): () => void {
  ingressObservers.add(observer);
  return () => {
    ingressObservers.delete(observer);
  };
}

/** A shared event can affect several owners with independent admission decisions. */
export function withRecoveryAdmissions<T extends object>(
  action: T,
  lifetimes: AdmittedEventLifetimes,
): T {
  admissions.set(action, lifetimes);
  return action;
}

export function getRecoveryAdmission(
  action: object,
  key: string,
): RecoveryLifetime | null | undefined {
  const map = admissions.get(action);
  return map ? (map.get(key) ?? null) : undefined;
}

export function withRecoveryLifetime<T extends object>(action: T, lifetime: RecoveryLifetime): T {
  receipts.set(action, lifetime);
  return action;
}

/** Reuse the admitted ingress receipt rather than admitting the same push twice. */
export function getRecoveryLifetime(action: object): RecoveryLifetime | undefined {
  return receipts.get(action);
}

export function createEventRecoveryMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const receipt = action && typeof action === 'object' ? receipts.get(action) : undefined;
    const forward = () => {
      const abandon: Array<() => void> = [];
      try {
        if (action && typeof action === 'object')
          for (const observe of ingressObservers) {
            const cleanup = observe(action);
            if (cleanup) abandon.push(cleanup);
          }
        return next(action);
      } catch (error) {
        for (const cleanup of abandon) cleanup();
        throw error;
      }
    };
    if (!receipt) return forward();
    let result: unknown;
    receipt.commit(() => {
      result = forward();
    });
    return result;
  };
}
