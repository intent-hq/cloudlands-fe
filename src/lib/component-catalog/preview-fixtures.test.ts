import { describe, expect, it } from 'vitest';
import {
  definePreviewFixture,
  PREVIEW_FIXTURE_IDS,
  PREVIEW_FIXTURE_TIMESTAMPS,
} from './preview-fixtures';

describe('preview fixtures', () => {
  it('provides stable product ids and timestamps', () => {
    expect(PREVIEW_FIXTURE_IDS.workspace).toBe('preview-workspace-primary');
    expect(PREVIEW_FIXTURE_IDS.agent).toBe('preview-agent-primary');
    expect(PREVIEW_FIXTURE_TIMESTAMPS).toEqual({
      createdAt: '2026-08-23T12:00:00.000Z',
      lastActivity: '2026-08-23T12:04:00.000Z',
      updatedAt: '2026-08-23T12:05:00.000Z',
    });
  });

  it('builds independent deterministic fixtures with typed overrides', () => {
    const workspace = definePreviewFixture({
      id: PREVIEW_FIXTURE_IDS.workspace,
      title: 'Preview workspace',
      createdAt: PREVIEW_FIXTURE_TIMESTAMPS.createdAt,
    });
    const first = workspace();
    const second = workspace({ title: 'Empty workspace' });

    expect(first).toEqual({
      id: 'preview-workspace-primary',
      title: 'Preview workspace',
      createdAt: '2026-08-23T12:00:00.000Z',
    });
    expect(second.title).toBe('Empty workspace');
    expect(second).not.toBe(first);
  });
});
