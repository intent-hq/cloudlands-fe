// @vitest-environment node
/**
 * Manual Windows-only integration tests for real TerminalHandler PowerShell execution.
 * These are intended for local developer execution on Windows and must not be added to CI.
 */

import { spawnSync } from 'child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { TerminalHandler } from '../terminal';

const TEST_TIMEOUT_MS = 10_000;

function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function normalizeOutput(output: string): string {
  return output.replace(/\r\n/g, '\n');
}

function getOutputLines(output: string): string[] {
  return normalizeOutput(output)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

async function writeFixture(root: string, relativePath: string, content: string): Promise<string> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
  return filePath;
}

async function createFixtureDir(root: string, relativePath: string): Promise<string> {
  const directoryPath = path.join(root, relativePath);
  await fs.mkdir(directoryPath, { recursive: true });
  return directoryPath;
}

async function runTerminalCommand(options: {
  workspacePath: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}): Promise<{ output: string; exitCode: number | null }> {
  const handler = new TerminalHandler(options.workspacePath);
  let terminalId: string | undefined;

  try {
    terminalId = await handler.createTerminal(options.command, options.args, options.cwd, options.env);
    const exitStatus = await handler.waitForExit(terminalId);
    return {
      output: handler.getOutput(terminalId).join(''),
      exitCode: exitStatus.exitCode ?? null,
    };
  } finally {
    if (terminalId) {
      await handler.releaseTerminal(terminalId).catch(() => undefined);
    }
    await handler.dispose().catch(() => undefined);
  }
}

function resolvePythonCommand(): string | null {
  const candidates = [
    { command: 'python', checkArgs: ['--version'], runCommand: 'python -c "print(\'hello\')"' },
    { command: 'py', checkArgs: ['-3', '--version'], runCommand: 'py -3 -c "print(\'hello\')"' },
    { command: 'python3', checkArgs: ['--version'], runCommand: 'python3 -c "print(\'hello\')"' },
  ];

  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, candidate.checkArgs, { windowsHide: true });
    if (!result.error && result.status === 0) {
      return candidate.runCommand;
    }
  }

  return null;
}

const pythonCommand = process.platform === 'win32' ? resolvePythonCommand() : null;
const pythonIt = pythonCommand ? it : it.skip;

