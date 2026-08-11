import { beforeEach, describe, expect, it, vi } from 'vitest';

const { connect } = vi.hoisted(() => ({ connect: vi.fn() }));

vi.mock('chrome-remote-interface', () => ({ default: connect }));

import { observeTarget } from '../../scripts/observe-memory.js';

describe('observe-memory', () => {
  beforeEach(() => connect.mockReset());

  it('reuses one CDP client for every sample', async () => {
    const enablePerformance = vi.fn().mockResolvedValue(undefined);
    const enableRuntime = vi.fn().mockResolvedValue(undefined);
    const getMetrics = vi.fn().mockResolvedValue({ metrics: [] });
    const getHeapUsage = vi.fn().mockResolvedValue({ usedSize: 1, totalSize: 2 });
    const close = vi.fn().mockResolvedValue(undefined);
    connect.mockResolvedValue({
      Performance: { enable: enablePerformance, getMetrics },
      Runtime: { enable: enableRuntime, getHeapUsage },
      close,
    });

    const samples: unknown[] = [];
    await observeTarget(
      { host: '127.0.0.1', port: 9223, count: 3, interval: 1, follow: false },
      { id: 'page-1', type: 'page', title: 'Intent', url: 'http://localhost' },
      (sample: unknown) => samples.push(sample),
    );

    expect(connect).toHaveBeenCalledTimes(1);
    expect(enablePerformance).toHaveBeenCalledTimes(1);
    expect(enableRuntime).toHaveBeenCalledTimes(1);
    expect(getMetrics).toHaveBeenCalledTimes(3);
    expect(getHeapUsage).toHaveBeenCalledTimes(3);
    expect(samples).toHaveLength(3);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
