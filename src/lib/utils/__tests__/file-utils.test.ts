import {
  describe,
  expect,
  it,
} from 'vitest';
import { getLanguageFromPath } from '../file-utils';

describe('getLanguageFromPath', () => {
  it.each([
    ['src/index.js', 'javascript'],
    ['src/component.jsx', 'javascript'],
    ['scripts/build.mjs', 'javascript'],
    ['src/index.ts', 'typescript'],
    ['src/App.tsx', 'typescript'],
    ['package.json', 'json'],
    ['tsconfig.jsonc', 'json'],
    ['src/styles.css', 'css'],
    ['src/styles.scss', 'scss'],
    ['src/styles.less', 'less'],
    ['public/index.html', 'html'],
    ['public/icon.svg', 'xml'],
    ['docs/README.md', 'markdown'],
    ['docs/page.mdx', 'markdown'],
    ['config/app.yaml', 'yaml'],
    ['config/app.yml', 'yaml'],
    ['scripts/setup.sh', 'bash'],
    ['scripts/setup.zsh', 'bash'],
    ['scripts/setup.fish', 'bash'],
    ['src/query.graphql', 'graphql'],
    ['Dockerfile', 'dockerfile'],
    ['Makefile', 'makefile'],
    ['.prettierrc', 'json'],
    ['.editorconfig', 'ini'],
    ['notes/unknown.custom', 'text'],
  ])('maps %s to %s for file editor language detection', (filePath, expectedLanguage) => {
    expect(getLanguageFromPath(filePath)).toBe(expectedLanguage);
  });
});
