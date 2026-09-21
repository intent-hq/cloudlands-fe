export type StateDensity = 'default' | 'compact';

export const LIST_STATE_GEOMETRY = {
  default: {
    rowHeight: 48,
    inlineInset: 12,
    rowGap: 0,
  },
  compact: {
    rowHeight: 36,
    inlineInset: 8,
    rowGap: 0,
  },
} as const satisfies Record<
  StateDensity,
  { rowHeight: number; inlineInset: number; rowGap: number }
>;
