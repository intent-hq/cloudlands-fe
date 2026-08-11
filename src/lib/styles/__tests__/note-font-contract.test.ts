import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('note font contract', () => {
  it('bundles Source Serif normal and italic faces for the complete serif document', () => {
    const app = source('src/app.css');
    const editor = source('src/lib/styles/tiptap-editor.css');

    expect(app).toContain('source-serif-4-latin-standard-normal.woff2');
    expect(app).toContain('source-serif-4-latin-standard-italic.woff2');
    expect(app).not.toMatch(/Merriweather|Newsreader|fonts\.googleapis|fonts\.gstatic/i);
    expect(editor).toMatch(/\.note-font-serif \.tiptap-editor \{[\s\S]*?'Source Serif 4 Variable'/);
    expect(editor).toContain('font-optical-sizing: auto;');
    expect(editor).toMatch(/\.note-font-serif \.tiptap-editor h1 \{[\s\S]*?font-size: 2rem;/);
    expect(editor).toContain('line-height: 1.48;');
    expect(editor).toMatch(/\.note-font-serif \.tiptap-editor em \{\s*font-style: italic;/);
    expect(editor).toContain('margin: 0 0 var(--space-5);');
    expect(editor).toContain('margin: var(--space-6) 0 var(--space-3);');
    expect(editor).toContain('margin: 0 0 var(--space-4);');
    expect(editor).toContain('ul:not(.task-list)');
  });
});
