import type { Page } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';
import { prepareSidebarShell } from '../test/sidebar-shell-import';

function pageBoundary() {
  const operations = {
    addInitScript: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(undefined),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
  };
  return { operations, page: operations as unknown as Page };
}

describe('sidebar fixture import and document setup', () => {
  it('allows the mount to continue after an ordinary successful import', async () => {
    const { page, operations } = pageBoundary();
    const mount = vi.fn();
    await prepareSidebarShell(page, 'http://sidebar.test/').then(mount);
    expect(mount).toHaveBeenCalledOnce();
    expect(operations.goto).toHaveBeenCalledWith('http://sidebar.test/src/app.html');
    expect(operations.evaluate).toHaveBeenCalledTimes(2);
    expect(operations.waitForLoadState).not.toHaveBeenCalled();
  });

  for (const boundary of ['load', 'environment'] as const) {
    it(`preserves the import error when recovery ${boundary} fails`, async () => {
      const { page, operations } = pageBoundary();
      const original = new Error('ORIGINAL_IMPORT');
      const recovery = new Error('RECOVERY_CONTEXT');
      operations.evaluate.mockResolvedValueOnce(undefined).mockRejectedValueOnce(original);
      if (boundary === 'load') operations.waitForLoadState.mockRejectedValueOnce(recovery);
      else operations.evaluate.mockRejectedValueOnce(recovery);
      const mount = vi.fn();
      const failure = await prepareSidebarShell(page, 'http://sidebar.test/')
        .then(mount)
        .catch((error: unknown) => error);
      expect(mount).not.toHaveBeenCalled();
      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).cause).toBe(original);
      expect((failure as AggregateError).errors).toEqual([original, recovery]);
      expect(String(failure)).toContain('ORIGINAL_IMPORT');
      expect(String(failure)).toContain('RECOVERY_CONTEXT');
      expect(operations.evaluate).toHaveBeenCalledTimes(boundary === 'load' ? 2 : 3);
      expect(operations.waitForLoadState).toHaveBeenCalledOnce();
    });
  }

  for (const failedImports of [1, 2]) {
    it(`allows success after ${failedImports} recoverable import failures`, async () => {
      const { page, operations } = pageBoundary();
      operations.evaluate.mockResolvedValueOnce(undefined);
      for (let attempt = 0; attempt < failedImports; attempt += 1) {
        operations.evaluate
          .mockRejectedValueOnce(new Error(`IMPORT_${attempt}`))
          .mockResolvedValueOnce(undefined);
      }
      const mount = vi.fn();
      await prepareSidebarShell(page, 'http://sidebar.test/').then(mount);
      expect(mount).toHaveBeenCalledOnce();
      expect(operations.evaluate).toHaveBeenCalledTimes(2 + 2 * failedImports);
      expect(operations.waitForLoadState).toHaveBeenCalledTimes(failedImports);
    });
  }

  it('stops after the existing three import attempts and preserves the final error', async () => {
    const { page, operations } = pageBoundary();
    const finalError = new Error('FINAL_IMPORT');
    operations.evaluate
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('FIRST_IMPORT'))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('SECOND_IMPORT'))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(finalError);
    const mount = vi.fn();
    await expect(prepareSidebarShell(page, 'http://sidebar.test/').then(mount)).rejects.toBe(
      finalError,
    );
    expect(mount).not.toHaveBeenCalled();
    expect(operations.evaluate).toHaveBeenCalledTimes(6);
    expect(operations.waitForLoadState).toHaveBeenCalledTimes(2);
  });

  it('does not turn initial setup failure into an import retry', async () => {
    const { page, operations } = pageBoundary();
    const setupError = new Error('INITIAL_SETUP');
    operations.evaluate.mockRejectedValueOnce(setupError);
    await expect(prepareSidebarShell(page, 'http://sidebar.test/')).rejects.toBe(setupError);
    expect(operations.evaluate).toHaveBeenCalledOnce();
    expect(operations.waitForLoadState).not.toHaveBeenCalled();
  });
});
