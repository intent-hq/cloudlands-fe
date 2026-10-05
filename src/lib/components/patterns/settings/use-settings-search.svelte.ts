import { matchesSettingsSearch } from './schema';
import type { SettingEntry } from './types';

export function useSettingsSearch(initialQuery = '') {
  let query = $state(initialQuery);
  return {
    get query() {
      return query;
    },
    set query(value: string) {
      query = value;
    },
    matches(entry: SettingEntry) {
      return matchesSettingsSearch(entry, query);
    },
  };
}
