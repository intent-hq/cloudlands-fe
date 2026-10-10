import { expect, it } from 'vitest';
import { storeTableFixture } from './__tests__/store-table-fixture';
import { NOTE_WINDOW_LIMITS } from './note-window-reader';
import { projectNoteWindow } from './note-window-projection';
import { canonicalTableFixture, nativeFixtureEditor } from './__tests__/canonical-table-fixture';

// Verbatim Store capture from the daemon's real SQLite note index. Expiry is part
// of the frozen response, not a live resource lease. No consumer data is repaired.
for (const version of ['halfopen'] as const)
  for (const role of ['td', 'th'] as const) {
    it(`replays the real Store ${version} ${role} resources into the same far native cell`, async () => {
      const fixture = storeTableFixture(role, version);
      const window = await fixture.read();
      const requests = fixture.requests;
      const control = await canonicalTableFixture(role);
      const projection = projectNoteWindow(window);
      const native = nativeFixtureEditor(projection.content);
      try {
        expect(native.getJSON().content?.[0].content?.[0].content?.[0]).toEqual(
          control.expectedCell,
        );
        expect(window.text).toBe('TARGET</strong></' + role + '></tr></table>');
        expect(requests.filter((q) => q.kind === 'source')).toHaveLength(1);
        expect(window.cost.sourceBytes).toBeLessThan(64);
        expect(window.cost.requests).toBe(requests.length);
        expect(window.cost.requests).toBeLessThanOrEqual(96);
        expect(window.mapBindings).toHaveLength(3);
        const mapRefs = new Set(window.mapBindings.map((b) => b.sourceMapRef));
        expect(
          requests.filter((q) => q.kind === 'context' && mapRefs.has(q.contextRef)),
        ).toHaveLength(1);
        console.info(
          'Store native costs',
          version,
          role,
          window.cost,
          'native nodes',
          window.context.filter((n) => n.kind === 'nativeNode').length,
        );
        const retained = new TextEncoder().encode(
          JSON.stringify({
            context: window.context,
            details: window.details,
            mapBindings: window.mapBindings,
            native: window.native,
            canonicalOwners: window.canonicalOwners,
          }),
        ).length;
        expect(window.cost.canonicalBytes).toBe(retained);
        expect(retained).toBeLessThanOrEqual(8192);
        expect(window.canonicalOwners).toHaveLength(3);
        expect(window.cost.canonicalWorkBytes).toBeGreaterThan(retained);
        expect(window.cost.canonicalBytes).toBeLessThanOrEqual(NOTE_WINDOW_LIMITS.canonicalBytes);
        expect(window.cost.contextBytes - (window.cost.canonicalBytes ?? 0)).toBeLessThanOrEqual(
          NOTE_WINDOW_LIMITS.contextBytes,
        );
        expect(projection.sourceAt(4)).toBe(fixture.at);
      } finally {
        native.destroy();
      }
    });
  }

it('bounds retained canonical graphs independently of source and wire payloads', () => {
  expect(NOTE_WINDOW_LIMITS.canonicalBytes).toBe(32768);
  expect(NOTE_WINDOW_LIMITS.sourceBytes).toBe(8192);
  expect(NOTE_WINDOW_LIMITS.contextBytes).toBe(8192);
  expect(NOTE_WINDOW_LIMITS.wireBytes).toBe(8192);
  expect(NOTE_WINDOW_LIMITS.requests).toBe(96);
});

// Historical unadvertised prototype captures are immutable negative controls.
// Their former success required the rejected 64 KiB exploration limit. Producer
// provenance and original red logs are retained in the task/PR context artifacts.
for (const version of ['original', 'corrected'] as const)
  for (const role of ['td', 'th'] as const) {
    it(`rejects historical ${version} ${role} malformed omitted endpoints before admission`, async () => {
      const fixture = storeTableFixture(role, version);
      const failure = await fixture.read().then(
        () => undefined,
        (error: unknown) => error,
      );
      // Original8KiB rejection logs and exact59-call captures remain immutable.
      // Strict9b886 validation now catches their zero-length omitted maps earlier.
      // This is malformed-producer evidence, not successful retry/paint admission.
      expect(failure).toEqual(new Error('Invalid canonical source map'));
      expect(fixture.requests.filter((request) => request.kind === 'source')).toHaveLength(1);
      expect(fixture.requests.length).toBeLessThanOrEqual(NOTE_WINDOW_LIMITS.requests);
      expect(fixture.requests.every((request) => request.maxWireBytes === 8192)).toBe(true);
    });
  }
