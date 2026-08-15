import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveAppTitle } from '../resolve-app-title';

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
});
