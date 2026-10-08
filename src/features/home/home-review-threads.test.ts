import { describe, expect, it } from 'vitest';
import { groupHomeReviewComments } from './home-review-threads';
import type { HomeReviewComment } from './home-integrations-types';
const comment = (id: number, parent?: number): HomeReviewComment => ({
  id,
  inReplyToId: parent,
  path: 'same.ts',
  line: 10,
  body: String(id),
  createdAt: '2026-10-02T10:00:00Z',
  user: { login: 'author' },
  htmlUrl: '#' + id,
});
describe('review conversations', () => {
  it('orders the root before replies and keeps independent same-line conversations separate', () => {
    const groups = groupHomeReviewComments([comment(3, 1), comment(2), comment(1)]);
    expect(groups.map((g) => g.comments.map((c) => c.id))).toEqual([[1, 3], [2]]);
  });
  it('keeps orphan replies together until a later page loads their root', () => {
    expect(groupHomeReviewComments([comment(3, 1), comment(4, 1)]).map((g) => g.id)).toEqual([1]);
    expect(
      groupHomeReviewComments([comment(3, 1), comment(4, 1), comment(1)])[0].comments.map(
        (c) => c.id,
      ),
    ).toEqual([1, 3, 4]);
  });
});
