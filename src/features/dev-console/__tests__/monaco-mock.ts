import { vi } from 'vitest';

export const models: ReturnType<typeof createModel>[] = [];
export const editors: ReturnType<typeof createEditor>[] = [];

function createModel(text: string, language: string) {
  let output: HTMLElement | undefined;
  const model = {
    getValue: () => text,
    getLanguageId: () => language,
    setLanguage: (next: string) => {
      language = next;
    },
    setValue: vi.fn((next: string) => {
      text = next;
      if (output) output.textContent = text;
    }),
    attach: (host: HTMLElement) => {
      output = document.createElement('div');
      output.dataset.testid = 'payload-document';
      output.textContent = text;
      host.append(output);
    },
    dispose: vi.fn(),
  };
  return model;
}

function createEditor(host: HTMLElement, options: { model: ReturnType<typeof createModel> }) {
  options.model.attach(host);
  const actions = new Map<string, { run: ReturnType<typeof vi.fn> }>();
  const instance = {
    focus: vi.fn(),
    updateOptions: vi.fn(),
    getAction: (id: string) => {
      if (!actions.has(id)) actions.set(id, { run: vi.fn().mockResolvedValue(undefined) });
      return actions.get(id)!;
    },
    dispose: vi.fn(() => host.replaceChildren()),
  };
  return instance;
}

export const configureMonacoWorkers = vi.fn().mockResolvedValue(undefined);
export const monaco = {
  editor: {
    createModel: vi.fn((...args: Parameters<typeof createModel>) => {
      const model = createModel(...args);
      models.push(model);
      return model;
    }),
    create: vi.fn((...args: Parameters<typeof createEditor>) => {
      const instance = createEditor(...args);
      editors.push(instance);
      return instance;
    }),
    setModelLanguage: vi.fn((model: ReturnType<typeof createModel>, language: string) =>
      model.setLanguage(language),
    ),
  },
};

export async function initializePayloadMonaco() {
  await configureMonacoWorkers();
  return {
    monaco,
    defineMonacoThemes: vi.fn(),
    getActiveMonacoThemeName: (dark: boolean) => (dark ? 'app-dark' : 'app-light'),
  };
}

export function resetMonaco() {
  models.length = 0;
  editors.length = 0;
  vi.clearAllMocks();
  configureMonacoWorkers.mockReset().mockResolvedValue(undefined);
}
