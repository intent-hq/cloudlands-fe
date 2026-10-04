import { expect, it } from 'vitest';
import { storeTableFixture } from './__tests__/store-table-fixture';
import { NOTE_WINDOW_LIMITS } from './note-window-reader';
import { projectNoteWindow } from './note-window-projection';
import { canonicalTableFixture, nativeFixtureEditor } from './__tests__/canonical-table-fixture';

// Verbatim Store capture from the daemon's real SQLite note index. Expiry is part
// of the frozen response, not a live resource lease. No consumer data is repaired.
for (const version of ['original', 'corrected'] as const)
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
