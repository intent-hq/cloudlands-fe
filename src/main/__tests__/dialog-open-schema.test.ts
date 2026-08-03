import { describe, expect, it } from 'vitest';

import { DialogOpenSchema } from '../ipc-schemas';

describe('DialogOpenSchema', () => {
  it('accepts legacy requests without a mode (backward compatibility)', () => {
    expect(DialogOpenSchema.parse({})).toEqual({});
    expect(DialogOpenSchema.parse({ title: 'Choose a folder', defaultPath: '/tmp' })).toEqual({
      title: 'Choose a folder',
      defaultPath: '/tmp',
    });
  });

  it('accepts directory and file modes', () => {
    expect(DialogOpenSchema.parse({ mode: 'directory' })).toEqual({ mode: 'directory' });
    expect(DialogOpenSchema.parse({ mode: 'file', title: 'Choose an SSH key' })).toEqual({
      mode: 'file',
      title: 'Choose an SSH key',
    });
  });

  it('rejects unknown modes', () => {
    expect(() => DialogOpenSchema.parse({ mode: 'files' })).toThrow();
    expect(() => DialogOpenSchema.parse({ mode: 'openFile' })).toThrow();
  });
});
