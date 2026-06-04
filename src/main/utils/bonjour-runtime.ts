import { createRequire } from 'module';
import type BonjourModule from 'bonjour-service';

const require = createRequire(import.meta.url);

export type BonjourClass = typeof BonjourModule;

let cachedBonjourModule: unknown;

function loadBonjourModule(): unknown {
  cachedBonjourModule ??= require('bonjour-service');
  return cachedBonjourModule;
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return (typeof value === 'object' || typeof value === 'function') && value !== null;
}

function getProperty(value: unknown, key: string): unknown {
  return isObjectLike(value) ? value[key] : undefined;
}

function isConstructable(value: unknown): boolean {
  if (typeof value !== 'function') return false;
  try {
    Reflect.construct(Object, [], value);
    return true;
  } catch {
    return false;
  }
}

function firstConstructable<T>(candidates: unknown[]): T | undefined {
  return candidates.find(isConstructable) as T | undefined;
}

function describeValueShape(value: unknown): string {
  if (!isObjectLike(value)) return value === null ? 'null' : typeof value;

  const keys = Object.keys(value);
  const visibleKeys = keys.slice(0, 20);
  const keySummary = visibleKeys
    .map((key) => `${key}:${typeof getProperty(value, key)}`)
    .join(', ');
  const suffix = keys.length > visibleKeys.length ? ', …' : '';
  return `${typeof value}{${keySummary}${suffix}}`;
}

function describeBonjourModuleShape(moduleValue: unknown): string {
  const defaultValue = getProperty(moduleValue, 'default');
  return `module=${describeValueShape(moduleValue)}; default=${describeValueShape(defaultValue)}`;
}

function resolveBonjourModule(moduleValue: unknown): BonjourClass {
  const defaultValue = getProperty(moduleValue, 'default');
  const moduleShape = describeBonjourModuleShape(moduleValue);

  const Bonjour = firstConstructable<BonjourClass>([
    getProperty(moduleValue, 'Bonjour'),
    getProperty(defaultValue, 'Bonjour'),
    moduleValue,
    defaultValue,
  ]);

  if (!Bonjour) {
    throw new Error(
      `Unable to resolve bonjour-service Bonjour constructor; module shape: ${moduleShape}`,
    );
  }

  return Bonjour;
}

export function getBonjourClass(): BonjourClass {
  return resolveBonjourModule(loadBonjourModule());
}

export const __resolveBonjourModuleForTests = resolveBonjourModule;