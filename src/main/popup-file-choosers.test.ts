import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({}));

import { armPopupFileChooser } from './popup-file-choosers';

function fakePopup() {
  const debuggerEmitter = Object.assign(new EventEmitter(), {
    attached: false,
    isAttached() {
      return this.attached;
    },
    attach: vi.fn(function (this: { attached: boolean }) {
      this.attached = true;
    }),
    sendCommand: vi.fn(async (method: string) => {
      if (method === 'DOM.resolveNode') return { object: { objectId: 'o1' } };
      if (method === 'Runtime.callFunctionOn') return { result: { value: 'image/*' } };
      return {};
    }),
  });
  const popup = { isDestroyed: () => false, debugger: debuggerEmitter };
  return { popup, dbg: debuggerEmitter };
}

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

describe('armPopupFileChooser', () => {
  it('intercepts the popup chooser and answers it with the opener-side picker', async () => {
    const { popup, dbg } = fakePopup();
    const pickFor = vi.fn(async () => ['/home/me/a.png', '/home/me/b.png']);
    armPopupFileChooser(popup as never, pickFor);
    await settle();
    expect(dbg.attach).toHaveBeenCalledWith('1.3');
    expect(dbg.sendCommand).toHaveBeenCalledWith('Page.setInterceptFileChooserDialog', {
      enabled: true,
    });

    dbg.emit('message', {}, 'Page.fileChooserOpened', { mode: 'selectMultiple', backendNodeId: 5 });
    await settle();
    expect(pickFor).toHaveBeenCalledWith(popup, { multiple: true, accept: 'image/*' });
    expect(dbg.sendCommand).toHaveBeenLastCalledWith('DOM.setFileInputFiles', {
      files: ['/home/me/a.png', '/home/me/b.png'],
      backendNodeId: 5,
    });
  });

  it('cancels cleanly when no app renderer can show the picker', async () => {
    const { popup, dbg } = fakePopup();
    armPopupFileChooser(popup as never, async () => null);
    await settle();
    dbg.emit('message', {}, 'Page.fileChooserOpened', { mode: 'selectSingle', backendNodeId: 5 });
    await settle();
    const methods = dbg.sendCommand.mock.calls.map(([method]) => method);
    expect(methods).not.toContain('DOM.setFileInputFiles');
  });

  it('listens once across re-arms and ignores child-session messages', async () => {
    const { popup, dbg } = fakePopup();
    const pickFor = vi.fn(async () => null);
    armPopupFileChooser(popup as never, pickFor);
    armPopupFileChooser(popup as never, pickFor);
    await settle();
    expect(dbg.listenerCount('message')).toBe(1);
    dbg.emit(
      'message',
      {},
      'Page.fileChooserOpened',
      { mode: 'selectSingle', backendNodeId: 1 },
      'child',
    );
    await settle();
    expect(pickFor).not.toHaveBeenCalled();
  });
});
