import { expect, it, vi } from 'vitest';
import {
  acquireAgentMetadataDemand,
  agentMetadataDemands,
  bindAgentMetadataDemandOwner,
} from './agent-metadata-demand';

it('releases only its own demand after the captured owner settles across replacement', async () => {
  const first = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  const firstSettled = vi.fn(() => first.promise);
  const secondSettled = vi.fn(() => second.promise);
  const oldUnbind = bindAgentMetadataDemandOwner('replacement', {
    status: { stale: true, running: false },
    whenSettled: firstSettled,
  } as never);
  const releaseOld = acquireAgentMetadataDemand('replacement');
  const newUnbind = bindAgentMetadataDemandOwner('replacement', {
    status: { stale: true, running: true },
    whenSettled: secondSettled,
  } as never);
  oldUnbind();
  const releaseNew = acquireAgentMetadataDemand('replacement');
  try {
    releaseOld();
    releaseOld();
    releaseNew();
    expect(firstSettled).toHaveBeenCalledTimes(1);
    expect(secondSettled).toHaveBeenCalledTimes(1);
    expect(agentMetadataDemands.get('replacement')?.size).toBe(2);
    first.resolve();
    await Promise.resolve();
    expect(agentMetadataDemands.get('replacement')?.size).toBe(1);
    second.resolve();
    await Promise.resolve();
    expect(agentMetadataDemands.has('replacement')).toBe(false);
  } finally {
    first.resolve();
    second.resolve();
    releaseOld();
    releaseNew();
    oldUnbind();
    newUnbind();
  }
});
