// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { applyAndVerifyMotion } from './ct-motion';

describe('CT motion enforcement', () => {
  it.each([undefined, null])('does not touch browser media for %s', async (requested) => {
    const page = { emulateMedia: vi.fn(), evaluate: vi.fn() };
    await applyAndVerifyMotion(page, requested);
    expect(page.emulateMedia).not.toHaveBeenCalled();
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it.each([
    { reduce: true, noPreference: true },
    { reduce: false, noPreference: false },
  ])('rejects inconsistent complementary queries: %j', async (actual) => {
    const page = { emulateMedia: vi.fn(), evaluate: vi.fn().mockResolvedValue(actual) };
    await expect(applyAndVerifyMotion(page, 'reduce')).rejects.toThrow('CT motion mismatch');
  });
});
