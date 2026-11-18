import {
  EMPTY_SIGN_IN_STATE,
  type SignInState,
  type SignInStore,
} from './browser-access-sign-in-codes';

/** A sign-in store kept in memory, for tests. */
export function createMemorySignInStore(initial: SignInState = EMPTY_SIGN_IN_STATE): SignInStore {
  let state = initial;
  let chain: Promise<unknown> = Promise.resolve();
  return {
    read: async () => state,
    update: <T>(change: (current: SignInState) => { state: SignInState; result: T }) => {
      const run = chain.then(() => {
        const next = change(state);
        state = next.state;
        return next.result;
      });
      chain = run.catch(() => {});
      return run;
    },
  };
}
