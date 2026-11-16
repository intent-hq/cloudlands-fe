/** Trusted input actions against a real, never-focused Electron guest; no Intent app or daemon. */
import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';

// Every listener records `isTrusted`; #guarded only accepts trusted edits, like
// controls that ignore synthetic input (intent-hq/intent#9266).
const PAGE = `<!doctype html><title>input fixture</title>
<style>body{margin:0;font:14px sans-serif} .wrap{position:relative;display:inline-block}
.overlay{position:absolute;inset:0;background:transparent}</style>
<form id="form"><input id="guarded" autocomplete="off"><button id="submit">Submit</button></form>
<div id="hover" style="width:80px;height:30px">hover</div>
<select id="select"><option value="a">Alpha</option><option value="b">Beta</option></select>
<div class="wrap"><button id="covered">Covered</button><div class="overlay" id="overlay"></div></div>
<div id="host"></div>
<select id="disabled" disabled><option value="a">A</option></select>
<button id="tall" style="display:block;width:100px;height:3000px">Tall</button>
<button id="scaled">Scaled</button>
<button id="far" style="margin-top:2500px">Far</button>
<script>
  window.log = [];
  const rec = (name) => (e) => log.push({ name, trusted: e.isTrusted });
  const guarded = document.getElementById('guarded');
  guarded.addEventListener('beforeinput', (e) => { if (!e.isTrusted) e.preventDefault(); });
  guarded.addEventListener('keydown', rec('keydown'));
  document.getElementById('form').addEventListener('submit', (e) => { e.preventDefault(); rec('submit')(e); });
  document.getElementById('submit').addEventListener('click', rec('submit-click'));
  document.getElementById('hover').addEventListener('mouseenter', rec('mouseenter'));
  document.getElementById('select').addEventListener('change', rec('change'));
  document.getElementById('far').addEventListener('click', rec('far-click'));
  document.getElementById('tall').addEventListener('click', rec('tall-click'));
  document.getElementById('scaled').addEventListener('click', rec('scaled-click'));
  const root = document.getElementById('host').attachShadow({ mode: 'open' });
  root.innerHTML = '<style>.wrap{position:relative;display:inline-block}.overlay{position:absolute;inset:0}</style>' +
    '<button id="inner">Inner</button><div class="wrap"><button id="shadowCovered">x</button><div class="overlay" id="shadowOverlay"></div></div>';
  root.getElementById('inner').addEventListener('click', rec('shadow-click'));
</script>`;

