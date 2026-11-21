import { safeLocalStorage } from '$lib/utils/safe-storage';

const STORAGE_KEY = 'agent-subscriptions:view-state:v1';
export const AGENT_SUBSCRIPTIONS_VIEW_STATE_LIMIT = 200;

interface ThreadViewState {
  events?: boolean;
  waiting?: boolean;
  finished?: boolean;
  prMonitorId?: string | null;
  at: number;
}

type ViewStateRecord = Record<string, ThreadViewState>;

let sessionState: ViewStateRecord = {};

function disclosureKey(workspaceId: string, agentId: string): string {
  return `${workspaceId}:${agentId}`;
}

function parseEntry(value: unknown): ThreadViewState | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const entry: ThreadViewState = { at: typeof raw.at === 'number' ? raw.at : 0 };
  if (typeof raw.events === 'boolean') entry.events = raw.events;
  if (typeof raw.waiting === 'boolean') entry.waiting = raw.waiting;
  if (typeof raw.finished === 'boolean') entry.finished = raw.finished;
  if (typeof raw.prMonitorId === 'string' || raw.prMonitorId === null) {
    entry.prMonitorId = raw.prMonitorId;
  }
  return entry;
}

function readStored(): ViewStateRecord {
  const raw = safeLocalStorage.getJSON<unknown>(STORAGE_KEY);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const record: ViewStateRecord = {};
  for (const [key, value] of Object.entries(raw)) {
    const entry = parseEntry(value);
    if (entry) record[key] = entry;
  }
  return record;
}

function pruned(record: ViewStateRecord): ViewStateRecord {
  const entries = Object.entries(record);
  if (entries.length <= AGENT_SUBSCRIPTIONS_VIEW_STATE_LIMIT) return record;
  entries.sort(([, a], [, b]) => b.at - a.at);
  return Object.fromEntries(entries.slice(0, AGENT_SUBSCRIPTIONS_VIEW_STATE_LIMIT));
}

function readEntry(workspaceId: string, agentId: string): ThreadViewState | undefined {
  const key = disclosureKey(workspaceId, agentId);
  return sessionState[key] ?? readStored()[key];
}

function writeEntry(
  workspaceId: string,
  agentId: string,
  patch: Partial<Omit<ThreadViewState, 'at'>>,
): void {
  const key = disclosureKey(workspaceId, agentId);
  const stored = readStored();
  const entry = { ...(sessionState[key] ?? stored[key]), ...patch, at: Date.now() };
  sessionState = pruned({ ...sessionState, [key]: entry });
  safeLocalStorage.setJSON(STORAGE_KEY, pruned({ ...stored, [key]: entry }));
}

export function getEventSubscriptionsExpanded(workspaceId: string, agentId: string): boolean {
  return readEntry(workspaceId, agentId)?.events ?? true;
}

export function setEventSubscriptionsExpanded(
  workspaceId: string,
  agentId: string,
  expanded: boolean,
): void {
  writeEntry(workspaceId, agentId, { events: expanded });
}

export function getWaitingAgentsExpanded(workspaceId: string, agentId: string): boolean {
  return readEntry(workspaceId, agentId)?.waiting ?? false;
}

export function setWaitingAgentsExpanded(
  workspaceId: string,
  agentId: string,
  expanded: boolean,
): void {
  writeEntry(workspaceId, agentId, { waiting: expanded });
}

export function getFinishedAgentsExpanded(workspaceId: string, agentId: string): boolean {
  return readEntry(workspaceId, agentId)?.finished ?? false;
}

export function setFinishedAgentsExpanded(
  workspaceId: string,
  agentId: string,
  expanded: boolean,
): void {
  writeEntry(workspaceId, agentId, { finished: expanded });
}

export function getExpandedPrMonitorId(workspaceId: string, agentId: string): string | null {
  return readEntry(workspaceId, agentId)?.prMonitorId ?? null;
}

export function setExpandedPrMonitorId(
  workspaceId: string,
  agentId: string,
  monitorId: string | null,
): void {
  writeEntry(workspaceId, agentId, { prMonitorId: monitorId });
}

export function resetAgentSubscriptionsViewStateForTests(): void {
  sessionState = {};
  safeLocalStorage.removeItem(STORAGE_KEY);
}
