import { describe, expect, it } from 'vitest';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { resolveEmptyWindowDestination } from './empty-window-destination';

describe('resolveEmptyWindowDestination', () => {
  it("returns '/' when an available workspace exists", () => {
    expect(
      resolveEmptyWindowDestination([
        { id: 'ws-archived', status: 'Archived' },
        { id: 'ws-active', status: 'Active' },
      ]),
    ).toBe('/');
  });

  it("returns '/workspace/new' when no workspaces exist", () => {
    expect(resolveEmptyWindowDestination([])).toBe('/workspace/new');
  });

  it("returns '/workspace/new' when only archived or deleted workspaces exist", () => {
    expect(
      resolveEmptyWindowDestination([
        { id: 'ws-archived', status: 'Archived' },
        { id: 'ws-deleted', status: 'Deleted' },
      ]),
    ).toBe('/workspace/new');
  });

  it('ignores the chief workspace', () => {
    expect(resolveEmptyWindowDestination([{ id: CHIEF_WORKSPACE_ID, status: 'Active' }])).toBe(
      '/workspace/new',
    );
  });

  it('ignores the workspace being removed', () => {
    expect(
      resolveEmptyWindowDestination([{ id: 'ws-removed', status: 'Active' }], 'ws-removed'),
    ).toBe('/workspace/new');
    expect(
      resolveEmptyWindowDestination(
        [
          { id: 'ws-removed', status: 'Active' },
          { id: 'ws-other', status: 'Active' },
        ],
        'ws-removed',
      ),
    ).toBe('/');
  });

  it('treats workspaces without a status as available', () => {
    expect(resolveEmptyWindowDestination([{ id: 'ws-1' }])).toBe('/');
  });
});