test('input actions reach an unfocused guest as trusted events', async () => {
  const root = await mkdtemp(join(tmpdir(), 'intent-browser-input-'));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await build({
      configFile: false,
      logLevel: 'error',
      build: {
        ssr: resolve('src/features/browser/main/browser-input.ts'),
        outDir: root,
        emptyOutDir: false,
        minify: false,
        rollupOptions: {
          external: ['electron'],
          output: { format: 'cjs', entryFileNames: 'input.cjs' },
        },
      },
    });
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !key.startsWith('DD_') && !['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE'].includes(key),
      ),
    );
    app = await electron.launch({
      args: [
        resolve('test/fixtures/browser-input/main.cjs'),
        join(root, 'profile'),
        join(root, 'input.cjs'),
      ],
      env: { ...env, DD_TRACE_ENABLED: 'false' },
    });
    await expect.poll(() => app!.evaluate(() => !!(globalThis as any).inputFixture)).toBe(true);

    const evidence = await app.evaluate(async (_electron, page) => {
      const win = (globalThis as any).inputFixtureWindow;
      const { runInputAction } = (globalThis as any).inputFixture;
      const wc = win.webContents;
      await wc.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
      wc.debugger.attach('1.3');
      const send = (method: string, params?: Record<string, unknown>) =>
        wc.debugger.sendCommand(method, params);
      const run = async (action: Record<string, unknown>, scale = 1) => {
        try {
          return { ok: true, result: await runInputAction(send, action, process.platform, scale) };
        } catch (error: any) {
          return { ok: false, errorCode: error.errorCode, message: String(error.message) };
        }
      };

      // Baseline: what `evaluate` can do today — an untrusted key event.
      await wc.executeJavaScript(
        `document.getElementById('guarded').dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }))`,
      );
      const syntheticValue = await wc.executeJavaScript(`document.getElementById('guarded').value`);

      const steps = {
        type: await run({ action: 'type', selector: '#guarded', text: 'Hello' }),
        clearAndType: await run({ action: 'type', selector: '#guarded', text: '42', clear: true }),
        press: await run({ action: 'press', key: 'Enter' }),
        hover: await run({ action: 'hover', selector: '#hover' }),
        select: await run({ action: 'selectOption', selector: '#select', value: 'Beta' }),
        covered: await run({ action: 'click', selector: '#covered' }),
        far: await run({ action: 'click', selector: '#far' }),
        missing: await run({ action: 'click', selector: '#missing' }),
        notSelect: await run({ action: 'selectOption', selector: '#hover', value: 'a' }),
        unknownKey: await run({ action: 'press', key: 'Hyper' }),
        shadow: await run({ action: 'click', selector: '#inner' }),
        shadowCovered: await run({ action: 'click', selector: '#shadowCovered' }),
        tall: await run({ action: 'click', selector: '#tall' }),
        disabled: await run({ action: 'selectOption', selector: '#disabled', value: 'a' }),
        // Scale-to-fit agent tabs draw at scale < 1 (setTabViewport); CSS-px
        // coordinates must still land on the element.
        scaled: await (async () => {
          await send('Emulation.setDeviceMetricsOverride', {
            width: 1280,
            height: 800,
            deviceScaleFactor: 0,
            mobile: false,
            scale: 0.5,
          });
          try {
            return await run({ action: 'click', selector: '#scaled' }, 0.5);
          } finally {
            await send('Emulation.clearDeviceMetricsOverride');
          }
        })(),
      };
      const page_ = await wc.executeJavaScript(
        `({ value: document.getElementById('guarded').value,
            select: document.getElementById('select').value,
            scrollY: Math.round(window.scrollY),
            log: window.log })`,
      );
      return { syntheticValue, steps, page: page_, focused: win.isFocused() };
    }, PAGE);

    await test.info().attach('browser-input-evidence.json', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json',
    });

    expect(evidence.syntheticValue).toBe('');
    expect(evidence.page.value).toBe('42');
    expect(evidence.page.select).toBe('b');
    expect(evidence.page.scrollY).toBeGreaterThan(0);
    expect(evidence.focused).toBe(false);
    const trusted = (name: string) =>
      evidence.page.log.filter((e: { name: string }) => e.name === name);
    const [baseline, ...real] = trusted('keydown');
    expect(baseline).toEqual({ name: 'keydown', trusted: false });
    expect(real.length).toBeGreaterThan(0);
    expect(real.every((e: { trusted: boolean }) => e.trusted)).toBe(true);
    expect(trusted('submit')).toEqual([{ name: 'submit', trusted: true }]);
    expect(trusted('mouseenter')).toEqual([{ name: 'mouseenter', trusted: true }]);
    expect(trusted('far-click')).toEqual([{ name: 'far-click', trusted: true }]);
    expect(trusted('change')).toHaveLength(1);
    expect(evidence.steps.select).toEqual({ ok: true, result: { selected: ['b'] } });
    expect(evidence.steps.covered).toMatchObject({ ok: false, errorCode: 'element-obscured' });
    expect(evidence.steps.covered.message).toContain('overlay');
    expect(evidence.steps.missing).toMatchObject({ ok: false, errorCode: 'element-not-found' });
    expect(evidence.steps.notSelect).toMatchObject({ ok: false, errorCode: 'not-a-select' });
    expect(evidence.steps.unknownKey).toMatchObject({ ok: false, errorCode: 'unknown-key' });
    expect(trusted('shadow-click')).toEqual([{ name: 'shadow-click', trusted: true }]);
    expect(evidence.steps.shadowCovered).toMatchObject({
      ok: false,
      errorCode: 'element-obscured',
    });
    expect(evidence.steps.shadowCovered.message).toContain('shadowOverlay');
    expect(trusted('tall-click')).toEqual([{ name: 'tall-click', trusted: true }]);
    expect(evidence.steps.disabled).toMatchObject({ ok: false, errorCode: 'element-disabled' });
    expect(trusted('scaled-click')).toEqual([{ name: 'scaled-click', trusted: true }]);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
