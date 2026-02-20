import * as monaco from 'monaco-editor';
import { logger } from './client-logger';
import type { MonacoStandaloneThemeData } from './vscode-theme-parser';

let themesInitialized = false;
/** Tracks whether a custom Monaco theme ('app-custom') is currently active */
let customThemeActive = false;

export function defineMonacoThemes() {
  if (themesInitialized) return;

  try {
    // Dark theme
    monaco.editor.defineTheme('app-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: '#569cd6' },
        { token: 'string', foreground: '#ce9178' },
        { token: 'number', foreground: '#b5cea8' },
        { token: 'comment', foreground: '#6a9955' },
      ],
      colors: {
        'editor.background': '#1B1B23',
        'editor.foreground': '#d4d4d4',
        'editor.selectionBackground': '#264f78',
        'editor.lineHighlightBackground': '#0B0B0E',

        // Diff editor colors for dark theme
        // Line backgrounds: subtle (10% opacity) - shows which lines changed
        'diffEditor.insertedLineBackground': '#22c55e18',
        'diffEditor.removedLineBackground': '#ef444418',
        // Character/word backgrounds: prominent (45% opacity) - shows exact text changes
        'diffEditor.insertedTextBackground': '#22c55e70',
        'diffEditor.removedTextBackground': '#ef444470',
        // Gutter indicators
        'diffEditorGutter.insertedLineBackground': '#22c55ecc',
        'diffEditorGutter.removedLineBackground': '#ef4444cc',
        // Optional borders for extra clarity
        'diffEditor.insertedTextBorder': '#22c55e99',
        'diffEditor.removedTextBorder': '#ef444499',
        // Overview ruler (scrollbar indicators)
        'diffEditor.diagonalFill': '#374151',
        'diffEditorOverview.insertedForeground': '#22c55ecc',
        'diffEditorOverview.removedForeground': '#ef4444cc',
      },
    });

    // Light theme
    monaco.editor.defineTheme('app-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: '#7c3aed' },
        { token: 'keyword.control', foreground: '#7c3aed' },
        { token: 'keyword.operator', foreground: '#7c3aed' },
        { token: 'operator', foreground: '#374151' },
        { token: 'variable', foreground: '#374151' },
        { token: 'variable.other', foreground: '#374151' },
        { token: 'variable.parameter', foreground: '#374151' },
        { token: 'variable.language', foreground: '#7c3aed' },
        { token: 'type', foreground: '#b45309' },
        { token: 'class', foreground: '#b45309' },
        { token: 'interface', foreground: '#b45309' },
        { token: 'enum', foreground: '#b45309' },
        { token: 'function', foreground: '#1d4ed8' },
        { token: 'function.declaration', foreground: '#1d4ed8' },
        { token: 'function.call', foreground: '#1d4ed8' },
        { token: 'string', foreground: '#047857' },
        { token: 'string.quoted', foreground: '#047857' },
        { token: 'string.quoted.single', foreground: '#047857' },
        { token: 'string.quoted.double', foreground: '#047857' },
        { token: 'number', foreground: '#c2410c' },
        { token: 'comment', foreground: '#6b7280' },
        { token: 'comment.line', foreground: '#6b7280' },
        { token: 'comment.block', foreground: '#6b7280' },
        { token: 'invalid', foreground: '#b91c1c' },
      ],
      colors: {
        'editor.background': '#ffffff',
        'editor.foreground': '#1f2937',
        'editor.lineNumbersBackground': '#f9fafb',
        'editor.lineNumbersForeground': '#9ca3af',
        'editor.selectionBackground': '#dbeafe',
        'editor.lineHighlightBackground': '#f3f4f6',
        'editorCursor.foreground': '#1f2937',
        'editorWhitespace.foreground': '#e5e7eb',

        // Diff editor colors for light theme
        // Line backgrounds: subtle (10% opacity) - shows which lines changed
        'diffEditor.insertedLineBackground': '#22c55e18',
        'diffEditor.removedLineBackground': '#ef444418',
        // Character/word backgrounds: prominent (45% opacity) - shows exact text changes
        'diffEditor.insertedTextBackground': '#22c55e70',
        'diffEditor.removedTextBackground': '#ef444470',
        // Gutter indicators
        'diffEditorGutter.insertedLineBackground': '#22c55ecc',
        'diffEditorGutter.removedLineBackground': '#ef4444cc',
        // Optional borders for extra clarity
        'diffEditor.insertedTextBorder': '#22c55e99',
        'diffEditor.removedTextBorder': '#ef444499',
        // Overview ruler (scrollbar indicators)
        'diffEditor.diagonalFill': '#e5e7eb55',
        'diffEditorOverview.insertedForeground': '#22c55ecc',
        'diffEditorOverview.removedForeground': '#ef4444cc',
      },
    });

    themesInitialized = true;
  } catch (error) {
    logger.error('Failed to initialize Monaco themes:', error);
  }
}

/**
 * Register and apply a custom Monaco theme from parsed VS Code theme data.
 * Call this when a custom VS Code theme is loaded.
 */
export function applyCustomMonacoTheme(monacoThemeData: MonacoStandaloneThemeData): void {
  try {
    monaco.editor.defineTheme('app-custom', monacoThemeData as Parameters<typeof monaco.editor.defineTheme>[1]);
    monaco.editor.setTheme('app-custom');
    customThemeActive = true;
  } catch (error) {
    logger.error('Failed to apply custom Monaco theme:', error);
  }
}

/**
 * Revert Monaco to the base theme (app-dark or app-light).
 */
export function revertMonacoTheme(isDark: boolean): void {
  try {
    customThemeActive = false;
    monaco.editor.setTheme(isDark ? 'app-dark' : 'app-light');
  } catch (error) {
    logger.error('Failed to revert Monaco theme:', error);
  }
}

/**
 * Get the correct Monaco theme name to use.
 * Returns 'app-custom' if a custom/preset theme is active,
 * otherwise returns 'app-dark' or 'app-light' based on isDark.
 */
export function getActiveMonacoThemeName(isDark: boolean): string {
  if (customThemeActive) {
    return 'app-custom';
  }
  return isDark ? 'app-dark' : 'app-light';
}
