import { describe, expect, it } from 'vitest';
import { runInputAction, type CdpSend } from '../main/browser-input';

type Call = { method: string; params?: Record<string, unknown> };

/** Records CDP calls; answers each Runtime.evaluate from `pageResults` in order. */
function fakeCdp(pageResults: unknown[] = []) {
  const calls: Call[] = [];
  const send: CdpSend = async (method, params) => {
    calls.push({ method, params });
    if (method === 'Runtime.evaluate') return { result: { value: pageResults.shift() } };
    return {};
  };
  const input = () => calls.filter((c) => c.method.startsWith('Input.'));
  return { send, calls, input };
}

const keyEvents = (calls: Call[]) =>
  calls
    .filter((c) => c.method === 'Input.dispatchKeyEvent')
    .map((c) => ({ type: c.params?.type, key: c.params?.key }));

describe('runInputAction', () => {
  describe('click', () => {
    it('scrolls the selector into view and clicks its center', async () => {
      const cdp = fakeCdp([{ status: 'ok', x: 40, y: 60 }]);
      const result = await runInputAction(cdp.send, { action: 'click', selector: '#go' });

      expect(result).toEqual({ x: 40, y: 60 });
      expect(cdp.calls[0]).toEqual({
        method: 'Emulation.setFocusEmulationEnabled',
        params: { enabled: true },
      });
      expect(String(cdp.calls[1].params?.expression)).toContain('"#go"');
      expect(cdp.input().map((c) => [c.params?.type, c.params?.x, c.params?.y])).toEqual([
        ['mouseMoved', 40, 60],
        ['mousePressed', 40, 60],
        ['mouseReleased', 40, 60],
      ]);
      expect(cdp.input()[1].params).toMatchObject({ button: 'left', clickCount: 1, buttons: 1 });
    });

    it('clicks raw coordinates without resolving an element', async () => {
      const cdp = fakeCdp();
      await runInputAction(cdp.send, { action: 'click', x: 5, y: 7, button: 'right' });

      expect(cdp.calls.some((c) => c.method === 'Runtime.evaluate')).toBe(false);
      expect(cdp.input()[1].params).toMatchObject({ x: 5, y: 7, button: 'right', buttons: 2 });
    });

    it('sends one press/release pair per click with a rising clickCount', async () => {
      const cdp = fakeCdp();
      await runInputAction(cdp.send, { action: 'click', x: 1, y: 1, clickCount: 2 });

      expect(
        cdp
          .input()
          .filter((c) => c.params?.type !== 'mouseMoved')
          .map((c) => [c.params?.type, c.params?.clickCount]),
      ).toEqual([
        ['mousePressed', 1],
        ['mouseReleased', 1],
        ['mousePressed', 2],
        ['mouseReleased', 2],
      ]);
    });

    it.each([
      [{ status: 'not-found' }, 'element-not-found'],
      [{ status: 'not-visible' }, 'element-not-visible'],
      [{ status: 'obscured', x: 1, y: 1, hit: 'div.overlay' }, 'element-obscured'],
    ])('fails with a structured code and sends no input for %o', async (page, code) => {
      const cdp = fakeCdp([page]);
      const error = await runInputAction(cdp.send, { action: 'click', selector: '#x' }).catch(
        (e: unknown) => e,
      );
      expect((error as { errorCode?: string }).errorCode).toBe(code);
      expect(cdp.input()).toEqual([]);
    });

    it('names the covering element when the target is obscured', async () => {
      const cdp = fakeCdp([{ status: 'obscured', x: 1, y: 1, hit: 'div.overlay' }]);
      await expect(runInputAction(cdp.send, { action: 'click', selector: '#x' })).rejects.toThrow(
        /div\.overlay/,
      );
    });
  });

  it('hover only moves the mouse', async () => {
    const cdp = fakeCdp([{ status: 'ok', x: 3, y: 4 }]);
    await runInputAction(cdp.send, { action: 'hover', selector: '#menu' });

    expect(cdp.input().map((c) => c.params?.type)).toEqual(['mouseMoved']);
  });

  describe('type', () => {
    it('sends a keyDown carrying the text and a keyUp per character', async () => {
      const cdp = fakeCdp();
      const result = await runInputAction(cdp.send, { action: 'type', text: 'aB1' });

      expect(result).toEqual({ length: 3 });
      expect(keyEvents(cdp.calls)).toEqual([
        { type: 'keyDown', key: 'a' },
        { type: 'keyUp', key: 'a' },
        { type: 'keyDown', key: 'B' },
        { type: 'keyUp', key: 'B' },
        { type: 'keyDown', key: '1' },
        { type: 'keyUp', key: '1' },
      ]);
      const down = cdp.calls.filter((c) => c.params?.type === 'keyDown').map((c) => c.params);
      expect(down[1]).toMatchObject({ text: 'B', code: 'KeyB', windowsVirtualKeyCode: 66 });
      expect(down[2]).toMatchObject({ text: '1', code: 'Digit1', windowsVirtualKeyCode: 49 });
    });

    it('types a newline as Enter', async () => {
      const cdp = fakeCdp();
      await runInputAction(cdp.send, { action: 'type', text: '\n' });

      expect(keyEvents(cdp.calls)[0]).toEqual({ type: 'keyDown', key: 'Enter' });
    });

    it('inserts the whole text at once in insert mode', async () => {
      const cdp = fakeCdp();
      await runInputAction(cdp.send, { action: 'type', text: 'héllo 👋', mode: 'insert' });

      expect(cdp.input()).toEqual([{ method: 'Input.insertText', params: { text: 'héllo 👋' } }]);
    });

    it('focuses the selector first and fails when it is missing', async () => {
      const ok = fakeCdp([{ status: 'ok' }]);
      await runInputAction(ok.send, { action: 'type', selector: '#name', text: 'x' });
      const evaluate = ok.calls.find((c) => c.method === 'Runtime.evaluate');
      expect(String(evaluate?.params?.expression)).toContain('"#name"');
      expect(ok.calls.indexOf(evaluate!)).toBeLessThan(ok.calls.indexOf(ok.input()[0]));

      const missing = fakeCdp([{ status: 'not-found' }]);
      await expect(
        runInputAction(missing.send, { action: 'type', selector: '#nope', text: 'x' }),
      ).rejects.toMatchObject({ errorCode: 'element-not-found' });
      expect(missing.input()).toEqual([]);
    });

    it('clears the field with select-all and Backspace before typing', async () => {
      const cdp = fakeCdp();
      await runInputAction(cdp.send, { action: 'type', text: 'z', clear: true }, 'linux');

      expect(keyEvents(cdp.calls).slice(0, 4)).toEqual([
        { type: 'rawKeyDown', key: 'a' },
        { type: 'keyUp', key: 'a' },
        { type: 'rawKeyDown', key: 'Backspace' },
        { type: 'keyUp', key: 'Backspace' },
      ]);
      expect(cdp.input()[0].params).toMatchObject({ modifiers: 2 });
    });
  });

  describe('press', () => {
    it('sends a named key with its code and key code', async () => {
      const cdp = fakeCdp();
      expect(await runInputAction(cdp.send, { action: 'press', key: 'Enter' }, 'linux')).toEqual({
        key: 'Enter',
      });

      expect(cdp.input()[0].params).toMatchObject({
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        text: '\r',
      });
      expect(cdp.input()[1].params).toMatchObject({ type: 'keyUp', key: 'Enter' });
    });

    it('resolves ControlOrMeta to Control off macOS without editing commands', async () => {
      const cdp = fakeCdp();
      await runInputAction(
        cdp.send,
        { action: 'press', key: 'a', modifiers: ['ControlOrMeta'] },
        'linux',
      );

      expect(cdp.input()[0].params).toMatchObject({ modifiers: 2, key: 'a', code: 'KeyA' });
      expect(cdp.input()[0].params).not.toHaveProperty('commands');
      expect(cdp.input()[0].params).not.toHaveProperty('text');
    });

    it('resolves ControlOrMeta to Meta on macOS and attaches the editing command', async () => {
      const cdp = fakeCdp();
      await runInputAction(
        cdp.send,
        { action: 'press', key: 'a', modifiers: ['ControlOrMeta'] },
        'darwin',
      );

      expect(cdp.input()[0].params).toMatchObject({ modifiers: 4, commands: ['selectAll'] });
    });

    it('attaches macOS editing commands to plain editing keys', async () => {
      const cdp = fakeCdp();
      await runInputAction(cdp.send, { action: 'press', key: 'Backspace' }, 'darwin');

      expect(cdp.input()[0].params).toMatchObject({ commands: ['deleteBackward'] });
    });

    it('rejects an unknown named key before sending input', async () => {
      const cdp = fakeCdp();
      await expect(
        runInputAction(cdp.send, { action: 'press', key: 'Hyper' }),
      ).rejects.toMatchObject({ errorCode: 'unknown-key' });
      expect(cdp.input()).toEqual([]);
    });
  });

  describe('review regressions', () => {
    it('types \\r\\n as one Enter and \\t as the Tab key', async () => {
      const cdp = fakeCdp();
      const result = await runInputAction(cdp.send, { action: 'type', text: 'a\r\nb\tc' }, 'linux');

      expect(
        keyEvents(cdp.calls)
          .filter((e) => e.type !== 'keyUp')
          .map((e) => e.key),
      ).toEqual(['a', 'Enter', 'b', 'Tab', 'c']);
      expect(result).toEqual({ length: 5 });
    });

    it('types shifted characters with their US-layout key, code and Shift bit', async () => {
      const cdp = fakeCdp();
      await runInputAction(cdp.send, { action: 'type', text: 'A!' }, 'linux');

      const down = cdp.calls.filter((c) => c.params?.type === 'keyDown').map((c) => c.params);
      expect(down[0]).toMatchObject({
        key: 'A',
        code: 'KeyA',
        windowsVirtualKeyCode: 65,
        modifiers: 8,
        text: 'A',
      });
      expect(down[1]).toMatchObject({
        key: '!',
        code: 'Digit1',
        windowsVirtualKeyCode: 49,
        modifiers: 8,
        text: '!',
      });
    });

    it('press with Shift reports the shifted key', async () => {
      const cdp = fakeCdp();
      await runInputAction(cdp.send, { action: 'press', key: '1', modifiers: ['Shift'] }, 'linux');

      expect(cdp.input()[0].params).toMatchObject({
        key: '!',
        code: 'Digit1',
        text: '!',
        modifiers: 8,
      });
    });

    it.each([
      [['Shift', 'Meta'], 'z', 'redo'],
      [['Shift', 'Alt'], 'ArrowLeft', 'moveWordLeftAndModifySelection'],
      [['Shift', 'Meta'], 'ArrowRight', 'moveToRightEndOfLineAndModifySelection'],
      [['Shift'], 'Home', 'moveToBeginningOfDocumentAndModifySelection'],
      [['Alt'], 'Delete', 'deleteWordForward'],
    ] as const)('maps macOS %s+%s to %s', async (modifiers, key, command) => {
      const cdp = fakeCdp();
      await runInputAction(cdp.send, { action: 'press', key, modifiers: [...modifiers] }, 'darwin');

      expect(cdp.input()[0].params).toMatchObject({ commands: [command] });
    });

    it('releases the mouse button when a click fails after the press', async () => {
      const calls: string[] = [];
      let failed = false;
      const send: CdpSend = async (method, params) => {
        calls.push(`${method}:${params?.type ?? ''}`);
        if (params?.type === 'mouseReleased' && !failed) {
          failed = true;
          throw new Error('deadline-exhausted');
        }
        return {};
      };

      await expect(runInputAction(send, { action: 'click', x: 1, y: 1 })).rejects.toThrow(
        'deadline-exhausted',
      );
      expect(calls.filter((c) => c.endsWith('mouseReleased'))).toHaveLength(2);
    });

    it('reports how much text landed when typing stops part-way', async () => {
      let downs = 0;
      const send: CdpSend = async (_method, params) => {
        if (params?.type === 'keyDown' && ++downs === 3) {
          throw Object.assign(new Error('Input.dispatchKeyEvent timed out'), {
            errorCode: 'deadline-exhausted',
          });
        }
        return {};
      };

      const error = await runInputAction(send, { action: 'type', text: 'abcd' }).catch(
        (e: unknown) => e as Error & { errorCode?: string },
      );
      expect(error.message).toContain('2 of 4 characters');
      expect(error.errorCode).toBe('deadline-exhausted');
    });

    it('maps CSS-pixel points onto a scaled-to-fit tab', async () => {
      const cdp = fakeCdp([{ status: 'ok', x: 100, y: 40 }]);
      const result = await runInputAction(
        cdp.send,
        { action: 'click', selector: '#go' },
        'linux',
        0.5,
      );

      expect(result).toEqual({ x: 100, y: 40 });
      expect(cdp.input().map((c) => [c.params?.x, c.params?.y])).toEqual([
        [50, 20],
        [50, 20],
        [50, 20],
      ]);
    });

    it('rejects a disabled select or option', async () => {
      const cdp = fakeCdp([{ status: 'disabled' }]);
      await expect(
        runInputAction(cdp.send, { action: 'selectOption', selector: '#s', value: 'a' }),
      ).rejects.toMatchObject({ errorCode: 'element-disabled' });
    });
  });

  describe('selectOption', () => {
    it('returns the selected values from the page', async () => {
      const cdp = fakeCdp([{ status: 'ok', selected: ['b'] }]);
      expect(
        await runInputAction(cdp.send, { action: 'selectOption', selector: '#s', value: 'B' }),
      ).toEqual({ selected: ['b'] });
      expect(String(cdp.calls.at(-1)?.params?.expression)).toContain('["B"]');
    });

    it.each([
      [{ status: 'not-a-select' }, 'not-a-select'],
      [{ status: 'option-not-found', missing: ['z'] }, 'option-not-found'],
      [{ status: 'not-found' }, 'element-not-found'],
    ])('maps page status %o to a structured code', async (page, code) => {
      const cdp = fakeCdp([page]);
      await expect(
        runInputAction(cdp.send, { action: 'selectOption', selector: '#s', value: ['z'] }),
      ).rejects.toMatchObject({ errorCode: code });
    });
  });
});
