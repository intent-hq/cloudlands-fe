// Source: use-settings-search.svelte.ts. Search is transient component-local UI state.
import { useState } from 'react';
import { matchesSettingsSearch } from './schema';
import type { SettingEntry } from './types';

export function useSettingsSearch(initialQuery = '') {
  const [query, setQuery] = useState(initialQuery);
  return {
    get query() {
      return query;
    },
    set query(value: string) {
      setQuery(value);
    },
    setQuery,
    matches(entry: SettingEntry) {
      return matchesSettingsSearch(entry, query);
    },
  };
}
