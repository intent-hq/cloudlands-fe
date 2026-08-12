import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../shared/logger', () => ({
  Logger: class MockLogger {
    info = loggerMocks.info;
    warn = loggerMocks.warn;
    error = loggerMocks.error;
  },
}));

vi.mock('../../shared/main/ipc-debug-tracker', () => ({
  ipcDebugTracker: {
    trackCall: vi.fn(),
    trackSuccess: vi.fn(),
    trackValidationError: vi.fn(),
  },
}));

import { createSafeValidatedHandler } from '../ipc-validation-middleware';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('stream-message IPC logging', () => {
  it('logs exact image metadata without retaining image contents', async () => {
    const imageData = 'x'.repeat(37);
    const schema = z.object({
      imageBlocks: z.array(
        z.object({
          type: z.literal('image'),
          data: z.string(),
          mimeType: z.string(),
        }),
      ),
    });
    const handler = createSafeValidatedHandler(
      schema,
      async () => ({ success: true }),
      'agent-backend:stream-message',
    );

    await handler({} as never, {
      imageBlocks: [{ type: 'image', data: imageData, mimeType: 'image/png' }],
    });

    const safeContext = {
      channelName: 'agent-backend:stream-message',
      hasImageBlocks: true,
      imageBlocksCount: 1,
      imageBlocksType: 'array',
      imageBlocksDataLength: 37,
    };
    expect(loggerMocks.info.mock.calls).toEqual([
      ['IPC Handler: Received STREAM_MESSAGE request', safeContext],
      ['IPC Handler: After validation STREAM_MESSAGE request', safeContext],
    ]);
    expect(JSON.stringify(loggerMocks.info.mock.calls)).not.toContain(imageData);
  });
});
