// @verify-changed-triggers: e2e/build-smoke-helpers.ts, e2e/mock-acp-agent.js
import { readFileSync, rmSync, mkdtempSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { getSmokeWorkspace, setMockAgentBehavior } from '../e2e/build-smoke-helpers';

it('passes the separate parent/child fixture through the file actually read by daemon agents', () => {
  const behavior = {
    response: 'PARENT_ONLY',
    delegate: { name: 'Implementor', prompt: 'CHILD_REQUEST: implement' },
    child: { response: 'CHILD_ONLY', files: { 'child-output.txt': 'child result' } },
  };
  const env = setMockAgentBehavior(behavior);
  try {
    expect(JSON.parse(readFileSync(env.MOCK_AGENT_BEHAVIOR_FILE, 'utf8'))).toEqual({
      files: {},
      ...behavior,
    });
    expect(JSON.parse(env.MOCK_AGENT_BEHAVIOR)).toEqual({ files: {}, ...behavior });
  } finally {
    rmSync(env.MOCK_AGENT_BEHAVIOR_FILE);
  }
});

it('records only actual worktrees inside the fixture root and rejects sibling or symlink escapes', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'smoke-worktree-control-'));
  const root = join(temp, 'home/intent/workspaces');
  const worktree = join(root, 'child/repo');
  mkdirSync(worktree, { recursive: true });
  mkdirSync(join(temp, 'e2e-reports/build-smoke'), { recursive: true });
  const outside = join(temp, 'outside');
  mkdirSync(outside);
  symlinkSync(outside, join(root, 'escape'));
  vi.stubEnv('BUILD_SMOKE_WORKSPACES_ROOT', root);
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(temp);
  const evaluate = vi.fn();
  const page = { evaluate } as unknown as Page;
  try {
    evaluate.mockResolvedValue({ id: 'child', worktreePath: worktree });
    await expect(getSmokeWorkspace(page, 'child')).resolves.toMatchObject({
      worktreePath: worktree,
    });
    const receipt = join(temp, 'e2e-reports/build-smoke/worktree-identities.jsonl');
    const accepted = readFileSync(receipt, 'utf8');
    expect(JSON.parse(accepted)).toEqual({ id: 'child', root, actual: worktree });
    for (const rejected of [root, outside, join(root, 'escape')]) {
      evaluate.mockResolvedValue({ id: 'child', worktreePath: rejected });
      await expect(getSmokeWorkspace(page, 'child')).rejects.toThrow(
        'Workspace escaped fixture root',
      );
      expect(readFileSync(receipt, 'utf8')).toBe(accepted);
    }
  } finally {
    cwd.mockRestore();
    vi.unstubAllEnvs();
    rmSync(temp, { recursive: true, force: true });
  }
});
