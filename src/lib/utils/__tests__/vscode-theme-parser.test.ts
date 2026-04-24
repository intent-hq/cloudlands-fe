/**
 * Tests for VS Code theme parser
 */

import { describe, it, expect } from 'vitest';
import {
  hexToHSL,
  isHexDark,
  parseVSCodeTheme,
  stripJSONC,
} from '../vscode-theme-parser';

// ── hexToHSL ───────────────────────────────────────────────────────────────

describe('hexToHSL', () => {
  it('converts pure white', () => {
    expect(hexToHSL('#ffffff')).toBe('0 0% 100%');
  });

  it('converts pure black', () => {
    expect(hexToHSL('#000000')).toBe('0 0% 0%');
  });

  it('converts pure red', () => {
    expect(hexToHSL('#ff0000')).toBe('0 100% 50%');
  });

  it('converts pure green', () => {
    expect(hexToHSL('#00ff00')).toBe('120 100% 50%');
  });

  it('converts pure blue', () => {
    expect(hexToHSL('#0000ff')).toBe('240 100% 50%');
  });

  it('converts a typical dark editor background', () => {
    // #1e1e2e → dark blue-ish
    const result = hexToHSL('#1e1e2e');
    expect(result).toMatch(/^\d+ \d+% \d+%$/);
    // Lightness should be low for a dark color
    const lightness = parseInt(result.split(' ')[2]);
    expect(lightness).toBeLessThan(20);
  });

  it('handles 3-digit hex (#RGB)', () => {
    // #fff → white
    expect(hexToHSL('#fff')).toBe('0 0% 100%');
  });

  it('handles 8-digit hex (#RRGGBBAA) by ignoring alpha', () => {
    // #ff0000ff → pure red, alpha ignored
    expect(hexToHSL('#ff0000ff')).toBe('0 100% 50%');
  });

  it('handles 4-digit hex (#RGBA) by ignoring alpha', () => {
    expect(hexToHSL('#f00f')).toBe('0 100% 50%');
  });

  it('handles hex without # prefix', () => {
    expect(hexToHSL('ffffff')).toBe('0 0% 100%');
  });

  it('returns fallback for invalid input', () => {
    expect(hexToHSL('#zz')).toBe('0 0% 0%');
  });
});

// ── isHexDark ──────────────────────────────────────────────────────────────

describe('isHexDark', () => {
  it('identifies black as dark', () => {
    expect(isHexDark('#000000')).toBe(true);
  });

  it('identifies white as light', () => {
    expect(isHexDark('#ffffff')).toBe(false);
  });

  it('identifies a typical dark editor bg as dark', () => {
    expect(isHexDark('#1e1e2e')).toBe(true);
  });

  it('identifies a typical light editor bg as light', () => {
    expect(isHexDark('#f5f5f5')).toBe(false);
  });

  it('handles short hex', () => {
    expect(isHexDark('#000')).toBe(true);
    expect(isHexDark('#fff')).toBe(false);
  });
});

// ── parseVSCodeTheme ───────────────────────────────────────────────────────

