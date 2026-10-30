/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import {
  mentionChipDisplayLabel,
  noteMentionWorkspace,
  relabelNoteChipsInHtml,
  type NoteTitleLookup,
} from './note-mention-label';

const titles: Record<string, Record<string, string>> = {
  'ws-1': { n1: 'Renamed meeting', spec: 'Spec' },
  'ws-2': { n9: 'Other plan (renamed)' },
};
const lookup: NoteTitleLookup = (ws, id) => titles[ws]?.[id];

describe('noteMentionWorkspace', () => {
  it('uses the chip workspace only for sibling-workspace chips', () => {
    expect(noteMentionWorkspace({ workspaceId: 'ws-2', isExternalLink: true }, 'ws-1')).toBe(
      'ws-2',
    );
    expect(noteMentionWorkspace({ workspaceId: 'ws-2' }, 'ws-1')).toBe('ws-1');
    expect(noteMentionWorkspace(null, 'ws-1')).toBe('ws-1');
    expect(noteMentionWorkspace(null, undefined)).toBeUndefined();
  });
});

describe('mentionChipDisplayLabel', () => {
  it('shows the live title of a note in the current workspace', () => {
    expect(
      mentionChipDisplayLabel({ type: 'note', id: 'n1', label: 'Old meeting' }, 'ws-1', lookup),
    ).toBe('Renamed meeting');
  });

  it('looks up a sibling-workspace note in its own workspace', () => {
    expect(
      mentionChipDisplayLabel(
        {
          type: 'note',
          id: 'n9',
          label: 'Other plan',
          meta: { workspaceId: 'ws-2', isExternalLink: true },
        },
        'ws-1',
        lookup,
      ),
    ).toBe('Other plan (renamed)');
  });

  it('falls back to the saved label when the note is not in the store', () => {
    expect(
      mentionChipDisplayLabel({ type: 'note', id: 'gone', label: 'Deleted note' }, 'ws-1', lookup),
    ).toBe('Deleted note');
    expect(mentionChipDisplayLabel({ type: 'note', id: 'n1', label: 'Saved' }, 'ws-1')).toBe(
      'Saved',
    );
  });

  it('leaves non-note chips alone', () => {
    expect(
      mentionChipDisplayLabel({ type: 'file', id: 'n1', label: 'src/a.ts' }, 'ws-1', lookup),
    ).toBe('src/a.ts');
    expect(mentionChipDisplayLabel({ type: 'file', id: 'x' }, 'ws-1', lookup)).toBe('x');
  });
});

describe('relabelNoteChipsInHtml', () => {
  const chip = (id: string, label: string, meta = {}) =>
    `<span data-mention="true" data-type="note" data-id="${id}" data-label="${label}" data-meta='${JSON.stringify(meta)}' class="mention-chip">${label}</span>`;

  it('relabels note chips with live titles and keeps the saved data-label', () => {
    const html = `<p>See ${chip('n1', 'Old meeting')} and ${chip('n9', 'Other plan', { workspaceId: 'ws-2', isExternalLink: true })}</p>`;
    const container = document.createElement('div');
    container.innerHTML = relabelNoteChipsInHtml(html, 'ws-1', lookup);
    const chips = container.querySelectorAll('[data-type="note"]');
    expect(chips[0].textContent).toBe('Renamed meeting');
    expect(chips[0].getAttribute('data-label')).toBe('Old meeting');
    expect(chips[1].textContent).toBe('Other plan (renamed)');
  });

  it('returns the same string when nothing changes', () => {
    const html = `<p>${chip('gone', 'Deleted note')}</p>`;
    expect(relabelNoteChipsInHtml(html, 'ws-1', lookup)).toBe(html);
    const plain = '<p>no chips here</p>';
    expect(relabelNoteChipsInHtml(plain, 'ws-1', lookup)).toBe(plain);
  });
});
