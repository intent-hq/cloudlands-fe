/** Transient renderer URL intent; never persisted with workspace tabs. */
export type BrowserTabNavigation = {
  url: string;
  kind: 'observed' | 'requested';
};
