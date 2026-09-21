import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import {
  decorateWindowTitle,
  registerWindowTitleListener,
  resolveAppTitle,
  setResolvedAppName,
} from '../resolve-app-title';

const ENV_KEYS = ['NODE_ENV', 'DEV_NAME', 'DEV_INSTANCE', 'DEV_PORT'] as const;

describe('resolveAppTitle', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('shows the launcher-provided branch name in development', () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_NAME = 'polish-ui';

    expect(resolveAppTitle()).toBe('Electron [polish-ui]');
  });

  it('shows an explicit launcher name in development', () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_NAME = 'custom name';

    expect(resolveAppTitle()).toBe('Electron [custom name]');
  });

  it('uses a readable, unique instance fallback when no name is available', () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_INSTANCE = '3';

    expect(resolveAppTitle()).toBe('Electron [Dev 3]');
  });

  it('uses the generic development fallback when no name or instance is available', () => {
    process.env.NODE_ENV = 'development';

    expect(resolveAppTitle()).toBe('Electron [Dev]');
  });

  it('keeps the production title unchanged', () => {
    process.env.NODE_ENV = 'production';
    process.env.DEV_NAME = 'polish-ui';

    expect(resolveAppTitle()).toBe('Intent');
  });

  it('keeps the development instance name when a renderer title replaces the initial title', () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_NAME = 'polish-ui';

    expect(decorateWindowTitle('Terminal — Example workspace')).toBe(
      'Terminal — Example workspace — Electron [polish-ui]',
    );
  });

  it('does not decorate renderer titles in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.DEV_NAME = 'polish-ui';

    expect(decorateWindowTitle('Terminal — Example workspace')).toBe(
      'Terminal — Example workspace',
    );
  });

  it.each([
    ['development', 'Chat — Workspace — Electron [polish-ui]'],
    ['production', 'Chat — Workspace'],
  ])('keeps the resolved label after a %s page title update', (nodeEnv, expectedTitle) => {
    process.env.NODE_ENV = nodeEnv;
    process.env.DEV_NAME = 'polish-ui';
    let listener: ((event: { preventDefault(): void }, title: string) => void) | undefined;
    const window = {
      on: vi.fn((_event, handler) => {
        listener = handler;
      }),
      setTitle: vi.fn(),
    } as unknown as BrowserWindow;
    const event = { preventDefault: vi.fn() };

    registerWindowTitleListener(window);
    listener?.(event, 'Chat — Workspace');

    expect(window.on).toHaveBeenCalledWith('page-title-updated', expect.any(Function));
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(window.setTitle).toHaveBeenCalledWith(expectedTitle);
  });

  it('does not duplicate the label after a labeled page title update', () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_NAME = 'polish-ui';
    let listener: ((event: { preventDefault(): void }, title: string) => void) | undefined;
    const window = {
      on: vi.fn((_event, handler) => {
        listener = handler;
      }),
      setTitle: vi.fn(),
    } as unknown as BrowserWindow;

    registerWindowTitleListener(window);
    listener?.({ preventDefault: vi.fn() }, 'Chat — Workspace — Electron [polish-ui]');

    expect(window.setTitle).toHaveBeenCalledWith('Chat — Workspace — Electron [polish-ui]');
  });

  it('sets and returns one development app name for the macOS application menu', () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_NAME = 'polish-ui';
    const app = { setName: vi.fn() };
    const processTarget = { title: 'Electron' };

    const menuLabel = setResolvedAppName(app, processTarget);

    expect(app.setName).toHaveBeenCalledWith('Electron [polish-ui]');
    expect(processTarget.title).toBe('Electron [polish-ui]');
    expect(menuLabel).toBe('Electron [polish-ui]');
  });

  it('does not change the packaged process title in production', () => {
    process.env.NODE_ENV = 'production';
    const app = { setName: vi.fn() };
    const processTarget = { title: '/Applications/Intent.app/Contents/MacOS/Intent' };

    expect(setResolvedAppName(app, processTarget)).toBe('Intent');
    expect(app.setName).toHaveBeenCalledWith('Intent');
    expect(processTarget.title).toBe('/Applications/Intent.app/Contents/MacOS/Intent');
  });
});
