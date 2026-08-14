import { describe, expect, it } from 'vitest';
import type { WorkspaceTabStatusCategory } from '$store/renderer/slices/hud/hud-types';
import {
  formatWorkspaceTabStatusDetail,
  formatWorkspaceTabStatusSummary,
  getWorkspaceTabStatusPresentation,
} from './workspace-tab-status-presentation';

const expected: Array<[WorkspaceTabStatusCategory, string, string, string]> = [
  ['failed', 'circle-xmark', 'text-red-600 dark:text-red-400', 'FAILED'],
  ['blocker', 'triangle-exclamation', 'text-orange-600 dark:text-orange-400', 'BLOCKED'],
  ['question', 'circle-question', 'text-amber-700 dark:text-amber-400', 'QUESTION'],
  ['discussion', 'comments', 'text-violet-600 dark:text-violet-400', 'DISCUSSION REQUIRED'],
  ['needs_input', 'circle-exclamation', 'text-amber-700 dark:text-amber-400', 'NEEDS ATTENTION'],
  ['review', 'clipboard-check', 'text-blue-600 dark:text-blue-400', 'REVIEW REQUIRED'],
  ['unread', 'envelope', 'text-cyan-700 dark:text-cyan-400', 'UNREAD'],
  ['running', 'circle', 'text-emerald-600 dark:text-emerald-400', 'RUNNING'],
];

describe('workspace tab status presentation', () => {
  it('keeps every category on a distinct canonical glyph, color, and label contract', () => {
    expect(
      expected.map(([category]) => {
        const presentation = getWorkspaceTabStatusPresentation(category);
        return [category, presentation.icon.iconName, presentation.className, presentation.label];
      }),
    ).toEqual(expected);
  });

  it('uses the agent-aware description for named categories', () => {
    expect(
      formatWorkspaceTabStatusDetail({
        category: 'running',
        count: 2,
        agentNames: ['Coordinator', 'Builder'],
      }),
    ).toBe('RUNNING: 2 (Coordinator, Builder)');
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
    expect(formatWorkspaceTabStatusDetail(status.categories[0])).toBe('REVIEW REQUIRED: 1');
    expect(formatWorkspaceTabStatusSummary(status)).toBe(
      'REVIEW REQUIRED: 1 · RUNNING: 1 (Coordinator)',
    );
  });
});
