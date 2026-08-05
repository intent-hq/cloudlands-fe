import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const scriptPath = join(repoRoot, 'scripts/check-splash-i18n-sync.mjs');

function appHtml(entries: Record<string, string>, spanText = 'Getting ready to build') {
  const body = Object.entries(entries)
    .map(([locale, value]) => `            '${locale}': '${value.replace(/'/g, "\\'")}'`)
    .join(',\n');
  return `<!doctype html>
<html lang="en">
  <body>
    <span id="splash-text">${spanText}</span>
    <script>
      (function() {
        try {
          const messages = {
${body}
          };
        } catch (e) {}
      })();
    </script>
  </body>
</html>
`;
}

function catalog(value: string) {
  return JSON.stringify({ splash_gettingReady_label: value });
}

function withFixture(files: Record<string, string>, run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'splash-i18n-sync-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), content);
    }
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runCheck(dir: string) {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, dir], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, output: stdout };
  } catch (error) {
    const err = error as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      exitCode: err.status ?? 1,
      output: `${err.stdout?.toString() ?? ''}${err.stderr?.toString() ?? ''}`,
    };
  }
}

describe('splash i18n sync gate', () => {
  it('passes when the inline map matches every catalog', () => {
    withFixture(
      {
        'src/app.html': appHtml({ en: 'Getting ready to build', de: 'Wir bauen' }),
        'messages/en.json': catalog('Getting ready to build'),
        'messages/de.json': catalog('Wir bauen'),
      },
      (dir) => {
        const result = runCheck(dir);
        expect(result.output).toContain('passed');
        expect(result.exitCode).toBe(0);
      },
    );
  });

  it('fails when an inline map value diverges from the catalog', () => {
    withFixture(
      {
        'src/app.html': appHtml({ en: 'Getting ready to build', de: 'Stale value' }),
        'messages/en.json': catalog('Getting ready to build'),
        'messages/de.json': catalog('Wir bauen'),
      },
      (dir) => {
        const result = runCheck(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('de: splash map value diverges');
        expect(result.output).toContain('catalog:  "Wir bauen"');
        expect(result.output).toContain('app.html: "Stale value"');
      },
    );
  });

  it('fails when a catalog locale is missing from the inline map', () => {
    withFixture(
      {
        'src/app.html': appHtml({ en: 'Getting ready to build' }),
        'messages/en.json': catalog('Getting ready to build'),
        'messages/de.json': catalog('Wir bauen'),
      },
      (dir) => {
        const result = runCheck(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('de: missing from the src/app.html splash map');
      },
    );
  });

  it('fails when the inline map has a locale with no catalog file', () => {
    withFixture(
      {
        'src/app.html': appHtml({ en: 'Getting ready to build', fr: 'Nous construisons' }),
        'messages/en.json': catalog('Getting ready to build'),
      },
      (dir) => {
        const result = runCheck(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain(
          'fr: present in the src/app.html splash map but messages/fr.json does not exist',
        );
      },
    );
  });

  it('fails when a catalog lacks the splash key', () => {
    withFixture(
      {
        'src/app.html': appHtml({ en: 'Getting ready to build' }),
        'messages/en.json': JSON.stringify({ other_label: 'x' }),
      },
      (dir) => {
        const result = runCheck(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('en: messages/en.json has no splash_gettingReady_label');
      },
    );
  });

  it('passes when the hardcoded span default matches the en catalog', () => {
    withFixture(
      {
        'src/app.html': appHtml({ en: 'Getting ready to build' }, 'Getting ready to build'),
        'messages/en.json': catalog('Getting ready to build'),
      },
      (dir) => {
        const result = runCheck(dir);
        expect(result.output).toContain('passed');
        expect(result.exitCode).toBe(0);
      },
    );
  });

  it('fails when the hardcoded span default drifts from the en catalog', () => {
    withFixture(
      {
        'src/app.html': appHtml({ en: 'Getting ready to ship' }, 'Getting ready to build'),
        'messages/en.json': catalog('Getting ready to ship'),
      },
      (dir) => {
        const result = runCheck(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain(
          'en: hardcoded <span id="splash-text"> default diverges from messages/en.json',
        );
        expect(result.output).toContain('catalog:  "Getting ready to ship"');
        expect(result.output).toContain('app.html: "Getting ready to build"');
      },
    );
  });

  it('fails when app.html has no splash-text span', () => {
    withFixture(
      {
        'src/app.html': appHtml({ en: 'Getting ready to build' }).replace(
          /<span id="splash-text">.*<\/span>/,
          '',
        ),
        'messages/en.json': catalog('Getting ready to build'),
      },
      (dir) => {
        const result = runCheck(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('no `<span id="splash-text">` element found');
      },
    );
  });

  it('fails clearly when app.html has no messages map', () => {
    withFixture(
      {
        'src/app.html': '<!doctype html><html><body></body></html>',
        'messages/en.json': catalog('Getting ready to build'),
      },
      (dir) => {
        const result = runCheck(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('no `const messages = { ... }` map found');
      },
    );
  });

  it('passes against the real repository tree', () => {
    const result = runCheck(repoRoot);
    expect(result.output).toContain('passed');
    expect(result.exitCode).toBe(0);
  });
});
