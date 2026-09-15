import { describe, expect, it } from 'vitest';
import {
  formatWorkspaceTabStatusDetail,
  formatWorkspaceTabStatusSummary,
} from './workspace-tab-status-presentation';

describe('workspace tab status presentation', () => {
  it('uses the agent-aware description for named categories', () => {
    expect(
      formatWorkspaceTabStatusDetail({
        category: 'running',
        count: 2,
        agentNames: ['Coordinator', 'Builder'],
      }),
    ).toBe('Running: 2 (Coordinator, Builder)');
  });

  it('formats unnamed details and summaries through the same contract', () => {
    const status = {
      agentCount: 1,
      categories: [
        { category: 'review' as const, count: 1, agentNames: [] },
        { category: 'running' as const, count: 1, agentNames: ['Coordinator'] },
      ],
      visibleCategories: [],
      hiddenCategoryCount: 0,
    };
    expect(formatWorkspaceTabStatusDetail(status.categories[0])).toBe('Review required: 1');
    expect(formatWorkspaceTabStatusSummary(status)).toBe(
      'Review required: 1 · Running: 1 (Coordinator)',
    );
  });
});
