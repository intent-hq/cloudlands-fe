import { expect, it, vi } from 'vitest';
import { trackAgentMetadataRead } from './agent-metadata-read-lane';

it('serializes one workspace while allowing another workspace, including a rejected leading read', async () => {
  const held = Promise.withResolvers<number>();
  const first = trackAgentMetadataRead('one', () => held.promise, 'recovery');
  const read = vi.fn(async () => 2);
  const second = trackAgentMetadataRead('one', read);
  expect(read).not.toHaveBeenCalled();
  expect(await trackAgentMetadataRead('two', async () => 3)).toBe(3);
  held.reject(new Error('leading failure'));
  await expect(first).rejects.toThrow('leading failure');
  await expect(second).resolves.toBe(2);
  expect(read).toHaveBeenCalledTimes(1);
});

it('allows independent ordinary scopes then gives recovery an exclusive turn before later reads', async () => {
  const a = Promise.withResolvers<void>();
  const b = Promise.withResolvers<void>();
  const snapshot = Promise.withResolvers<void>();
  const first = trackAgentMetadataRead('shared', () => a.promise);
  const ordinary = vi.fn(() => b.promise);
  const second = trackAgentMetadataRead('shared', ordinary);
  expect(ordinary).toHaveBeenCalledTimes(1);
  const recover = vi.fn(() => snapshot.promise);
  const recovery = trackAgentMetadataRead('shared', recover, 'recovery');
  const laterRead = vi.fn(async () => 'after');
  const later = trackAgentMetadataRead('shared', laterRead);
  a.resolve();
  await first;
  expect(recover).not.toHaveBeenCalled();
  b.resolve();
  await second;
  await Promise.resolve();
  await Promise.resolve();
  expect(recover).toHaveBeenCalledTimes(1);
  expect(laterRead).not.toHaveBeenCalled();
  snapshot.resolve();
  await recovery;
  expect(await later).toBe('after');
  expect(laterRead).toHaveBeenCalledTimes(1);
});
