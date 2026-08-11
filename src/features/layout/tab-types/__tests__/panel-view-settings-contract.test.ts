import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const tabTypesDirectory = join(process.cwd(), 'src/features/layout/tab-types');

function source(fileName: string): string {
  return readFileSync(join(tabTypesDirectory, fileName), 'utf8');
}

describe('panel header view settings consolidation', () => {
  it.each([
    'FileTabType.svelte',
    'DiffTabType.svelte',
    'ActivityChangesTabType.svelte',
    'LocalChangesTabType.svelte',
    'ChangesTabType.svelte',
  ])('uses the shared view settings menu in %s', (fileName) => {
    const contents = source(fileName);
    expect(contents).toContain('ViewSettingsDropdown');
    expect(contents).not.toContain('headerToggleActiveClass');
  });

  it.each(['NoteTabType.svelte', 'AgentTabType.svelte'])(
    'uses a content-specific view settings menu in %s',
    (fileName) => {
      const contents = source(fileName);
      expect(contents).toMatch(/(?:Note|Agent)ViewSettingsDropdown/);
    },
  );

  it.each(['BrowserTabType.svelte', 'TerminalTabType.svelte'])(
    'does not add an empty settings menu to %s',
    (fileName) => {
      expect(source(fileName)).not.toContain('ViewSettingsDropdown');
    },
  );

  it.each(['NoteViewSettingsDropdown.svelte', 'AgentViewSettingsDropdown.svelte'])(
    'uses a background-free typographic font picker in %s',
    (fileName) => {
      const contents = source(fileName);
      expect(contents).not.toContain('bg-muted/35');
      expect(contents).toContain('data-[state=on]:bg-transparent');
      expect(contents).toContain('data-[state=on]:border-primary');
      expect(contents).toContain('type-title');
      expect(contents).toContain('icon={faCheck}');
      expect(contents).not.toContain('ui_viewSettings_options_label');
    },
  );
});
