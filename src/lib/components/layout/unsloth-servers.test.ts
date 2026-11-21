import { describe, expect, it } from 'vitest';
import type { UnslothStatusWirePayload } from '$store/renderer/slices/daemon-health/daemon-health-types';
import { planUnslothStop, stopAgentCount, unslothServerRows } from './unsloth-servers';

const big = { repoId: 'unsloth/Qwen3.8-27B-GGUF', port: 8888, attachedAgentCount: 2 };
const small = { repoId: 'unsloth/Qwen3.5-9B-GGUF', port: 18889, attachedAgentCount: 1 };
const top = (extra: Partial<UnslothStatusWirePayload> = {}): UnslothStatusWirePayload => ({
  running: true,
  ...big,
  ...extra,
});

describe('unslothServerRows', () => {
  it('lists nothing when no server runs', () => {
    expect(unslothServerRows(null)).toEqual([]);
    expect(unslothServerRows({ running: false, servers: [] })).toEqual([]);
  });

  it('uses the top-level server when the list is missing or empty', () => {
    expect(unslothServerRows(top())).toEqual([top()]);
    expect(unslothServerRows(top({ servers: [] }))).toEqual([top({ servers: [] })]);
  });

  it('uses every listed server', () => {
    expect(unslothServerRows(top({ servers: [big, small] }))).toEqual([big, small]);
  });
});

describe('planUnslothStop', () => {
  it('stops one model on a daemon that stops by model', () => {
    const status = top({ servers: [big, small], stopByModel: true });
    expect(planUnslothStop(status, small.repoId)).toEqual({
      repoId: small.repoId,
      stopsAll: false,
      attachedAgentCount: 1,
    });
  });

  it('stops every server, with their agents, on a daemon that cannot stop one model', () => {
    const status = top({ servers: [big, small] });
    expect(planUnslothStop(status, small.repoId)).toEqual({
      stopsAll: true,
      serverCount: 2,
      attachedAgentCount: 3,
    });
  });

  it('stops every server when a row has no repoId to stop by', () => {
    const status = top({ servers: [big, { port: 18889 }], stopByModel: true });
    expect(planUnslothStop(status, undefined).stopsAll).toBe(true);
  });

  it('stops the one server of an older daemon without a repoId', () => {
    expect(planUnslothStop(top(), big.repoId)).toEqual({
      stopsAll: false,
      attachedAgentCount: 2,
    });
  });
});

describe('stopAgentCount', () => {
  it('reads the live count while the server is listed', () => {
    const plan = planUnslothStop(top({ servers: [big, small], stopByModel: true }), small.repoId);
    expect(stopAgentCount(plan, small.repoId, [big, { ...small, attachedAgentCount: 4 }])).toBe(4);
  });

  it('keeps the count from when the dialog opened after a failed poll', () => {
    const plan = planUnslothStop(top({ servers: [big, small], stopByModel: true }), small.repoId);
    expect(stopAgentCount(plan, small.repoId, [])).toBe(1);
  });
});
