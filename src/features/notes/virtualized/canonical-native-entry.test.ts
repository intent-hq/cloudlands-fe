import { expect, it } from 'vitest';
import { canonicalTableFixture, nativeFixtureEditor } from './__tests__/canonical-table-fixture';
import { projectNoteWindow } from './note-window-projection';
import { NoteCanonicalProjection } from './note-canonical-projection';
it.each(['td', 'th'] as const)(
  'renders the actual native %s subtree after a multimegabyte earlier cell',
  async (role) => {
    const fixture = await canonicalTableFixture(role);
    const window = await fixture.read();
    const projection = projectNoteWindow(window);
    const mounted = nativeFixtureEditor(projection.content);
    try {
      expect(mounted.getJSON().content![0].content![0].content![0]).toEqual(fixture.expectedCell);
      expect(mounted.state.doc.textContent).toBe('TARGET');
      expect(projection.sourceAt(4)).toBe(fixture.at);
      expect(projection.sourceAt(10)).toBe(fixture.at + 6);
      expect(
        (projection as NoteCanonicalProjection).nativeEntries.find((n) => n.id === 'id-3'),
      ).toMatchObject({ childIndex: 2, nodeType: role === 'td' ? 'tableCell' : 'tableHeader' });
      expect(fixture.requests.filter((q) => q.kind === 'source')).toHaveLength(1);
      expect(fixture.requests.length).toBeLessThan(40);
      expect(window.cost.sourceBytes).toBeLessThan(64);
      expect(window.cost.contextBytes).toBeLessThanOrEqual(8192);
    } finally {
      mounted.destroy();
    }
  },
);
