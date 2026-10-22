import type { HomeReviewComment } from './home-integrations-types';

/** Use reply ancestry, never file/line proximity: separate discussions can share an anchor. */
export function groupHomeReviewComments(comments: HomeReviewComment[]) {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const groups = new Map<number, HomeReviewComment[]>();
  for (const comment of comments) {
    let root = comment;
    const visited = new Set<number>([root.id]);
    while (root.inReplyToId && byId.has(root.inReplyToId) && !visited.has(root.inReplyToId)) {
      const parent = byId.get(root.inReplyToId);
      if (!parent) break;
      root = parent;
      visited.add(root.id);
    }
    const rootId = root.inReplyToId && !byId.has(root.inReplyToId) ? root.inReplyToId : root.id;
    groups.set(rootId, [...(groups.get(rootId) ?? []), comment]);
  }
  const compare = (a: HomeReviewComment, b: HomeReviewComment) =>
    (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id - b.id;
  return [...groups]
    .map(([id, replies]) => ({
      id,
      comments: replies.sort((a, b) => (a.id === id ? -1 : b.id === id ? 1 : compare(a, b))),
    }))
    .sort((a, b) => compare(a.comments[0], b.comments[0]));
}
