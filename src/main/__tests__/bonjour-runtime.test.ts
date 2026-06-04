import { describe, expect, it } from 'vitest';
import { __resolveBonjourModuleForTests } from '../utils/bonjour-runtime';

describe('bonjour-runtime', () => {
  it('resolves a named Bonjour constructor from a CommonJS module shape', () => {
    class Bonjour {}

    expect(__resolveBonjourModuleForTests({ Bonjour })).toBe(Bonjour);
  });

  it('falls back to the module value when it is the Bonjour constructor', () => {
    class Bonjour {}

    expect(__resolveBonjourModuleForTests(Bonjour)).toBe(Bonjour);
  });

  it('resolves a default Bonjour constructor from bundled interop shapes', () => {
    class Bonjour {}

    expect(__resolveBonjourModuleForTests({ default: Bonjour })).toBe(Bonjour);
  });

  it('throws a useful error when no Bonjour constructor can be resolved', () => {
    expect(() => __resolveBonjourModuleForTests({ Bonjour: 'not-a-constructor' })).toThrow(
      /Unable to resolve bonjour-service Bonjour constructor/,
    );
  });
});