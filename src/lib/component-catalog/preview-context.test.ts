import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ setContext: vi.fn() }));

vi.mock('svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte')>()),
  setContext: mocks.setContext,
}));

import { installPreviewContexts, previewContext } from './preview-context';

describe('preview contexts', () => {
  beforeEach(() => mocks.setContext.mockClear());

  it('installs typed values from a preview wrapper before it renders the real component', () => {
    const layout = { splitPanel: vi.fn() };
    const contexts = [
      previewContext('panelLayoutManager', layout),
      previewContext(Symbol.for('preview-settings'), { enabled: true }),
    ];

    installPreviewContexts(contexts);

    expect(mocks.setContext).toHaveBeenNthCalledWith(1, 'panelLayoutManager', layout);
    expect(mocks.setContext).toHaveBeenNthCalledWith(2, Symbol.for('preview-settings'), {
      enabled: true,
    });
  });
});
