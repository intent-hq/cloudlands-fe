import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const widgetFiles = [
  'src/lib/components/chat/ChatAgentActionBlock.svelte',
  'src/lib/components/chat/ChatCliBlock.svelte',
  'src/lib/components/chat/ChatReferenceBlock.svelte',
  'src/lib/components/chat/NavLink.svelte',
  'src/lib/components/notes/primitives/AgentActionBlock.svelte',
  'src/lib/components/notes/primitives/CliBlock.svelte',
  'src/lib/components/notes/primitives/ReferenceBlock.svelte',
  'src/features/file-tracking/components/diff/PatchBlockContent.svelte',
];

describe('ws-block typography contract', () => {
  it.each(widgetFiles)('%s opts into the UI font boundary', (file) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8');
    expect(source).toContain('ws-block-widget');
  });

  it('keeps command payloads on the code typography role', () => {
    for (const file of [
      'src/lib/components/chat/ChatCliBlock.svelte',
      'src/lib/components/notes/primitives/CliBlock.svelte',
    ]) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source).toContain('<code class="type-code');
    }
  });
});
