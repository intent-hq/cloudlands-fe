import { describe, expect, it } from 'vitest';
import type { WorkspaceTabStatusCategory } from '$store/renderer/slices/hud/hud-types';
import {
  formatWorkspaceTabStatusDetail,
  formatWorkspaceTabStatusSummary,
  getWorkspaceTabStatusPresentation,
} from './workspace-tab-status-presentation';

const expected: Array<[WorkspaceTabStatusCategory, string, string, string]> = [
  ['failed', 'circle-xmark', 'text-destructive', 'FAILED'],
  ['blocker', 'triangle-exclamation', 'text-destructive', 'BLOCKED'],
  ['question', 'circle-question', 'text-warning', 'QUESTION'],
  ['discussion', 'comments', 'text-info', 'DISCUSSION REQUIRED'],
  ['needs_input', 'circle-exclamation', 'text-warning', 'NEEDS ATTENTION'],
  ['review', 'clipboard-check', 'text-info', 'REVIEW REQUIRED'],
  ['unread', 'envelope', 'text-info', 'UNREAD'],
  ['running', 'circle', 'text-success', 'RUNNING'],
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
