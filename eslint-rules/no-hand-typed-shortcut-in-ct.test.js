// @vitest-environment node
import path from 'node:path';
import { Linter, RuleTester } from 'eslint';
import { describe, expect, it } from 'vitest';
import { SHORTCUT_DEFAULTS } from '../src/lib/utils/shortcut-bindings.ts';
import rule from './no-hand-typed-shortcut-in-ct.js';

const filename = path.resolve('src/lib/components/example/example.ct.spec.ts');
const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

const bindings = {
  'panel.create-column-right': 'mod+\\',
  'panel.focus-next-column': 'mod+alt+right',
  'global.keyboard-shortcuts': 'mod+?',
  'global.command-palette': 'mod+shift+p',
  'global.next-space': 'ctrl+tab',
  'editor.toggle-word-wrap': 'alt+z',
  'editor.select-all': 'mod+a',
  'chat.new-line': 'shift+enter',
  'chat.send': 'enter',
  'navigation.go-to-tab': 'mod+1-9',
  'leader.navigate-panels': 'h/j/k/l',
  'leader.jump-to-panel': 'q + 1-9',
};
const options = [{ bindings, ignore: { 'editor.select-all': 'native text selection' } }];

const inTest = (body) => `
test('presses keys', async ({ mount, page }) => {
${body}
});`;

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const error = (chord, shortcut) => ({
  message: new RegExp(`^${escape(`\`${chord}\` is the \`${shortcut}\``)}`),
});

const lint = (body, ruleOptions) =>
  new Linter().verify(
    inTest(body),
    {
      files: ['**/*.ct.spec.ts'],
      languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
      plugins: { intent: { rules: { rule } } },
      rules: { 'intent/rule': ['error', ruleOptions] },
    },
    filename,
  );

describe('no-hand-typed-shortcut-in-ct guidance', () => {
  it('names the helper, the direct import, the incidents and the escape hatch', () => {
    const message = rule.meta.messages.handTypedShortcut;
    expect(message).toContain('shortcutChord(SHORTCUT_DEFAULTS[{{id}}], isMac)');
    expect(message).toContain('src/test/shortcut-chords.ts');
    expect(message).toContain("Import SHORTCUT_DEFAULTS from '$lib/utils/shortcut-bindings'");
    expect(message).toContain('scripts/verify-changed.mjs');
    expect(message).toContain('cloudlands-fe#4205');
    expect(message).toContain('intent-hq/intent#8681');
    expect(message).toContain('disable this rule on that line with a reason');
  });

  it('flags the hand-typed create-column chord against the real table', () => {
    const messages = lint(`  await page.keyboard.press('Control+Backslash');`, {
      bindings: SHORTCUT_DEFAULTS,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toContain(
      '`Control+Backslash` is the `panel.create-column-right` (`mod+\\`) shortcut',
    );
    expect(messages[0].message).toContain("SHORTCUT_DEFAULTS['panel.create-column-right']");
  });

  it('rejects an ignore entry for a shortcut the table does not have', () => {
    expect(() =>
      lint(`  await page.keyboard.press('Enter');`, {
        bindings,
        ignore: { 'editor.gone': 'moved' },
      }),
    ).toThrow('unknown ignored shortcut editor.gone');
  });
});

tester.run('no-hand-typed-shortcut-in-ct', rule, {
  valid: [
    {
      name: 'keys read from the table',
      filename,
      options,
      code: inTest(`
  const chord = shortcutChord(SHORTCUT_DEFAULTS['panel.create-column-right'], isMac);
  await page.keyboard.press(chord.press);
  element.dispatchEvent(new KeyboardEvent('keydown', { ...chord.event, bubbles: true }));`),
    },
    {
      name: 'chords no shortcut uses',
      filename,
      options,
      code: inTest(`
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+F10');
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Alt+t');
  await page.keyboard.press('Meta+Shift+Backslash');`),
    },
    {
      name: 'bare keys, even when a shortcut is bound to one',
      filename,
      options,
      code: inTest(`
  await page.keyboard.press('Enter');
  await page.keyboard.press('h');
  await editor.dispatchEvent('keydown', { key: 'Enter', isComposing: true });`),
    },
    {
      name: 'ranges, sequences and alternatives are not single chords',
      filename,
      options,
      code: inTest(`
  await page.keyboard.press('Meta+1');
  await page.keyboard.press('Control+9');`),
    },
    {
      name: 'an ignored shortcut',
      filename,
      options,
      code: inTest(`
  await input.press('ControlOrMeta+A');`),
    },
    {
      name: 'a keyup, a spread init and a computed modifier are not read',
      filename,
      options,
      code: inTest(`
  await editor.dispatchEvent('keyup', { key: '\\\\', ctrlKey: true });
  new KeyboardEvent('keydown', { ...base, key: '\\\\' });
  new KeyboardEvent('keydown', { key: '\\\\', ctrlKey: !isMac, metaKey: isMac });`),
    },
    {
      name: 'a file that is not a component spec',
      filename: path.resolve('src/test/shortcut-chords.test.ts'),
      options,
      code: inTest(`
  expect(shortcutChord('mod+\\\\', false).press).toBe('Control+Backslash');
  await page.keyboard.press('Control+Backslash');`),
    },
  ],
  invalid: [
    {
      name: 'press strings on either platform',
      filename,
      options,
      code: inTest(`
  await page.keyboard.press('Control+Backslash');
  await page.keyboard.press('Meta+Backslash');
  await page.keyboard.press('Meta+\\\\');
  await page.keyboard.press('ControlOrMeta+Alt+ArrowRight');`),
      errors: [
        error('Control+Backslash', 'panel.create-column-right'),
        error('Meta+Backslash', 'panel.create-column-right'),
        error('Meta+\\', 'panel.create-column-right'),
        error('ControlOrMeta+Alt+ArrowRight', 'panel.focus-next-column'),
      ],
    },
    {
      name: 'locator.press, page.press(selector, key) and a plain template',
      filename,
      options,
      code: inTest(`
  await composer.press('Shift+Enter');
  await page.press('#editor', 'Alt+z');
  await page.keyboard.press(\`Control+Tab\`);`),
      errors: [
        error('Shift+Enter', 'chat.new-line'),
        error('Alt+z', 'editor.toggle-word-wrap'),
        error('Control+Tab', 'global.next-space'),
      ],
    },
    {
      name: 'shifted characters, key codes and letter case',
      filename,
      options,
      code: inTest(`
  await page.keyboard.press('Meta+?');
  await page.keyboard.press('Control+Shift+Slash');
  await page.keyboard.press('ControlOrMeta+Shift+P');
  await page.keyboard.press('Meta+Shift+KeyP');`),
      errors: [
        error('Meta+?', 'global.keyboard-shortcuts'),
        error('Control+Shift+Slash', 'global.keyboard-shortcuts'),
        error('ControlOrMeta+Shift+P', 'global.command-palette'),
        error('Meta+Shift+KeyP', 'global.command-palette'),
      ],
    },
    {
      name: 'KeyboardEvent inits',
      filename,
      options,
      code: inTest(`
  element.dispatchEvent(new KeyboardEvent('keydown', { key: '\\\\', ctrlKey: true, bubbles: true }));
  await panel.dispatchEvent('keydown', { key: 'ArrowRight', metaKey: true, altKey: true });
  new KeyboardEvent('keydown', { code: 'Slash', key: '?', metaKey: true, shiftKey: true });
  new KeyboardEvent(type, { key: 'P', ctrlKey: true, shiftKey: true });`),
      errors: [
        error('Control+\\', 'panel.create-column-right'),
        error('Meta+Alt+ArrowRight', 'panel.focus-next-column'),
        error('Meta+Shift+/', 'global.keyboard-shortcuts'),
        error('Control+Shift+p', 'global.command-palette'),
      ],
    },
  ],
});
