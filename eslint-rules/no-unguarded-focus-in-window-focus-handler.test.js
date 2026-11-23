// @vitest-environment node
import { RuleTester } from 'eslint';
import typescriptParser from '@typescript-eslint/parser';
import { describe, expect, it } from 'vitest';
import rule from './no-unguarded-focus-in-window-focus-handler.js';

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module', parser: typescriptParser },
});

const error = (line, window = 'window') => ({
  messageId: 'unguardedFocus',
  line,
  data: { window },
});

describe('no-unguarded-focus-in-window-focus-handler guidance', () => {
  it('explains the re-raise, gives the guard, and cites the incidents', () => {
    const message = rule.meta.messages.unguardedFocus;
    expect(message).toContain('owner_window()->Focus(true)');
    expect(message).toContain('if (!{{window}}.isFocused()) return;');
    expect(message).toContain('cloudlands-fe#4546');
    expect(message).toContain('intent-hq/intent#9928');
    expect(message).toContain('cloudlands-fe#4958');
  });
});

tester.run('no-unguarded-focus-in-window-focus-handler', rule, {
  valid: [
    {
      name: 'the machine-rail handler (early return on a stale event)',
      code: `
window.on('focus', () => {
  if (!window.isFocused()) return;
  const shown = getShownRendererWebContents(window);
  if (shown !== window.webContents && !shown.isDestroyed() && !shown.isFocused()) {
    shown.focus();
  }
});`,
    },
    {
      name: 'a guard in an || chain, a block return, and === false',
      code: `
window.on('focus', () => {
  if (window.isDestroyed() || !window.isFocused()) {
    return;
  }
  view.webContents.focus();
});
other.once('focus', function () {
  if (other.isFocused() === false) return;
  other.webContents.focus();
});`,
    },
    {
      name: 'statements without focus() before the guard',
      code: `
window.on('focus', () => {
  const view = viewOf(window);
  if (!window.isFocused()) return;
  view.webContents.focus();
});`,
    },
    {
      name: 'focus() only while the window is focused',
      code: `
window.on('focus', () => {
  if (window.isFocused() && !view.webContents.isDestroyed()) view.webContents.focus();
});`,
    },
    {
      name: 'a focus handler that does not call focus()',
      code: `
window.on('focus', () => {
  sendToRenderers('window:focus', true);
});
window.on('blur', () => view.webContents.focus());`,
    },
    {
      name: 'a browser-window-focus handler guarded on its window parameter',
      code: `
app.on('browser-window-focus', (_event, win) => {
  if (!win.isFocused()) return;
  win.webContents.focus();
});`,
    },
    {
      name: 'a named handler declared in the file, guarded',
      code: `
function onFocus() {
  if (!this.window.isFocused()) return;
  this.view.webContents.focus();
}
this.window.on('focus', onFocus);`,
    },
    {
      name: 'a handler passed in as a parameter is not its enclosing function',
      code: `
function attach(win, onFocus) {
  win.on('focus', onFocus);
  win.webContents.focus();
}`,
    },
    {
      name: 'a browser-window-focus handler without focus() and without a window parameter',
      code: `
app.on('browser-window-focus', () => {
  void rebuildMenu();
});`,
    },
    {
      name: 'a fresh guard inside a deferred callback, without an outer guard',
      code: `
window.on('focus', () => {
  setTimeout(() => {
    if (!window.isFocused()) return;
    view.webContents.focus();
  }, 0);
});`,
    },
    {
      name: 'a guard repeated after an await, and an await after focus()',
      code: `
window.on('focus', async () => {
  if (!window.isFocused()) return;
  await refresh();
  if (!window.isFocused()) return;
  view.webContents.focus();
  await log();
});
window.on('focus', async () => {
  if (window.isFocused()) await view.webContents.focus();
});`,
    },
    {
      name: 'an await in the condition before the focus check',
      code: `
window.on('focus', async () => {
  if ((await stale()) || !window.isFocused()) return;
  view.webContents.focus();
});
window.on('focus', async () => {
  if ((await ready()) && window.isFocused()) view.webContents.focus();
});`,
    },
    {
      name: 'a loop without an await, and a fresh check in each iteration',
      code: `
window.on('focus', () => {
  if (!window.isFocused()) return;
  for (const view of views) view.webContents.focus();
});
window.on('focus', async () => {
  for (const view of views) {
    if (!window.isFocused()) return;
    view.webContents.focus();
    await refresh();
  }
  while (pending()) {
    if (!window.isFocused()) continue;
    other.webContents.focus();
    await refresh();
  }
  for (const view of views) {
    if (window.isFocused()) view.webContents.focus();
    await refresh();
  }
});`,
    },
    {
      name: 'a fresh guard after a for-await loop',
      code: `
window.on('focus', async () => {
  if (!window.isFocused()) return;
  for await (const update of updates) applyUpdate(update);
  if (!window.isFocused()) return;
  view.webContents.focus();
});`,
    },
    {
      name: 'a handler that cannot be resolved in this file',
      code: `
import { onFocus } from './focus';
window.on('focus', onFocus);`,
    },
  ],
  invalid: [
    {
      name: 'the cloudlands-fe#4546 handler, before the guard',
      code: `
window.on('focus', () => {
  const shown = getShownRendererWebContents(window);
  if (shown !== window.webContents && !shown.isDestroyed() && !shown.isFocused()) {
    shown.focus();
  }
});`,
      errors: [error(5)],
    },
    {
      name: 'an expression-bodied handler',
      code: `window.on('focus', () => view.webContents.focus());`,
      errors: [error(1)],
    },
    {
      name: 'focus() before the guard',
      code: `
window.on('focus', () => {
  view.webContents.focus();
  if (!window.isFocused()) return;
  other.webContents.focus();
});`,
      errors: [error(3)],
    },
    {
      name: 'a guard on another window does not count',
      code: `
window.on('focus', () => {
  if (!other.isFocused()) return;
  view.webContents.focus();
});`,
      errors: [error(4)],
    },
    {
      name: 'a guard that does not return, or a nested guard',
      code: `
window.on('focus', () => {
  if (!window.isFocused()) log('stale');
  view.webContents.focus();
});
window.on('focus', () => {
  if (ready) {
    if (!window.isFocused()) return;
  }
  view.webContents.focus();
});`,
      errors: [error(4), error(10)],
    },
    {
      name: 'an && guard is not an early return',
      code: `
window.on('focus', () => {
  if (!window.isFocused() && ready) return;
  view.webContents.focus();
});`,
      errors: [error(4)],
    },
    {
      name: 'a focus() in the else branch of a focused check',
      code: `
window.on('focus', () => {
  if (window.isFocused()) log('focused');
  else view.webContents.focus();
});`,
      errors: [error(4)],
    },
    {
      name: 'every listener method, a deferred call, and window.focus()',
      code: `
window.once('focus', () => view.webContents.focus());
window.addListener('focus', () => setTimeout(() => view.webContents.focus(), 0));
window.prependListener('focus', () => window.focus());
window.prependOnceListener('focus', () => view.webContents?.focus());`,
      errors: [error(2), error(3), error(4), error(5)],
    },
    {
      name: 'a named handler: declaration and const arrow',
      code: `
function onFocus() {
  view.webContents.focus();
}
window.on('focus', onFocus);
const onOtherFocus = () => other.webContents.focus();
other.on('focus', onOtherFocus);`,
      errors: [error(3), error(6, 'other')],
    },
    {
      name: 'an app browser-window-focus handler',
      code: `
app.on('browser-window-focus', (_event, win) => {
  win.webContents.focus();
});`,
      errors: [error(3, 'win')],
    },
    {
      name: 'a browser-window-focus handler with no window parameter cannot be guarded',
      code: `
app.on('browser-window-focus', () => {
  if (!mainWindow.isFocused()) return;
  mainWindow.webContents.focus();
});
app.on('browser-window-focus', (_event, { webContents }) => webContents.focus());`,
      errors: [error(4), error(6)],
    },
    {
      name: 'an outer guard does not cover a deferred callback',
      code: `
window.on('focus', () => {
  if (!window.isFocused()) return;
  setTimeout(() => view.webContents.focus(), 0);
  queueMicrotask(function () {
    if (window.isFocused()) other.focus();
  });
  Promise.resolve().then(() => view.webContents.focus());
});`,
      errors: [error(4), error(8)],
    },
    {
      name: 'an await between the guard and focus()',
      code: `
window.on('focus', async () => {
  if (!window.isFocused()) return;
  await refresh();
  view.webContents.focus();
});
window.on('focus', async () => {
  if (window.isFocused()) {
    await refresh();
    view.webContents.focus();
  }
});`,
      errors: [error(5), error(10)],
    },
    {
      name: 'an await in the condition after the focus check',
      code: `
window.on('focus', async () => {
  if (window.isFocused() && (await ready())) view.webContents.focus();
});
window.on('focus', async () => {
  if (!window.isFocused() || (await stale())) return;
  view.webContents.focus();
});`,
      errors: [error(3), error(7)],
    },
    {
      name: 'an await in the receiver or arguments of focus()',
      code: `
window.on('focus', async () => {
  if (!window.isFocused()) return;
  (await getView()).webContents.focus();
  view.webContents.focus(await options());
});`,
      errors: [error(4), error(5)],
    },
    {
      name: 'a check before a loop goes stale across iterations that await',
      code: `
window.on('focus', async () => {
  if (!window.isFocused()) return;
  for (const view of views) {
    view.webContents.focus();
    await refresh();
  }
  while (pending()) await other.webContents.focus();
  for await (const view of viewStream()) view.webContents.focus();
  do {
    view.webContents.focus();
  } while (await more());
});`,
      errors: [error(5), error(8), error(9), error(11)],
    },
    {
      name: 'a for-await loop between the guard and focus()',
      code: `
window.on('focus', async () => {
  if (!window.isFocused()) return;
  for await (const update of updates) {
    applyUpdate(update);
  }
  view.webContents.focus();
});`,
      errors: [error(7)],
    },
    {
      name: 'a TypeScript-cast emitter and computed keys',
      code: `
(win as BrowserWindow).on('focus', () => {
  view.webContents['focus']();
});`,
      errors: [error(3, 'win')],
    },
  ],
});
