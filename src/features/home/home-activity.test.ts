import { describe, expect, it } from 'vitest';
import { homeActivity, getHomeActivityTime } from './home-activity';

describe('Home content activity', () => {
  const workspace = {
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    lastActivity: '2026-10-01T00:00:00Z',
  };
  it('uses recorded content rather than a newer maintenance timestamp', () => {
    expect(homeActivity({ ...workspace, lastContentActivity: '2026-09-10T12:00:00Z' })).toEqual({
      time: Date.parse('2026-09-10T12:00:00Z'),
      source: 'content',
    });
  });
  it('uses labelled creation when the daemon has no content timestamp', () => {
    expect(homeActivity(workspace)).toEqual({
      time: Date.parse(workspace.createdAt),
      source: 'created',
    });
  });
  it('rejects malformed content time and uses a truthful fallback', () => {
    expect(homeActivity({ ...workspace, lastContentActivity: 'invalid' }).source).toBe('created');
    expect(homeActivity({ createdAt: workspace.createdAt, updatedAt: '' }).source).toBe('created');
    expect(getHomeActivityTime({ createdAt: '', updatedAt: '' })).toBe(0);
  });
});
