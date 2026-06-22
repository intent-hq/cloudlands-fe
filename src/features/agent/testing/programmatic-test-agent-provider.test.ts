import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isProgrammaticTestProviderEnabled,
  ProgrammaticTestAgentProvider,
  PROGRAMMATIC_TEST_PROVIDER_ID,
} from './programmatic-test-agent-provider';

describe('ProgrammaticTestAgentProvider', () => {
  const originalTesting = process.env.TESTING;

  beforeEach(() => {
    process.env.TESTING = 'true';
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalTesting === undefined) {
      delete process.env.TESTING;
    } else {
      process.env.TESTING = originalTesting;
    }
  });

  it('streams scripted chunks with deterministic pacing and completion', async () => {
    vi.useFakeTimers();
    const provider = new ProgrammaticTestAgentProvider({
      provider: PROGRAMMATIC_TEST_PROVIDER_ID,
      programmaticScript: {
        steps: [
          { type: 'chunk', text: 'Hello ' },
          { type: 'chunk', text: 'world', delayMs: 25 },
          { type: 'complete', delayMs: 10 },
        ],
      },
    });
    const chunks: string[] = [];
    let completed = '';

    const stream = provider.streamMessage([], {
      onChunk: (chunk) => chunks.push(chunk),
      onComplete: (message) => {
        completed = message.contentBlocks?.[0]?.text ?? '';
      },
    });

    expect(chunks).toEqual(['Hello ']);
    await vi.advanceTimersByTimeAsync(25);
    expect(chunks).toEqual(['Hello ', 'world']);
    await vi.advanceTimersByTimeAsync(10);
    await stream;
    expect(completed).toBe('Hello world');
  });

  it('fails deterministically after scripted updates', async () => {
    const provider = new ProgrammaticTestAgentProvider({
      provider: PROGRAMMATIC_TEST_PROVIDER_ID,
      programmaticScript: {
        steps: [
          { type: 'chunk', text: 'partial' },
          { type: 'error', message: 'planned provider failure' },
        ],
      },
    });
    const chunks: string[] = [];
    let errorMessage = '';

    await expect(
      provider.streamMessage([], {
        onChunk: (chunk) => chunks.push(chunk),
        onError: (error) => {
          errorMessage = error.message;
        },
      }),
    ).rejects.toThrow('planned provider failure');
    expect(chunks).toEqual(['partial']);
    expect(errorMessage).toBe('planned provider failure');
  });

  it('can hang until interrupted for timeout tests', async () => {
    const provider = new ProgrammaticTestAgentProvider({
      provider: PROGRAMMATIC_TEST_PROVIDER_ID,
      programmaticScript: {
        steps: [{ type: 'chunk', text: 'still working' }, { type: 'hang' }],
      },
    });
    let completionMetadata: Record<string, any> | undefined;
    const stream = provider.streamMessage([], {
      onComplete: (message) => {
        completionMetadata = message.metadata;
      },
    });

    const result = await Promise.race([
      stream.then(() => 'resolved'),
      new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 20)),
    ]);
    expect(result).toBe('timeout');
    await provider.stop();
    await stream;
    expect(completionMetadata).toEqual(
      expect.objectContaining({ interrupted: true, stopReason: 'cancelled' }),
    );
  });

  it('supports controlled completion and malformed update emission', async () => {
    const provider = new ProgrammaticTestAgentProvider({
      provider: PROGRAMMATIC_TEST_PROVIDER_ID,
      programmaticScript: {
        steps: [{ type: 'malformed', value: { unexpected: true } }, { type: 'awaitCompletion' }],
      },
    });
    const updates: unknown[] = [];
    let completed = '';

    const stream = provider.streamMessage([], {
      onChunk: (chunk) => updates.push(chunk),
      onComplete: (message) => {
        completed = message.contentBlocks?.[0]?.text ?? '';
      },
    });
    await Promise.resolve();

    expect(updates).toEqual([{ unexpected: true }]);
    await provider.completeActiveRun('manual result');
    await stream;
    expect(completed).toBe('manual result');
  });

  it('is disabled outside test/development gates', () => {
    expect(isProgrammaticTestProviderEnabled({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(
      false,
    );
    expect(
      isProgrammaticTestProviderEnabled({ NODE_ENV: 'development' } as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(
      isProgrammaticTestProviderEnabled({
        NODE_ENV: 'development',
        ENABLE_PROGRAMMATIC_TEST_PROVIDER: 'true',
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });
});
