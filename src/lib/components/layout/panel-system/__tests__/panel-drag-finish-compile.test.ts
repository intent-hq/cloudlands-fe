/** @vitest-environment node */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { compile, preprocess } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

async function compileComponent(componentName: string) {
  const filename = fileURLToPath(new URL(`../${componentName}`, import.meta.url));
  const source = await readFile(filename, 'utf8');
  const processed = await preprocess(source, vitePreprocess(), { filename });
  return compile(processed.code, { filename, generate: 'client', dev: true }).js.code;
}

async function compileFinishPaneDrag(componentName: string) {
  const code = await compileComponent(componentName);
  const start = code.indexOf('function finishPaneDrag()');
  const end = code.indexOf('\n\tfunction ', start + 1);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return code.slice(start, end);
}

describe('pane drag finish compilation', () => {
  it.each(['Panel.svelte', 'PanelTabBar.svelte'])(
    'reads the live finish prop once in %s',
    async (componentName) => {
      const finishPaneDrag = await compileFinishPaneDrag(componentName);

      expect(finishPaneDrag.match(/\$\$props\.onPaneDragFinish/g)).toHaveLength(1);
      expect(finishPaneDrag).toContain('const finish = $$props.onPaneDragFinish;');
      expect(finishPaneDrag).toContain('if (finish) finish();');
    },
  );

  it('forwards the Panel component lifetime identity instead of a live panel lookup', async () => {
    const code = await compileComponent('Panel.svelte');

    expect(code).toContain('const panelId = $$props.panel.id;');
    expect(code).toMatch(/get panelId\(\) \{\s+return panelId;/);
    expect(code).not.toMatch(/get panelId\(\) \{\s+return \$\$props\.panel\.id;/);
  });

  it('captures the PanelTabBar identity once for cleanup', async () => {
    const code = await compileComponent('PanelTabBar.svelte');

    expect(code.match(/\$\$props\.panelId/g)).toHaveLength(1);
    expect(code).toContain('const stablePanelId = $$props.panelId;');
  });
});
