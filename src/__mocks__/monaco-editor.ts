// Minimal stub of the monaco-editor API used by CodeEditor.svelte.
// This keeps vitest/unit tests lightweight while allowing the Svelte module graph to resolve.

export const KeyMod = { CtrlCmd: 1 };
export const KeyCode = { KeyS: 2 };

export const editor = {
  createDiffEditor: () => ({
    getModifiedEditor: () => ({
      addCommand: () => {
        /* no-op in tests */
      },
    }),
    dispose: () => {
      /* no-op */
    },
  }),
   
  createModel: (_value: string, _language?: string) => ({
    getValue: () => _value,
    dispose: () => {
      /* no-op */
    },
  }),
  defineTheme: () => {
    /* no-op */
  },
  setTheme: () => {
    /* no-op */
  },
};