describe('parseVSCodeTheme', () => {
  const MINIMAL_DARK_THEME = {
    name: 'Test Dark',
    type: 'dark',
    colors: {
      'editor.background': '#1e1e2e',
      'editor.foreground': '#cdd6f4',
      'sideBar.background': '#181825',
      'sideBar.foreground': '#cdd6f4',
      'button.background': '#89b4fa',
      'button.foreground': '#1e1e2e',
      'focusBorder': '#89b4fa',
      'input.background': '#313244',
      'panel.border': '#45475a',
      'badge.background': '#f5c2e7',
      'list.activeSelectionBackground': '#45475a',
      'list.activeSelectionForeground': '#cdd6f4',
      'tab.inactiveBackground': '#181825',
      'descriptionForeground': '#a6adc8',
      'errorForeground': '#f38ba8',
      'terminal.background': '#1e1e2e',
      'terminal.foreground': '#cdd6f4',
      'terminal.ansiBlack': '#45475a',
      'terminal.ansiRed': '#f38ba8',
      'terminal.ansiGreen': '#a6e3a1',
      'terminal.ansiYellow': '#f9e2af',
      'terminal.ansiBlue': '#89b4fa',
      'terminal.ansiMagenta': '#f5c2e7',
      'terminal.ansiCyan': '#94e2d5',
      'terminal.ansiWhite': '#bac2de',
      'terminal.ansiBrightBlack': '#585b70',
      'terminal.ansiBrightRed': '#f38ba8',
      'terminal.ansiBrightGreen': '#a6e3a1',
      'terminal.ansiBrightYellow': '#f9e2af',
      'terminal.ansiBrightBlue': '#89b4fa',
      'terminal.ansiBrightMagenta': '#f5c2e7',
      'terminal.ansiBrightCyan': '#94e2d5',
      'terminal.ansiBrightWhite': '#a6adc8',
    },
    tokenColors: [
      {
        scope: 'comment',
        settings: { foreground: '#6c7086', fontStyle: 'italic' },
      },
      {
        scope: ['keyword', 'storage.type'],
        settings: { foreground: '#cba6f7' },
      },
      {
        scope: 'string',
        settings: { foreground: '#a6e3a1' },
      },
    ],
  };


  // ── Validation ─────────────────────────────────────────────────────────

  it('throws on null input', () => {
    expect(() => parseVSCodeTheme(null)).toThrow('expected an object');
  });

  it('throws on non-object input', () => {
    expect(() => parseVSCodeTheme('not an object')).toThrow('expected an object');
  });

  it('throws when neither colors nor tokenColors present', () => {
    expect(() => parseVSCodeTheme({ name: 'Empty' })).toThrow(
      'must contain "colors" or "tokenColors"',
    );
  });

  it('accepts a theme with only tokenColors', () => {
    const result = parseVSCodeTheme({
      tokenColors: [{ scope: 'comment', settings: { foreground: '#6c7086' } }],
    });
    expect(result.name).toBe('Imported Theme');
    expect(result.monacoTheme.rules.length).toBe(1);
  });

  // ── Theme type detection ───────────────────────────────────────────────

  it('detects dark type from explicit type field', () => {
    const result = parseVSCodeTheme(MINIMAL_DARK_THEME);
    expect(result.type).toBe('dark');
  });

  it('detects light type from explicit type field', () => {
    const result = parseVSCodeTheme({
      ...MINIMAL_DARK_THEME,
      type: 'light',
    });
    expect(result.type).toBe('light');
  });

  it('detects hc-black as dark', () => {
    const result = parseVSCodeTheme({
      ...MINIMAL_DARK_THEME,
      type: 'hc-black',
    });
    expect(result.type).toBe('dark');
  });

  it('detects hc-light as light', () => {
    const result = parseVSCodeTheme({
      ...MINIMAL_DARK_THEME,
      type: 'hc-light',
    });
    expect(result.type).toBe('light');
  });

  it('falls back to editor.background heuristic when type is missing', () => {
     
    const { type: _type, ...noType } = MINIMAL_DARK_THEME;
    const result = parseVSCodeTheme(noType);
    expect(result.type).toBe('dark');
  });

  it('detects light from bright editor.background when type is missing', () => {
    const result = parseVSCodeTheme({
      colors: { 'editor.background': '#ffffff' },
    });
    expect(result.type).toBe('light');
  });

  // ── Name ───────────────────────────────────────────────────────────────

  it('uses theme name from JSON', () => {
    const result = parseVSCodeTheme(MINIMAL_DARK_THEME);
    expect(result.name).toBe('Test Dark');
  });

  it('defaults name to "Imported Theme"', () => {
    const result = parseVSCodeTheme({
      colors: { 'editor.background': '#1e1e2e' },
    });
    expect(result.name).toBe('Imported Theme');
  });

  // ── CSS variables ──────────────────────────────────────────────────────

  it('maps editor.background to --background', () => {
    const result = parseVSCodeTheme(MINIMAL_DARK_THEME);
    expect(result.cssVariables['--background']).toBeDefined();
    expect(result.cssVariables['--background']).toMatch(/^\d+ \d+% \d+%$/);
  });

  it('maps editor.foreground to --foreground', () => {
    const result = parseVSCodeTheme(MINIMAL_DARK_THEME);
    expect(result.cssVariables['--foreground']).toBeDefined();
  });

  it('maps sideBar.background to --sidebar', () => {
    const result = parseVSCodeTheme(MINIMAL_DARK_THEME);
    expect(result.cssVariables['--sidebar']).toBeDefined();
  });

  it('maps button.background to --primary', () => {
    const result = parseVSCodeTheme(MINIMAL_DARK_THEME);
    expect(result.cssVariables['--primary']).toBeDefined();
  });

  it('maps focusBorder to --ring', () => {
    const result = parseVSCodeTheme(MINIMAL_DARK_THEME);
    expect(result.cssVariables['--ring']).toBeDefined();
  });

  it('maps errorForeground to --destructive', () => {
    const result = parseVSCodeTheme(MINIMAL_DARK_THEME);
    expect(result.cssVariables['--destructive']).toBeDefined();
  });

  it('first match wins for duplicate CSS variable targets', () => {
    // panel.border and editorGroup.border both map to --border
    const result = parseVSCodeTheme({
      type: 'dark',
      colors: {
        'panel.border': '#aaaaaa',
        'editorGroup.border': '#bbbbbb',
      },
    });
    // panel.border comes first in the map, so it should win
    expect(result.cssVariables['--border']).toBe(hexToHSL('#aaaaaa'));
  });

  it('skips CSS variables when VS Code key is missing', () => {
    const result = parseVSCodeTheme({
      type: 'dark',
      colors: { 'editor.background': '#1e1e2e' },
    });
    // Only --background should be set
    expect(result.cssVariables['--background']).toBeDefined();
    expect(result.cssVariables['--foreground']).toBeUndefined();
  });

  // ── Monaco theme ───────────────────────────────────────────────────────

  it('sets base to vs-dark for dark themes', () => {
    const result = parseVSCodeTheme(MINIMAL_DARK_THEME);
    expect(result.monacoTheme.base).toBe('vs-dark');
  });

  it('sets base to vs for light themes', () => {
    const result = parseVSCodeTheme({ ...MINIMAL_DARK_THEME, type: 'light' });
    expect(result.monacoTheme.base).toBe('vs');
  });

  it('sets inherit to true', () => {
    const result = parseVSCodeTheme(MINIMAL_DARK_THEME);
    expect(result.monacoTheme.inherit).toBe(true);
  });

  it('converts tokenColors to Monaco rules', () => {
    const result = parseVSCodeTheme(MINIMAL_DARK_THEME);
    const rules = result.monacoTheme.rules;

    // comment scope
    const commentRule = rules.find((r) => r.token === 'comment');
    expect(commentRule).toBeDefined();
    expect(commentRule!.foreground).toBe('6c7086');
    expect(commentRule!.fontStyle).toBe('italic');

    // keyword scope (from array)
    const keywordRule = rules.find((r) => r.token === 'keyword');
    expect(keywordRule).toBeDefined();
    expect(keywordRule!.foreground).toBe('cba6f7');

    // storage.type scope (from same array entry)
    const storageRule = rules.find((r) => r.token === 'storage.type');
    expect(storageRule).toBeDefined();
    expect(storageRule!.foreground).toBe('cba6f7');
  });

  it('strips # from foreground/background in rules', () => {
    const result = parseVSCodeTheme(MINIMAL_DARK_THEME);
    for (const rule of result.monacoTheme.rules) {
      if (rule.foreground) {
        expect(rule.foreground).not.toContain('#');
      }
      if (rule.background) {
        expect(rule.background).not.toContain('#');
      }
    }
  });

  it('passes through colors to Monaco theme', () => {
    const result = parseVSCodeTheme(MINIMAL_DARK_THEME);
    expect(result.monacoTheme.colors['editor.background']).toBe('#1e1e2e');
  });

  // ── Terminal colors ────────────────────────────────────────────────────

  it('maps terminal.background to background', () => {
    const result = parseVSCodeTheme(MINIMAL_DARK_THEME);
    expect(result.terminalColors.background).toBe('#1e1e2e');
  });

  it('maps terminal.foreground to foreground', () => {
    const result = parseVSCodeTheme(MINIMAL_DARK_THEME);
    expect(result.terminalColors.foreground).toBe('#cdd6f4');
  });

  it('maps all 8 standard ANSI colors', () => {
    const result = parseVSCodeTheme(MINIMAL_DARK_THEME);
    expect(result.terminalColors.black).toBe('#45475a');
    expect(result.terminalColors.red).toBe('#f38ba8');
    expect(result.terminalColors.green).toBe('#a6e3a1');
    expect(result.terminalColors.yellow).toBe('#f9e2af');
    expect(result.terminalColors.blue).toBe('#89b4fa');
    expect(result.terminalColors.magenta).toBe('#f5c2e7');
    expect(result.terminalColors.cyan).toBe('#94e2d5');
    expect(result.terminalColors.white).toBe('#bac2de');
  });

  it('maps all 8 bright ANSI colors', () => {
    const result = parseVSCodeTheme(MINIMAL_DARK_THEME);
    expect(result.terminalColors.brightBlack).toBe('#585b70');
    expect(result.terminalColors.brightRed).toBe('#f38ba8');
    expect(result.terminalColors.brightGreen).toBe('#a6e3a1');
    expect(result.terminalColors.brightYellow).toBe('#f9e2af');
    expect(result.terminalColors.brightBlue).toBe('#89b4fa');
    expect(result.terminalColors.brightMagenta).toBe('#f5c2e7');
    expect(result.terminalColors.brightCyan).toBe('#94e2d5');
    expect(result.terminalColors.brightWhite).toBe('#a6adc8');
  });

  // ── rawColors ──────────────────────────────────────────────────────────

  it('preserves all original colors in rawColors', () => {
    const result = parseVSCodeTheme(MINIMAL_DARK_THEME);
    expect(result.rawColors).toEqual(MINIMAL_DARK_THEME.colors);
  });

  it('rawColors is a copy, not a reference', () => {
    const theme = { ...MINIMAL_DARK_THEME, colors: { ...MINIMAL_DARK_THEME.colors } };
    const result = parseVSCodeTheme(theme);
    theme.colors['editor.background'] = '#changed';
    expect(result.rawColors['editor.background']).toBe('#1e1e2e');
  });
});

