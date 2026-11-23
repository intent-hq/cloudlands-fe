import { describe, expect, it } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import { SETTINGS_SEARCH_TERMS } from './settings-search-terms';
import {
  SETTINGS_SEARCH_SECTIONS,
  searchSettings,
  type SettingsSearchSection,
} from './settings-search-index';

const everything = () => true;

function hitsOf(query: string, isAvailable: (id: string) => boolean = everything) {
  return searchSettings(query, isAvailable).flatMap((group) =>
    group.hits.map((hit) => ({
      tab: group.tab,
      id: hit.section.id,
      rows: hit.rows,
      rowQuery: hit.rowQuery,
    })),
  );
}

describe('settings search index', () => {
  it('keys search terms only by known ids and gives every row terms', () => {
    const sectionIds = SETTINGS_SEARCH_SECTIONS.map((section) => section.id);
    const rowIds = SETTINGS_SEARCH_SECTIONS.flatMap((section) =>
      (section.rows ?? []).map((row) => row.id),
    );
    const known = new Set([...sectionIds, ...rowIds]);
    expect(Object.keys(SETTINGS_SEARCH_TERMS).filter((id) => !known.has(id))).toEqual([]);
    expect(rowIds.filter((id) => !SETTINGS_SEARCH_TERMS[id])).toEqual([]);
  });

  it('uses unique section and row ids', () => {
    const ids = SETTINGS_SEARCH_SECTIONS.flatMap((section) => [
      section.id,
      ...(section.rows ?? []).map((row) => row.id),
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('searchSettings', () => {
  it('returns nothing for a blank query', () => {
    expect(searchSettings('   ', everything)).toEqual([]);
  });

  it('shows only the matching rows of a section that has rows', () => {
    const query = m.settings_appearance_translucentWindow_label();
    expect(hitsOf(query)).toContainEqual({
      tab: 'performance',
      id: 'performance',
      rows: ['translucent-window'],
      rowQuery: query,
    });
  });

  it('shows the whole section without a row filter when its title matches', () => {
    const query = m.settings_section_voice();
    expect(hitsOf(query)).toContainEqual({ tab: 'input', id: 'voice', rows: null, rowQuery: '' });
  });

  it('passes the query to nested forms when only the section content matches', () => {
    const query = m.settings_labs_tabGroups_label();
    expect(hitsOf(query)).toContainEqual({
      tab: 'advanced',
      id: 'labs',
      rows: null,
      rowQuery: query,
    });
  });

  it('shows every section of a tab whose label matches', () => {
    const query = m.settings_sidebar_performance_label();
    const performance = SETTINGS_SEARCH_SECTIONS.filter((section) => section.tab === 'performance');
    const hits = hitsOf(query).filter((hit) => hit.tab === 'performance');
    expect(hits.map((hit) => hit.id)).toEqual(performance.map((section) => section.id));
    expect(hits.every((hit) => hit.rows === null && hit.rowQuery === '')).toBe(true);
  });

  it('requires every query term, in any order and case', () => {
    const label = m.settings_appearance_reduceMotionOnBattery_label();
    const [first, ...rest] = label.split(/\s+/);
    const reordered = [...rest, first].join('  ').toLocaleUpperCase();
    expect(hitsOf(reordered).map((hit) => hit.rows)).toContainEqual(['reduce-motion-on-battery']);
    expect(hitsOf(`${label} zzzz-no-such-setting`)).toEqual([]);
  });

  it('leaves out unavailable sections and rows', () => {
    const rowQuery = m.settings_appearance_menuBarAutoHide_label();
    expect(
      hitsOf(rowQuery, (id) => id !== 'menu-bar-auto-hide').map((hit) => hit.rows),
    ).not.toContainEqual(['menu-bar-auto-hide']);
    expect(
      hitsOf(m.settings_section_voice(), (id) => id !== 'voice').map((hit) => hit.id),
    ).not.toContain('voice');
  });

  it('groups hits by tab in section order', () => {
    const sections: SettingsSearchSection[] = [
      { id: 'a', tab: 'display', title: () => 'Alpha shared' },
      { id: 'b', tab: 'display', title: () => 'Beta shared' },
      { id: 'c', tab: 'input', title: () => 'Gamma shared' },
      { id: 'd', tab: 'input', title: () => 'Delta' },
    ];
    const groups = searchSettings('shared', everything, sections);
    expect(groups.map((group) => [group.tab, group.hits.map((hit) => hit.section.id)])).toEqual([
      ['display', ['a', 'b']],
      ['input', ['c']],
    ]);
  });
});
