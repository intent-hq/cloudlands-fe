import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  createUniqueMonacoModelPath,
  normalizeMonacoModelPath,
} from './monaco-model-uri';

function inferMonacoTypeScriptWorkerScriptKind(
  fileName: string,
  allowJs = true,
): 'TS' | 'TSX' | 'JS' | 'JSX' {
  const suffix = fileName.slice(fileName.lastIndexOf('.') + 1);
  switch (suffix) {
    case 'ts':
      return 'TS';
    case 'tsx':
      return 'TSX';
    case 'js':
      return 'JS';
    case 'jsx':
      return 'JSX';
    default:
      return allowJs ? 'JS' : 'TS';
  }
}

describe('Monaco model URI paths', () => {
  it('keeps primary file model paths extension-terminated for TypeScript worker script kind', () => {
    const modelPath = normalizeMonacoModelPath('scripts/generate-fish-eye.ts');

    expect(modelPath).toBe('/scripts/generate-fish-eye.ts');
    expect(inferMonacoTypeScriptWorkerScriptKind(modelPath)).toBe('TS');
  });

  it('keeps collision fallback paths extension-terminated for TypeScript and TSX script kind', () => {
    const tsModelPath = createUniqueMonacoModelPath('scripts/generate-fish-eye.ts', 'editor=one');
    const tsxModelPath = createUniqueMonacoModelPath('src/App.tsx', 'editor=one');

    expect(tsModelPath).toBe('/scripts/generate-fish-eye.__editor_editor_one.ts');
    expect(tsxModelPath).toBe('/src/App.__editor_editor_one.tsx');
    expect(inferMonacoTypeScriptWorkerScriptKind(tsModelPath)).toBe('TS');
    expect(inferMonacoTypeScriptWorkerScriptKind(tsxModelPath)).toBe('TSX');
  });

  it('preserves declaration suffixes when adding collision fallback uniqueness', () => {
    const modelPath = createUniqueMonacoModelPath('src/types/global.d.ts', 'editor-one');

    expect(modelPath).toBe('/src/types/global.__editor_editor-one.d.ts');
    expect(inferMonacoTypeScriptWorkerScriptKind(modelPath)).toBe('TS');
  });

  it('documents the previous query URI failure mode as JavaScript in Monaco worker inference', () => {
    expect(
      inferMonacoTypeScriptWorkerScriptKind('file:///scripts/generate-fish-eye.ts?editor=one'),
    ).toBe('JS');
  });
});
