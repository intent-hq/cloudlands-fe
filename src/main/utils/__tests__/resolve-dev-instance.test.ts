import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveDevInstance, resolveDevUserDataDirName } from '../resolve-dev-instance';

const ENV_KEYS = ['NODE_ENV', 'DEV_INSTANCE', 'DEV_PORT'] as const;

describe('resolveDevInstance', () => {
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

  it('returns DEV_INSTANCE verbatim when set', () => {
    process.env.DEV_INSTANCE = '3';
    expect(resolveDevInstance()).toBe('3');
  });

  it('derives 1-based instance from DEV_PORT relative to base 5190', () => {
    process.env.DEV_PORT = '5191';
    expect(resolveDevInstance()).toBe('2');
  });

  it('returns empty string when nothing usable is set', () => {
    expect(resolveDevInstance()).toBe('');
  });
});

describe('resolveDevUserDataDirName', () => {
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

  it('returns null outside development', () => {
    process.env.NODE_ENV = 'production';
    process.env.DEV_PORT = '5190';
    expect(resolveDevUserDataDirName()).toBeNull();
  });

  it('namespaces by absolute DEV_PORT in development', () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_PORT = '5190';
    expect(resolveDevUserDataDirName()).toBe('cloudlands-dev-5190');
  });

  it('cannot collide with reference Intent dev-instance-N naming', () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_PORT = '5177';
    const name = resolveDevUserDataDirName();
    expect(name).toBe('cloudlands-dev-5177');
    expect(name).not.toMatch(/^dev-instance-/);
  });

  it('falls back to unprefixed name when DEV_PORT is unset in dev', () => {
    process.env.NODE_ENV = 'development';
    expect(resolveDevUserDataDirName()).toBe('cloudlands-dev');
  });

  it('falls back to unprefixed name when DEV_PORT is not a positive number', () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_PORT = 'not-a-number';
    expect(resolveDevUserDataDirName()).toBe('cloudlands-dev');
  });
});
