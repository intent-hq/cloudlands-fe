import { describe, expect, it } from 'vitest';
import { sharedPreviewImports } from './shared-preview-imports';

describe('sharedPreviewImports', () => {
  it('keeps the specifiers that enough previews import', () => {
    const sources = {
      '/src/a/one.preview.ts': `import { appStore } from '$store/renderer/store';
import Button from '$lib/components/ui/button';
import Local from './Local.svelte';`,
      '/src/b/two.preview.svelte': `<script lang="ts">
  import { appStore } from '$store/renderer/store';
  import Button from '$lib/components/ui/button';
  import Local from './Local.svelte';
</script>`,
      '/src/c/three.preview.ts': `import { appStore } from '$store/renderer/store';`,
    };

    expect(sharedPreviewImports(sources, 2)).toEqual([
      '$lib/components/ui/button',
      '$store/renderer/store',
    ]);
    expect(sharedPreviewImports(sources, 3)).toEqual(['$store/renderer/store']);
  });

  it('resolves relative imports so previews in different folders share them', () => {
    const sources = {
      '/src/lib/components/chat/one.preview.svelte': `<script lang="ts">
  import ChatMessage from './ChatMessage.svelte';
</script>`,
      '/src/lib/components/chat/nested/two.preview.ts': `import ChatMessage from '../ChatMessage.svelte';`,
      '/src/lib/components/other/three.preview.ts': `import Local from './ChatMessage.svelte';`,
    };

    expect(sharedPreviewImports(sources, 2)).toEqual([
      '/src/lib/components/chat/ChatMessage.svelte',
    ]);
  });

  it('reads multi-line, mixed, re-export and side-effect imports', () => {
    const sources = {
      '/src/one.preview.ts': `import {
  definePreview,
  type PreviewDefinition,
} from '$lib/component-catalog/preview-definition';
import * as m from '$shared/paraglide/messages.js';
export { helper } from '$test/helpers';
import '$lib/styles/preview.css';`,
    };

    expect(sharedPreviewImports(sources, 1)).toEqual([
      '$lib/component-catalog/preview-definition',
      '$lib/styles/preview.css',
      '$shared/paraglide/messages.js',
      '$test/helpers',
    ]);
  });

  it('skips type-only imports, which load nothing at runtime', () => {
    const sources = {
      '/src/one.preview.ts': `export const width = 420;
import type { Component } from 'svelte';
import type {
  WorkspaceId,
} from '$shared/types/branded-ids';
import { mount } from 'svelte-runtime-helper';`,
    };

    expect(sharedPreviewImports(sources, 1)).toEqual(['svelte-runtime-helper']);
  });

  it('counts a preview once however often it imports a specifier', () => {
    const sources = {
      '/src/one.preview.ts': `import { a } from '$store/renderer/store';
import { b } from '$store/renderer/store';`,
    };

    expect(sharedPreviewImports(sources, 2)).toEqual([]);
  });
});
