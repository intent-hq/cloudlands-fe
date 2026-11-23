import { describe, expect, it } from 'vitest';
import { joinDiscussionBody, splitDiscussionBody } from './discussion-images';
import { discussionReplyFirstLine } from './discussion-message-content';

const a = { name: 'shot.png', url: 'workspace-asset://ws-1/abc-12345678.png' };
const b = { name: 'photo.jpg', url: 'workspace-asset://ws-1/def-87654321.jpg' };

describe('discussion image bodies', () => {
  it.each([
    ['', [a]],
    ['hello', [a, b]],
    ['hello\n', [a]],
    ['line one\n\nline two', [b]],
    [`![typed](${a.url})`, [b]],
    ['no images', []],
  ])('round-trips text %j with attached images', (text, images) => {
    expect(splitDiscussionBody(joinDiscussionBody(text, images), 'ws-1')).toEqual({
      text,
      images,
    });
  });

  it('keeps assets from another workspace, non-images and inline images as text', () => {
    for (const body of [
      `hi\n\n![x](workspace-asset://ws-2/abc-12345678.png)`,
      `hi\n\n![x](workspace-asset://ws-1/clip-12345678.mp4)`,
      `see ![x](${a.url})`,
      `hi\n\n![x](https://example.com/a.png)`,
    ])
      expect(splitDiscussionBody(body, 'ws-1')).toEqual({ text: body, images: [] });
  });

  it('only treats the trailing image block as attachments', () => {
    const body = `![first](${a.url})\nmiddle\n\n![second](${b.url})`;
    expect(splitDiscussionBody(body, 'ws-1')).toEqual({
      text: `![first](${a.url})\nmiddle`,
      images: [{ name: 'second', url: b.url }],
    });
  });

  it('writes link-safe alt text', () => {
    const body = joinDiscussionBody('', [{ name: 'a [b] (c)\\.png', url: a.url }]);
    expect(splitDiscussionBody(body, 'ws-1').images).toEqual([{ name: 'a b c.png', url: a.url }]);
  });

  it('previews an image-only reply by its name', () => {
    expect(discussionReplyFirstLine(joinDiscussionBody('', [a, b]))).toBe('shot.png');
    expect(discussionReplyFirstLine(joinDiscussionBody('look', [a]))).toBe('look');
  });
});
