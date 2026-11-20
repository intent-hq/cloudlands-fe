import { describe, expect, it, vi } from 'vitest';

import {
  answerFileChooser,
  enableFileChooserInterception,
  type FileChooserCdp,
} from './browser-file-chooser';

function fakeCdp(accept = '') {
  const calls: [string, Record<string, unknown> | undefined][] = [];
  const cdp: FileChooserCdp = {
    send: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      calls.push([method, params]);
      if (method === 'DOM.resolveNode') return { object: { objectId: 'obj-1' } };
      if (method === 'Runtime.callFunctionOn') return { result: { value: accept } };
      return {};
    }),
  };
  return { cdp, calls, methods: () => calls.map(([method]) => method) };
}

describe('enableFileChooserInterception', () => {
  it('enables the Page domain and file chooser interception', async () => {
    const { cdp, calls } = fakeCdp();
    await enableFileChooserInterception(cdp);
    expect(calls).toEqual([
      ['Page.enable', undefined],
      ['Page.setInterceptFileChooserDialog', { enabled: true }],
    ]);
  });
});

describe('answerFileChooser', () => {
  it('fills a single-file input with the first picked file and passes accept on', async () => {
    const { cdp, calls } = fakeCdp('.pdf,image/*');
    const pick = vi.fn(async () => ['/home/me/a.pdf', '/home/me/b.pdf']);
    await expect(
      answerFileChooser(cdp, { mode: 'selectSingle', backendNodeId: 7 }, pick),
    ).resolves.toEqual(['/home/me/a.pdf']);
    expect(pick).toHaveBeenCalledWith({ multiple: false, accept: '.pdf,image/*' });
    expect(calls.at(-1)).toEqual([
      'DOM.setFileInputFiles',
      { files: ['/home/me/a.pdf'], backendNodeId: 7 },
    ]);
  });

  it('fills a multiple input with every picked file', async () => {
    const { cdp, calls } = fakeCdp();
    const pick = vi.fn(async () => ['/a.png', '/b.png']);
    await answerFileChooser(cdp, { mode: 'selectMultiple', backendNodeId: 9 }, pick);
    expect(pick).toHaveBeenCalledWith({ multiple: true, accept: undefined });
    expect(calls.at(-1)).toEqual([
      'DOM.setFileInputFiles',
      { files: ['/a.png', '/b.png'], backendNodeId: 9 },
    ]);
  });

  it('keeps the input as it was on cancel and fires its cancel event', async () => {
    const { cdp, calls, methods } = fakeCdp();
    await expect(
      answerFileChooser(cdp, { mode: 'selectSingle', backendNodeId: 7 }, async () => null),
    ).resolves.toBeNull();
    expect(methods()).not.toContain('DOM.setFileInputFiles');
    const cancel = calls.find(
      ([method, params]) =>
        method === 'Runtime.callFunctionOn' &&
        String(params?.functionDeclaration).includes('"cancel"'),
    );
    expect(cancel?.[1]).toMatchObject({ objectId: 'obj-1' });
    expect(methods().filter((method) => method === 'Runtime.releaseObject')).toHaveLength(2);
  });

  it('ignores a chooser without an input node', async () => {
    const { cdp, methods } = fakeCdp();
    const pick = vi.fn();
    await expect(answerFileChooser(cdp, { mode: 'selectSingle' }, pick)).resolves.toBeNull();
    expect(pick).not.toHaveBeenCalled();
    expect(methods()).toEqual([]);
  });

  it('still opens the picker when the accept list cannot be read', async () => {
    const cdp: FileChooserCdp = {
      send: vi.fn(async (method: string) => {
        if (method === 'DOM.resolveNode') throw new Error('node gone');
        return {};
      }),
    };
    const pick = vi.fn(async () => ['/x.txt']);
    await answerFileChooser(cdp, { mode: 'selectSingle', backendNodeId: 3 }, pick);
    expect(pick).toHaveBeenCalledWith({ multiple: false, accept: undefined });
    expect(cdp.send).toHaveBeenLastCalledWith('DOM.setFileInputFiles', {
      files: ['/x.txt'],
      backendNodeId: 3,
    });
  });
});
