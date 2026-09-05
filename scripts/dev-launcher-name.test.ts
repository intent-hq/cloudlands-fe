import { describe, expect, it, vi } from 'vitest';
import { executeGit, resolveDevLabel, resolveDevName } from './dev-launcher-name.mjs';

const frontendRoot = '/workspace/packages/cloudlands-fe';
const success = (stdout: string) => ({ status: 0, stdout });

describe('resolveDevName', () => {
  it.each([
    [['--name', 'Explicit'], 'Explicit'],
    [['-n', 'Short'], 'Short'],
    [['--name=Equals'], 'Equals'],
  ])('keeps an explicit name above Git resolution', (args, expected) => {
    const runGit = vi.fn();
    expect(resolveDevName(args, frontendRoot, runGit)).toBe(expected);
    expect(runGit).not.toHaveBeenCalled();
  });

  it('uses an attached frontend branch', () => {
    const runGit = vi.fn(() => success('frontend-branch\n'));
    expect(resolveDevName([], frontendRoot, runGit)).toBe('frontend-branch');
    expect(runGit).toHaveBeenCalledOnce();
  });

  it('uses the attached superproject branch for a detached submodule', () => {
    const superprojectRoot = '/workspace';
    const runGit = vi
      .fn()
      .mockReturnValueOnce(success('HEAD\n'))
      .mockReturnValueOnce(success(`${superprojectRoot}\n`))
      .mockReturnValueOnce(success('everything-clean\n'));

    expect(resolveDevName([], frontendRoot, runGit)).toBe('everything-clean');
    expect(runGit.mock.calls).toEqual([
      [['rev-parse', '--abbrev-ref', 'HEAD'], frontendRoot],
      [['rev-parse', '--show-superproject-working-tree'], frontendRoot],
      [['rev-parse', '--abbrev-ref', 'HEAD'], superprojectRoot],
    ]);
  });

  it('returns no name for a detached standalone repository', () => {
    const runGit = vi
      .fn()
      .mockReturnValueOnce(success('HEAD\n'))
      .mockReturnValueOnce(success('\n'));
    expect(resolveDevName([], frontendRoot, runGit)).toBe('');
  });

  it('rejects a detached superproject HEAD', () => {
    const runGit = vi
      .fn()
      .mockReturnValueOnce(success('HEAD\n'))
      .mockReturnValueOnce(success('/workspace\n'))
      .mockReturnValueOnce(success('HEAD\n'));
    expect(resolveDevName([], frontendRoot, runGit)).toBe('');
  });

  it('returns no name for blank frontend branch output', () => {
    const runGit = vi.fn(() => success('  \n'));
    expect(resolveDevName([], frontendRoot, runGit)).toBe('');
    expect(runGit).toHaveBeenCalledOnce();
  });

  it.each([
    [{ status: 1, stdout: 'ignored' }],
    [{ status: null, stdout: 'ignored', error: new Error('timed out') }],
  ])('returns no name when frontend Git fails or times out', (result) => {
    expect(
      resolveDevName(
        [],
        frontendRoot,
        vi.fn(() => result),
      ),
    ).toBe('');
  });
});

describe('executeGit', () => {
  it('runs Git with a timeout and prompts disabled', () => {
    const spawnSync = vi.fn(() => success('branch\n'));
    executeGit(['rev-parse', 'HEAD'], frontendRoot, spawnSync, { PATH: '/bin' });
    expect(spawnSync).toHaveBeenCalledWith(
      'git',
      ['rev-parse', 'HEAD'],
      expect.objectContaining({
        cwd: frontendRoot,
        env: { PATH: '/bin', GIT_TERMINAL_PROMPT: '0' },
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000,
      }),
    );
  });
});

describe('resolveDevLabel', () => {
  it('preserves the existing instance-number and generic fallbacks', () => {
    expect(resolveDevLabel('', '2')).toBe('Dev 2');
    expect(resolveDevLabel('', '')).toBe('Dev');
    expect(resolveDevLabel('everything-clean', '2')).toBe('everything-clean');
  });
});
