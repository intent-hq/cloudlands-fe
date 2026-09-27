// @vitest-environment node
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveCtAlignedPlaywrightCli } from '../scripts/run-ct-tests.mjs';

// Exercise the installed CT driver's real rewrite path with protocol responses.
// Upstream: microsoft/playwright#41868, commit 4cd8608744bf4d18c9f23578c3cf4a1cd1862b2d.
const ctRequire = createRequire(resolveCtAlignedPlaywrightCli().cliPath);
const core = dirname(ctRequire.resolve('playwright-core/package.json'));
const { CRExecutionContext } = ctRequire(join(core, 'lib/server/chromium/crExecutionContext.js'));
const { ProtocolError } = ctRequire(join(core, 'lib/server/protocolError.js'));

function evaluation(error: Error) {
  const context = new CRExecutionContext(
    {
      send: async () => {
        throw error;
      },
    },
    { id: 1 },
  );
  return context.evaluateWithArguments('() => 42', true, { _objectId: 'utility' }, [], []);
}

describe('CT Chromium error classification', () => {
  it('reports collected promises without claiming navigation', async () => {
    await expect(
      evaluation(new Error('Protocol error (Runtime.callFunctionOn): Promise was collected')),
    ).rejects.toThrow('Resulting promise was garbage collected.');
  });

  it('still reports an actual destroyed execution context', async () => {
    await expect(evaluation(new Error('Cannot find context with specified id'))).rejects.toThrow(
      'Execution context was destroyed',
    );
  });

  it('preserves closed-session errors', async () => {
    const error = new ProtocolError('closed');
    await expect(evaluation(error)).rejects.toBe(error);
  });

  it('preserves serialization errors', async () => {
    await expect(evaluation(new Error('Object reference chain is too long'))).rejects.toThrow(
      'Cannot serialize result',
    );
  });
});
