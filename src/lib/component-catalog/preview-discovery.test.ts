import { describe, expect, it } from 'vitest';
import { listPreviewIds } from './preview-discovery';

describe('preview discovery', () => {
  it('finds colocated previews without a shared registry entry', () => {
    expect(listPreviewIds()).toEqual(['button', 'mention-agent-avatar']);
  });
});
