/**
 * Graceful-shutdown ordering regression guard.
 *
 * `ConsolidatedBackendService.shutdown()` (invoked by `shutdownUnifiedBackend`)
 * already saves sessions and kills providers, so our clean-quit flush from
 * `agentBackendHandler.persistShutdownState()` MUST run BEFORE
 * `shutdownUnifiedBackend()` — otherwise the flush either races against
 * cleared state or is overwritten by the backend's own shutdown.
 *
 * Importing `src/main/index.ts` has heavy top-level side effects (Sentry,
 * electron app, IPC registration), so rather than mock-and-invoke the
 * `gracefulShutdown` closure we assert the static call ordering directly on
 * the source file — same approach as `ipc-startup-race.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const INDEX_PATH = path.resolve(__dirname, '..', 'index.ts');

function findCallIndex(source: string, needle: RegExp): number {
  const m = source.match(needle);
  if (!m || m.index == null) return -1;
  return m.index;
}

describe('gracefulShutdown call ordering', () => {
  it('calls persistShutdownState() BEFORE shutdownUnifiedBackend()', () => {
    const src = fs.readFileSync(INDEX_PATH, 'utf8');

    const persistIdx = findCallIndex(
      src,
      /agentBackendHandler\.persistShutdownState\s*\(/,
    );
    const unifiedIdx = findCallIndex(src, /shutdownUnifiedBackend\s*\(/);

    expect(persistIdx).toBeGreaterThan(-1);
    expect(unifiedIdx).toBeGreaterThan(-1);
    expect(persistIdx).toBeLessThan(unifiedIdx);
  });

  it('persistShutdownState() call is inside gracefulShutdown', () => {
    const src = fs.readFileSync(INDEX_PATH, 'utf8');
    // Find the gracefulShutdown declaration.
    const declRe = /async\s+function\s+gracefulShutdown\s*\(/;
    const declMatch = src.match(declRe);
    expect(declMatch?.index).toBeGreaterThan(-1);
    const declStart = declMatch!.index!;
    // persistShutdownState must appear AFTER the declaration.
    const persistIdx = findCallIndex(
      src,
      /agentBackendHandler\.persistShutdownState\s*\(/,
    );
    expect(persistIdx).toBeGreaterThan(declStart);
  });
});
