import { describe, it, expect, beforeEach } from 'vitest';

import { getMetadataFS, clearMetadataFSCache } from '../main/metadata-fs-factory';
import { LocalMetadataFS } from '../main/local-metadata-fs';

describe('getMetadataFS', () => {
  beforeEach(() => {
    clearMetadataFSCache();
  });

  it('returns LocalMetadataFS for a workspace', () => {
    const fs = getMetadataFS('local-workspace-id');
    expect(fs).toBeInstanceOf(LocalMetadataFS);
  });

  it('caches instances per workspace ID', () => {
    const first = getMetadataFS('cached-ws');
    const second = getMetadataFS('cached-ws');
    expect(first).toBe(second);
  });

  it('returns different instances for different workspace IDs', () => {
    const a = getMetadataFS('ws-a');
    const b = getMetadataFS('ws-b');
    expect(a).not.toBe(b);
  });

  it('clearMetadataFSCache resets the cache', () => {
    const before = getMetadataFS('ws-clear');
    clearMetadataFSCache();
    const after = getMetadataFS('ws-clear');
    expect(before).not.toBe(after);
  });
});
