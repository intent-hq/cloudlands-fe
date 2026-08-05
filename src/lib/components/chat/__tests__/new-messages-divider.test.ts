import { describe, expect, it } from 'vitest';

import { resolveNewMessagesDividerAnchor } from '../new-messages-divider';

describe('resolveNewMessagesDividerAnchor', () => {
  const ids = ['m1', 'm2', 'm3', 'm4'];

  it('anchors the divider at the marker when it is older than the newest message', () => {
    expect(resolveNewMessagesDividerAnchor(ids, 'm2')).toBe('m2');
  });

  it('anchors at the second-to-last message (single unseen message)', () => {
    expect(resolveNewMessagesDividerAnchor(ids, 'm3')).toBe('m3');
  });

  it('anchors at the oldest message when everything after it is unseen', () => {
    expect(resolveNewMessagesDividerAnchor(ids, 'm1')).toBe('m1');
  });

  it('returns null when there is no marker', () => {
    expect(resolveNewMessagesDividerAnchor(ids, undefined)).toBeNull();
    expect(resolveNewMessagesDividerAnchor(ids, null)).toBeNull();
    expect(resolveNewMessagesDividerAnchor(ids, '')).toBeNull();
  });

  it('returns null when the marker is the newest message (nothing unseen)', () => {
    expect(resolveNewMessagesDividerAnchor(ids, 'm4')).toBeNull();
  });

  it('returns null for a dangling marker not present in the transcript', () => {
    expect(resolveNewMessagesDividerAnchor(ids, 'truncated-away')).toBeNull();
  });

  it('returns null for an empty transcript', () => {
    expect(resolveNewMessagesDividerAnchor([], 'm1')).toBeNull();
  });
});
