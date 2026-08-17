export const CHAT_POLISH_STORAGE_KEY = 'chat-polish-sandbox-geometry-v1';

export interface ChatPolishGeometry {
  panelWidth: number;
  compact: boolean;
  contentInset: number;
  userMessageBottomGap: number;
  operationalRowGap: number;
  operationalTextGap: number;
  thinkingTopGap: number;
  wakeTopGap: number;
  wakeBottomGap: number;
  subscriptionBottomGap: number;
  rowPadding: number;
  cardRadius: number;
  failureNoticeTopGap: number;
  failureNoticeBottomGap: number;
  stickySimulation: boolean;
}

export interface ChatPolishSandboxPreferences {
  geometry: ChatPolishGeometry;
  selectedScenario: string;
}

export const defaultChatPolishGeometry: ChatPolishGeometry = Object.freeze({
  panelWidth: 510,
  compact: false,
  contentInset: 22,
  userMessageBottomGap: 24,
  operationalRowGap: 4,
  operationalTextGap: 16,
  thinkingTopGap: 16,
  wakeTopGap: 20,
  wakeBottomGap: 16,
  subscriptionBottomGap: 16,
  rowPadding: 12,
  cardRadius: 9,
  failureNoticeTopGap: 16,
  failureNoticeBottomGap: 16,
  stickySimulation: false,
});

export const chatPolishGeometryControls = [
  { key: 'panelWidth', label: 'Panel width', min: 280, max: 900, step: 10, unit: 'px' },
  { key: 'contentInset', label: 'Content inset', min: 0, max: 48, step: 1, unit: 'px' },
  {
    key: 'userMessageBottomGap',
    label: 'User-message bottom gap',
    min: 0,
    max: 64,
    step: 1,
    unit: 'px',
  },
  {
    key: 'operationalRowGap',
    label: 'Operational row gap',
    min: 0,
    max: 32,
    step: 1,
    unit: 'px',
  },
  {
    key: 'operationalTextGap',
    label: 'Operational ↔ text gap',
    min: 0,
    max: 32,
    step: 1,
    unit: 'px',
  },
  {
    key: 'thinkingTopGap',
    label: 'Thinking-indicator top gap',
    min: 0,
    max: 32,
    step: 1,
    unit: 'px',
  },
  { key: 'wakeTopGap', label: 'Wake-card top gap', min: 0, max: 48, step: 1, unit: 'px' },
  {
    key: 'wakeBottomGap',
    label: 'Wake-card bottom gap',
    min: 0,
    max: 48,
    step: 1,
    unit: 'px',
  },
  {
    key: 'subscriptionBottomGap',
    label: 'Subscription bottom gap',
    min: 0,
    max: 48,
    step: 1,
    unit: 'px',
  },
  {
    key: 'failureNoticeTopGap',
    label: 'Failure notice top gap',
    min: 0,
    max: 48,
    step: 1,
    unit: 'px',
  },
  {
    key: 'failureNoticeBottomGap',
    label: 'Failure notice bottom gap',
    min: 0,
    max: 48,
    step: 1,
    unit: 'px',
  },
  {
    key: 'rowPadding',
    label: 'Wake and subscription row padding',
    min: 0,
    max: 32,
    step: 1,
    unit: 'px',
  },
  { key: 'cardRadius', label: 'Card radius', min: 0, max: 24, step: 1, unit: 'px' },
] as const satisfies ReadonlyArray<{
  key: keyof ChatPolishGeometry;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}>;

const numericControls = new Map(
  chatPolishGeometryControls.map((control) => [control.key, control]),
);

export function readChatPolishPreferences(storage: Storage): ChatPolishSandboxPreferences {
  try {
    const stored = JSON.parse(storage.getItem(CHAT_POLISH_STORAGE_KEY) ?? '{}') as {
      geometry?: Record<string, unknown>;
      selectedScenario?: unknown;
    };
    const next = { ...defaultChatPolishGeometry };
    for (const [key, control] of numericControls) {
      const value = stored.geometry?.[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        next[key] = Math.min(control.max, Math.max(control.min, value)) as never;
      }
    }
    if (typeof stored.geometry?.compact === 'boolean') next.compact = stored.geometry.compact;
    if (typeof stored.geometry?.stickySimulation === 'boolean') {
      next.stickySimulation = stored.geometry.stickySimulation;
    }
    return {
      geometry: next,
      selectedScenario:
        typeof stored.selectedScenario === 'string' ? stored.selectedScenario : 'all',
    };
  } catch {
    return { geometry: { ...defaultChatPolishGeometry }, selectedScenario: 'all' };
  }
}

export function writeChatPolishPreferences(
  storage: Storage,
  value: ChatPolishSandboxPreferences,
): boolean {
  try {
    storage.setItem(CHAT_POLISH_STORAGE_KEY, JSON.stringify(value));
    return true;
  } catch {
    // Preview controls remain usable when storage is unavailable.
    return false;
  }
}

export function clearChatPolishPreferences(storage: Storage): boolean {
  try {
    storage.removeItem(CHAT_POLISH_STORAGE_KEY);
    return true;
  } catch {
    // Preview controls remain usable when storage is unavailable.
    return false;
  }
}

export function formatChatPolishGeometry(value: ChatPolishGeometry): string {
  return [
    `W${value.panelWidth}`,
    `inset${value.contentInset}`,
    `user${value.userMessageBottomGap}`,
    `ops${value.operationalRowGap}`,
    `opText${value.operationalTextGap}`,
    'nested6',
    `think${value.thinkingTopGap}`,
    `wake${value.wakeTopGap}/${value.wakeBottomGap}`,
    `subs${value.subscriptionBottomGap}`,
    `fail${value.failureNoticeTopGap}/${value.failureNoticeBottomGap}`,
    `rows${value.rowPadding}`,
    `radius${value.cardRadius}`,
    value.compact ? 'compact' : 'regular',
    value.stickySimulation ? 'sticky' : 'flow',
  ].join(' · ');
}