// ── stripJSONC ────────────────────────────────────────────────────────────

describe('stripJSONC', () => {
  it('removes single-line comments', () => {
    const input = '{\n  "a": 1, // this is a comment\n  "b": 2\n}';
    const result = stripJSONC(input);
    expect(JSON.parse(result)).toEqual({ a: 1, b: 2 });
  });

  it('removes block comments', () => {
    const input = '{\n  /* block comment */\n  "a": 1\n}';
    const result = stripJSONC(input);
    expect(JSON.parse(result)).toEqual({ a: 1 });
  });

  it('removes multi-line block comments', () => {
    const input = '{\n  /*\n   * multi-line\n   * block comment\n   */\n  "a": 1\n}';
    const result = stripJSONC(input);
    expect(JSON.parse(result)).toEqual({ a: 1 });
  });

  it('preserves strings containing //', () => {
    const input = '{ "url": "https://example.com" }';
    const result = stripJSONC(input);
    expect(JSON.parse(result)).toEqual({ url: 'https://example.com' });
  });

  it('preserves strings containing /*', () => {
    const input = '{ "pattern": "/* not a comment */" }';
    const result = stripJSONC(input);
    expect(JSON.parse(result)).toEqual({ pattern: '/* not a comment */' });
  });

  it('preserves strings with escaped quotes', () => {
    const input = '{ "msg": "say \\"hello\\"" }';
    const result = stripJSONC(input);
    expect(JSON.parse(result)).toEqual({ msg: 'say "hello"' });
  });

  it('removes trailing commas before }', () => {
    const input = '{ "a": 1, "b": 2, }';
    const result = stripJSONC(input);
    expect(JSON.parse(result)).toEqual({ a: 1, b: 2 });
  });

  it('removes trailing commas before ]', () => {
    const input = '{ "arr": [1, 2, 3,] }';
    const result = stripJSONC(input);
    expect(JSON.parse(result)).toEqual({ arr: [1, 2, 3] });
  });

  it('handles empty input', () => {
    expect(stripJSONC('')).toBe('');
  });

  it('handles whitespace-only input', () => {
    expect(stripJSONC('   \n  \t  ')).toBe('   \n  \t  ');
  });

  it('parses a realistic JSONC theme snippet', () => {
    const input = `{
  "name": "Solarized Dark",
  "type": "dark",
  "colors": {
    // Base colors
    // "foreground": "",
    "focusBorder": "#2AA19899",
    /* Widget colors */
    "editor.background": "#002b36",
    "editor.foreground": "#839496",
  },
  "tokenColors": [
    {
      "scope": "comment",
      "settings": {
        "foreground": "#586e75", // muted green
      }
    },
  ]
}`;
    const result = stripJSONC(input);
    const parsed = JSON.parse(result);
    expect(parsed.name).toBe('Solarized Dark');
    expect(parsed.colors['focusBorder']).toBe('#2AA19899');
    expect(parsed.colors['editor.background']).toBe('#002b36');
    expect(parsed.tokenColors[0].settings.foreground).toBe('#586e75');
  });

  it('does not corrupt a URL with // inside a string value', () => {
    const input = '{ "repo": "https://github.com/user/repo", "count": 42 }';
    const result = stripJSONC(input);
    const parsed = JSON.parse(result);
    expect(parsed.repo).toBe('https://github.com/user/repo');
    expect(parsed.count).toBe(42);
  });
});
