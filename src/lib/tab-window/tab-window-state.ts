/**
 * The record of this tab window, for its page (`/tab-window/<id>`). The tab
 * window saga sets it once main answers: `undefined` while loading, `null`
 * when main has no such tab window (it was closed).
 */
import { writable, type Readable } from 'svelte/store';
import type { TabWindowRecord } from '$shared/types/tab-window';

const recordStore = writable<TabWindowRecord | null | undefined>(undefined);

export const tabWindowRecord: Readable<TabWindowRecord | null | undefined> = {
  subscribe: recordStore.subscribe,
};

export function setTabWindowRecord(record: TabWindowRecord | null): void {
  recordStore.set(record);
}
