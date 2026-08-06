import { describe, expect, it } from 'vitest';

import {
  resolveNewMessagesDividerAnchor,
  resolveLatchedDividerAnchor,
  dividerVisibleWhenScrolledToBottom,
} from '../new-messages-divider';

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

describe('resolveLatchedDividerAnchor', () => {
  const ids = ['m1', 'm2', 'm3', 'm4'];

  it('renders at the latched anchor while it is present in the transcript', () => {
    expect(resolveLatchedDividerAnchor(ids, 'm2')).toBe('m2');
  });

  it('keeps the latched anchor even when it is the newest message', () => {
    // The entry-time resolver never latches the newest message, but a latched
    // anchor that BECAME newest (trailing rows truncated) still renders as-is.
    expect(resolveLatchedDividerAnchor(ids, 'm4')).toBe('m4');
  });

  it('stays put regardless of live marker convergence (marker plays no part)', () => {
    // Only the transcript ids and the latched anchor are inputs — there is no
    // lastSeenMessageId parameter, so marker advances cannot move the divider.
    expect(resolveLatchedDividerAnchor(ids, 'm2')).toBe('m2');
    expect(resolveLatchedDividerAnchor([...ids, 'm5', 'm6'], 'm2')).toBe('m2');
  });

  it('returns null for a null latch (no divider all session)', () => {
    expect(resolveLatchedDividerAnchor(ids, null)).toBeNull();
    expect(resolveLatchedDividerAnchor(ids, undefined)).toBeNull();
    expect(resolveLatchedDividerAnchor(ids, '')).toBeNull();
  });

  it('hides (not recomputes) when the latched anchor left the transcript', () => {
    expect(resolveLatchedDividerAnchor(['m1', 'm3', 'm4'], 'm2')).toBeNull();
  });

  it('returns null for an empty transcript', () => {
    expect(resolveLatchedDividerAnchor([], 'm2')).toBeNull();
  });
});

describe('dividerVisibleWhenScrolledToBottom', () => {
  it('is true when the unseen tail fits on screen (bottom entry, follow enabled)', () => {
    // Divider 400px above the content bottom, 600px viewport: visible at bottom.
    expect(dividerVisibleWhenScrolledToBottom(1600, 2000, 600)).toBe(true);
  });

  it('is true at the exact boundary (divider top lands at the viewport top)', () => {
    expect(dividerVisibleWhenScrolledToBottom(1400, 2000, 600)).toBe(true);
  });

  it('is false when the unseen tail is taller than the viewport (divider entry)', () => {
    // Divider 1000px above the content bottom, 600px viewport: scrolled out.
    expect(dividerVisibleWhenScrolledToBottom(1000, 2000, 600)).toBe(false);
  });

  it('is true when everything fits without scrolling at all', () => {
    expect(dividerVisibleWhenScrolledToBottom(100, 500, 600)).toBe(true);
  });
});
