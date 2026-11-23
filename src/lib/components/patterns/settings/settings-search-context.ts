import { getContext, setContext } from 'svelte';

const SETTINGS_SEARCH_QUERY = Symbol('settings-search-query');

/** Lets every nested `SettingsForm` filter its rows by the settings page search. */
export function setSettingsSearchQuery(query: () => string): void {
  setContext(SETTINGS_SEARCH_QUERY, query);
}

export function getSettingsSearchQuery(): () => string {
  return getContext<(() => string) | undefined>(SETTINGS_SEARCH_QUERY) ?? (() => '');
}
