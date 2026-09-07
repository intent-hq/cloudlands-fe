import { describe, expect, it } from 'vitest';
import {
  BROWSER_COMPONENTS_DIR,
  NORMALIZATION_HELPER,
  findBrowserAddressNormalizationViolations,
} from './check-browser-address-normalization.mjs';

const helper = {
  path: NORMALIZATION_HELPER,
  content: [
    'export function normalizeBrowserAddressInput(input: string): string | null {',
    '  let url = input.trim();',
    "  url = (isLocalhost ? 'http://' : 'https://') + url;",
    '  return url;',
    '}',
  ].join('\n'),
};

const component = (name: string, body: string) => ({
  path: `${BROWSER_COMPONENTS_DIR}/${name}`,
  content: body,
});

describe('browser address normalization guard', () => {
  it('allows the helper itself, callers of the helper, and test files', () => {
    const files = [
      helper,
      component(
        'BrowserPanel.svelte',
        [
          "import { normalizeBrowserAddressInput } from './embedded-browser-url-validation';",
          'const normalized = normalizeBrowserAddressInput(urlInput);',
          "const home = 'https://example.test';",
        ].join('\n'),
      ),
      component('EmbeddedBrowser.test.ts', "expect(url).toBe('https://' + host);"),
      component('address.ct.spec.ts', "const url = (local ? 'http://' : 'https://') + host;"),
    ];
    expect(findBrowserAddressNormalizationViolations(files)).toEqual([]);
  });

  it('ignores files outside the browser component tree', () => {
    const files = [
      helper,
      {
        path: 'src/features/navigation/link-handler.ts',
        content: "const url = (isLocalhost ? 'http://' : 'https://') + input;",
      },
    ];
    expect(findBrowserAddressNormalizationViolations(files)).toEqual([]);
  });

  it.each([
    ['loopback ternary', "url = (isLocalhost ? 'http://' : 'https://') + url;"],
    ['double-quoted loopback ternary', 'url = (local ? "http://" : "https://") + url;'],
    ['https concatenation', "const target = 'https://' + draft;"],
    ['http concatenation', 'const target = "http://" + draft;'],
    ['template prefix', 'const target = `https://${draft}`;'],
  ])('rejects an inline %s in a component', (_name, line) => {
    const files = [
      helper,
      component('EmbeddedBrowser.svelte', `function submit() {\n  ${line}\n}`),
    ];
    const violations = findBrowserAddressNormalizationViolations(files);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(`${BROWSER_COMPONENTS_DIR}/EmbeddedBrowser.svelte:2`);
    expect(violations[0]).toContain('normalizeBrowserAddressInput');
  });

  it('reports every offending line across files', () => {
    const files = [
      helper,
      component('BrowserPanel.svelte', "url = (isLocalhost ? 'http://' : 'https://') + url;"),
      component('BrowserViewerTabHeader.svelte', "next = 'https://' + next;\nother = 1;"),
    ];
    expect(findBrowserAddressNormalizationViolations(files)).toHaveLength(2);
  });
});