describe.skipIf(process.platform !== 'win32')('TerminalHandler Windows encoded-command integration', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-handler-win-it-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('reads a file from a path with spaces using a single-quoted path', async () => {
    const filePath = await writeFixture(tempDir, path.join('dir with spaces', 'probe.txt'), 'space path\n');
    const result = await runTerminalCommand({ workspacePath: tempDir, command: `Get-Content ${quotePowerShellLiteral(filePath)}` });
    expect(result.exitCode).toBe(0);
    expect(normalizeOutput(result.output)).toContain('space path');
  }, TEST_TIMEOUT_MS);

  it('reads a file from a path with parentheses', async () => {
    const filePath = await writeFixture(tempDir, path.join('Program Files (x86)', 'probe.txt'), 'parentheses path\n');
    const result = await runTerminalCommand({ workspacePath: tempDir, command: `Get-Content ${quotePowerShellLiteral(filePath)}` });
    expect(result.exitCode).toBe(0);
    expect(normalizeOutput(result.output)).toContain('parentheses path');
  }, TEST_TIMEOUT_MS);

  it('lists directory contents where the directory name has spaces', async () => {
    const dirPath = await createFixtureDir(tempDir, 'list dir with spaces');
    await fs.writeFile(path.join(dirPath, 'alpha.txt'), 'alpha', 'utf8');
    await fs.writeFile(path.join(dirPath, 'bravo.txt'), 'bravo', 'utf8');
    const result = await runTerminalCommand({
      workspacePath: tempDir,
      command: `Get-ChildItem ${quotePowerShellLiteral(dirPath)} | Select-Object -ExpandProperty Name`,
    });
    expect(result.exitCode).toBe(0);
    expect(getOutputLines(result.output)).toEqual(expect.arrayContaining(['alpha.txt', 'bravo.txt']));
  }, TEST_TIMEOUT_MS);

  it('writes output to a file in a path with spaces using redirection', async () => {
    const outputPath = path.join(await createFixtureDir(tempDir, 'output dir with spaces'), 'out.txt');
    const result = await runTerminalCommand({
      workspacePath: tempDir,
      command: `Write-Output 'hello redirection' > ${quotePowerShellLiteral(outputPath)}`,
    });
    expect(result.exitCode).toBe(0);
    await expect(fs.readFile(outputPath, 'utf8')).resolves.toContain('hello redirection');
  }, TEST_TIMEOUT_MS);

  it('uses the cwd parameter for a path with spaces and simple relative commands', async () => {
    const cwdWithSpaces = await createFixtureDir(tempDir, 'cwd with spaces');
    await fs.writeFile(path.join(cwdWithSpaces, 'probe.txt'), 'relative cwd\n', 'utf8');
    const result = await runTerminalCommand({
      workspacePath: tempDir,
      cwd: cwdWithSpaces,
      command: 'Get-Content .\\probe.txt',
    });
    expect(result.exitCode).toBe(0);
    expect(normalizeOutput(result.output)).toContain('relative cwd');
  }, TEST_TIMEOUT_MS);

  it('supports foreach variable expansion', async () => {
    const result = await runTerminalCommand({
      workspacePath: tempDir,
      command: 'foreach ($x in @(1,2,3)) { Write-Output $x }',
    });
    expect(result.exitCode).toBe(0);
    expect(getOutputLines(result.output)).toEqual(['1', '2', '3']);
  }, TEST_TIMEOUT_MS);

  it('supports variable assignment and later property access', async () => {
    await writeFixture(tempDir, 'one.txt', '1');
    await writeFixture(tempDir, 'two.txt', '2');
    const result = await runTerminalCommand({
      workspacePath: tempDir,
      cwd: tempDir,
      command: '$result = Get-ChildItem; $result.Count',
    });
    expect(result.exitCode).toBe(0);
    expect(Number.parseInt(normalizeOutput(result.output).trim(), 10)).toBe(2);
  }, TEST_TIMEOUT_MS);

  it('supports ForEach-Object with $_', async () => {
    const result = await runTerminalCommand({ workspacePath: tempDir, command: '1..3 | ForEach-Object { $_ * 2 }' });
    expect(result.exitCode).toBe(0);
    expect(getOutputLines(result.output)).toEqual(['2', '4', '6']);
  }, TEST_TIMEOUT_MS);

  it('supports variable assignment and use in the same command', async () => {
    const result = await runTerminalCommand({
      workspacePath: tempDir,
      command: `$name = 'Intent'; Write-Output "Hello $name"`,
    });
    expect(result.exitCode).toBe(0);
    expect(normalizeOutput(result.output).trim()).toBe('Hello Intent');
  }, TEST_TIMEOUT_MS);

  it('supports Where-Object with $_ comparison', async () => {
    const result = await runTerminalCommand({ workspacePath: tempDir, command: '1..5 | Where-Object { $_ -gt 3 }' });
    expect(result.exitCode).toBe(0);
    expect(getOutputLines(result.output)).toEqual(['4', '5']);
  }, TEST_TIMEOUT_MS);

  it('handles a single-quoted string containing an apostrophe', async () => {
    const result = await runTerminalCommand({ workspacePath: tempDir, command: `Write-Output 'it''s a test'` });
    expect(result.exitCode).toBe(0);
    expect(normalizeOutput(result.output).trim()).toBe(`it's a test`);
  }, TEST_TIMEOUT_MS);

  it('handles a double-quoted string containing a dollar sign', async () => {
    const result = await runTerminalCommand({ workspacePath: tempDir, command: 'Write-Output "costs `$5"' });
    expect(result.exitCode).toBe(0);
    expect(normalizeOutput(result.output).trim()).toBe('costs $5');
  }, TEST_TIMEOUT_MS);

  it('handles nested quotes in a Select-String pattern', async () => {
    const filePath = await writeFixture(tempDir, 'quoted.txt', 'She said "hello"\n');
    const result = await runTerminalCommand({
      workspacePath: tempDir,
      command: `Get-Content ${quotePowerShellLiteral(filePath)} | Select-String '"hello"'`,
    });
    expect(result.exitCode).toBe(0);
    expect(normalizeOutput(result.output)).toContain('She said "hello"');
  }, TEST_TIMEOUT_MS);

  it('handles the ampersand call operator', async () => {
    const scriptPath = await writeFixture(tempDir, path.join('script dir', 'emit.ps1'), `Write-Output 'called via ampersand'\n`);
    const result = await runTerminalCommand({ workspacePath: tempDir, command: `& ${quotePowerShellLiteral(scriptPath)}` });
    expect(result.exitCode).toBe(0);
    expect(normalizeOutput(result.output).trim()).toBe('called via ampersand');
  }, TEST_TIMEOUT_MS);

  it('handles semicolons separating multiple statements', async () => {
    const result = await runTerminalCommand({ workspacePath: tempDir, command: `Write-Output 'first'; Write-Output 'second'` });
    expect(result.exitCode).toBe(0);
    expect(getOutputLines(result.output)).toEqual(['first', 'second']);
  }, TEST_TIMEOUT_MS);

  it('handles pipelines like Get-Content | Select-String', async () => {
    const filePath = await writeFixture(tempDir, 'pipeline.txt', 'alpha\nbeta\ngamma\n');
    const result = await runTerminalCommand({
      workspacePath: tempDir,
      command: `Get-Content ${quotePowerShellLiteral(filePath)} | Select-String beta`,
    });
    expect(result.exitCode).toBe(0);
    expect(normalizeOutput(result.output)).toContain('beta');
  }, TEST_TIMEOUT_MS);

  it('handles here-string usage', async () => {
    const result = await runTerminalCommand({
      workspacePath: tempDir,
      command: `$text = @'\nalpha\nbeta\n'@\nWrite-Output $text`,
    });
    expect(result.exitCode).toBe(0);
    expect(getOutputLines(result.output)).toEqual(['alpha', 'beta']);
  }, TEST_TIMEOUT_MS);

  it('handles multi-line scripts passed as the command', async () => {
    const result = await runTerminalCommand({
      workspacePath: tempDir,
      command: `Write-Output 'line one'\nWrite-Output 'line two'`,
    });
    expect(result.exitCode).toBe(0);
    expect(getOutputLines(result.output)).toEqual(['line one', 'line two']);
  }, TEST_TIMEOUT_MS);

  pythonIt('runs python -c when Python is available', async () => {
    const result = await runTerminalCommand({ workspacePath: tempDir, command: pythonCommand! });
    expect(result.exitCode).toBe(0);
    expect(normalizeOutput(result.output).trim()).toBe('hello');
  }, TEST_TIMEOUT_MS);

  it('preserves Unicode content in files and output', async () => {
    const message = 'こんにちは 🌍 café';
    const filePath = await writeFixture(tempDir, 'unicode.txt', `${message}\n`);
    const result = await runTerminalCommand({ workspacePath: tempDir, command: `Get-Content ${quotePowerShellLiteral(filePath)}` });
    expect(result.exitCode).toBe(0);
    expect(normalizeOutput(result.output)).toContain(message);
  }, TEST_TIMEOUT_MS);

  it('handles very long commands greater than 4000 characters', async () => {
    const longText = 'x'.repeat(4500);
    const result = await runTerminalCommand({ workspacePath: tempDir, command: `Write-Output '${longText}'` });
    expect(result.exitCode).toBe(0);
    expect(normalizeOutput(result.output).trim()).toBe(longText);
  }, TEST_TIMEOUT_MS);

  it('propagates non-zero exit codes', async () => {
    const result = await runTerminalCommand({ workspacePath: tempDir, command: `Write-Error 'boom'; exit 7` });
    expect(result.exitCode).toBe(7);
    expect(normalizeOutput(result.output)).toContain('boom');
  }, TEST_TIMEOUT_MS);
});