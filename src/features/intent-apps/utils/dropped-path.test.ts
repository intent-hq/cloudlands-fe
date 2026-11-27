import { describe, expect, it } from 'vitest';
import { droppedPath } from './dropped-path';

describe('droppedPath', () => {
  const file = new File(['x'], 'notes.intentapp');

  it("returns Electron's path for a dropped file", () => {
    const win = { electronAPI: { getPathForFile: () => '/home/me/notes.intentapp' } };
    expect(droppedPath(file, win as unknown as Window)).toBe('/home/me/notes.intentapp');
  });

  it('returns nothing without the Electron bridge or when it throws', () => {
    expect(droppedPath(file, {} as Window)).toBe('');
    const throwing = {
      electronAPI: {
        getPathForFile: () => {
          throw new Error('not a file');
        },
      },
    };
    expect(droppedPath(file, throwing as unknown as Window)).toBe('');
  });
});
