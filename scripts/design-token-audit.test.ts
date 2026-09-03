import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const script = path.resolve(process.cwd(), 'scripts/design-token-audit.mjs');

function audit(mode: string): string {
  return execFileSync(process.execPath, [script, mode], { encoding: 'utf8' }).trim();
}

describe('design token audit', () => {
  it('enforces the semantic contract and ratchets', () => {
    expect(audit('check')).toMatch(/^token audit passed;/);
  });

  it('produces deterministic, sorted approved-token and alias inventories', () => {
    const approved = audit('approved').split('\n');
    const aliases = audit('aliases').split('\n');
    expect(new Set(approved).size).toBe(approved.length);
    expect(approved).toContain('--background');
    expect(approved).toContain('--warning-foreground');
    expect(aliases.every((line) => line.split('\t').length === 4)).toBe(true);
    expect(audit('approved')).toBe(audit('approved'));
    expect(audit('aliases')).toBe(audit('aliases'));
  });

  it('reports no unowned undefined custom properties', () => {
    expect(audit('undefined')).toBe('');
  });

  it('recognizes the Bits UI Select height without exempting other custom properties', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'design-token-audit-'));
    try {
      writeFileSync(
        path.join(directory, 'product.svelte'),
        '<div style="max-height: var(--bits-select-content-available-height); width: var(--bits-select-content-available-width); height: var(--bits-select-content-available-heigth)" />',
      );
      const output = execFileSync(process.execPath, [script, 'undefined'], {
        encoding: 'utf8',
        env: { ...process.env, DESIGN_TOKEN_AUDIT_SOURCE_ROOT: directory },
      });
      expect(output).not.toContain('--bits-select-content-available-height');
      expect(output).toContain('--bits-select-content-available-width');
      expect(output).toContain('--bits-select-content-available-heigth');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects an allowlisted adapter token outside its owned files', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'design-token-audit-'));
    try {
      writeFileSync(
        path.join(directory, 'product.svelte'),
        '<div style="color: var(--color-bg)" />',
      );
      const output = execFileSync(process.execPath, [script, 'undefined'], {
        encoding: 'utf8',
        env: { ...process.env, DESIGN_TOKEN_AUDIT_SOURCE_ROOT: directory },
      });
      expect(output).toContain('--color-bg');
      expect(output).toContain('product.svelte');
      expect(output).toContain('use an approved semantic role');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('recognizes literal runtime custom-property definitions', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'design-token-audit-'));
    try {
      writeFileSync(
        path.join(directory, 'runtime.ts'),
        [
          "document.documentElement.style.setProperty('--runtime-static', '1px');",
          "const staticUse = 'var(--runtime-static)';",
        ].join('\n'),
      );
      const output = execFileSync(process.execPath, [script, 'undefined'], {
        encoding: 'utf8',
        env: { ...process.env, DESIGN_TOKEN_AUDIT_SOURCE_ROOT: directory },
      });
      expect(output.trim()).toBe('');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('ignores negative assertions without accepting dynamic definitions or positive assertions', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'design-token-audit-'));
    try {
      writeFileSync(
        path.join(directory, 'scanner.test.ts'),
        [
          "document.documentElement.style.setProperty(runtimeName, '1px');",
          "document.documentElement.style.setProperty(`--${runtimeName}`, '1px');",
          "document.documentElement.style.setProperty(`--runtime-offset-${runtimeName}`, '1px');",
          "const actualUse = 'var(--runtime-dynamic)';",
          "const templateUse = 'var(--runtime-template-dynamic)';",
          "const fixedPrefixUse = 'var(--runtime-offset-unrelated)';",
          "expect(source).not.toContain('var(--removed-token)');",
          "expect(source).toContain('var(--asserted-token)');",
        ].join('\n'),
      );
      const output = execFileSync(process.execPath, [script, 'undefined'], {
        encoding: 'utf8',
        env: { ...process.env, DESIGN_TOKEN_AUDIT_SOURCE_ROOT: directory },
      });
      expect(output).toContain('--runtime-dynamic');
      expect(output).toContain('--runtime-template-dynamic');
      expect(output).toContain('--runtime-offset-unrelated');
      expect(output).toContain('--asserted-token');
      expect(output).not.toContain('--removed-token');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not let an unterminated utility assertion consume later lines', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'design-token-audit-'));
    try {
      writeFileSync(
        path.join(directory, 'scanner.test.ts'),
        [
          "expect(source).not.toContain('max-w-[var(--content-measure-');",
          "const className = 'w-[42px]';",
        ].join('\n'),
      );
      const output = execFileSync(process.execPath, [script, 'raw'], {
        encoding: 'utf8',
        env: { ...process.env, DESIGN_TOKEN_AUDIT_SOURCE_ROOT: directory },
      });
      expect(output).toContain('arbitrary\t1');
      expect(output).toContain('scanner.test.ts\t0\t1');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('requires every undefined-token exception to name its owned files', () => {
    const allowlist = JSON.parse(
      readFileSync(path.resolve(process.cwd(), 'scripts/design-token-allowlist.json'), 'utf8'),
    );
    expect(
      allowlist.undefined.every((entry: { allowedFiles?: string[] }) => entry.allowedFiles?.length),
    ).toBe(true);
    expect(
      allowlist.controlHeightExceptions.every(
        (entry: {
          files?: string[];
          owner?: string;
          reason?: string;
          replacement?: string;
          removalCondition?: string;
        }) =>
          entry.files?.length &&
          entry.owner &&
          entry.reason &&
          entry.replacement &&
          entry.removalCondition,
      ),
    ).toBe(true);
  });

  it('reports the file, raw utility, and replacement family when a ratchet grows', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'design-token-audit-'));
    try {
      writeFileSync(path.join(directory, 'product.svelte'), 'bg-red-500 '.repeat(903));
      const result = spawnSync(process.execPath, [script, 'check'], {
        encoding: 'utf8',
        env: { ...process.env, DESIGN_TOKEN_AUDIT_SOURCE_ROOT: directory },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('product.svelte');
      expect(result.stderr).toContain('bg-red-500');
      expect(result.stderr).toContain('approved semantic color family');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
