import { describe, expect, it } from 'vitest';
import { intentAppPartition, isIntentAppId } from './intent-apps-types';

describe('intentAppPartition', () => {
  const key = '0123456789abcdef';

  it('keeps the contract name for this computer', () => {
    expect(intentAppPartition('notes')).toBe('persist:intent-app-notes');
  });

  it('never gives a local app the partition of a remote app', () => {
    // A local app whose id ends like a remote suffix is a valid id …
    const lookalikes = [`notes-on-${key}`, `${key}-notes`, `on-${key}-notes`];
    for (const id of lookalikes) expect(isIntentAppId(id)).toBe(true);
    // … but no local partition equals the remote partition of `notes`, so an
    // uninstall of the local app (which clears its partition) leaves it alone.
    const remote = intentAppPartition('notes', key);
    for (const id of lookalikes) expect(intentAppPartition(id)).not.toBe(remote);
    expect(remote.slice('persist:'.length)).toMatch(/_/);
  });

  it('keeps two machines apart for the same app', () => {
    expect(intentAppPartition('notes', key)).not.toBe(
      intentAppPartition('notes', 'fedcba9876543210'),
    );
  });
});
