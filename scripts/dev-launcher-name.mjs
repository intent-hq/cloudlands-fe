import { spawnSync } from 'child_process';

const GIT_TIMEOUT_MS = 3000;

export function executeGit(args, cwd, spawnSyncImpl = spawnSync, env = process.env) {
  try {
    return spawnSyncImpl('git', args, {
      cwd,
      encoding: 'utf-8',
      env: { ...env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_TIMEOUT_MS,
    });
  } catch {
    return { status: null, stdout: '' };
  }
}

export function parseNameArg(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name' || args[i] === '-n') {
      return args[i + 1] || '';
    }
    if (args[i].startsWith('--name=')) {
      return args[i].slice('--name='.length);
    }
  }
  return '';
}

function readGitOutput(result) {
  if (result?.status !== 0 || typeof result.stdout !== 'string') return '';
  return result.stdout.trim();
}

export function resolveDevName(args, frontendRoot, runGit) {
  const explicitName = parseNameArg(args);
  if (explicitName) return explicitName;

  const frontendBranch = readGitOutput(runGit(['rev-parse', '--abbrev-ref', 'HEAD'], frontendRoot));
  if (frontendBranch && frontendBranch !== 'HEAD') return frontendBranch;
  if (frontendBranch !== 'HEAD') return '';

  const superprojectRoot = readGitOutput(
    runGit(['rev-parse', '--show-superproject-working-tree'], frontendRoot),
  );
  if (!superprojectRoot) return '';

  const superprojectBranch = readGitOutput(
    runGit(['rev-parse', '--abbrev-ref', 'HEAD'], superprojectRoot),
  );
  return superprojectBranch === 'HEAD' ? '' : superprojectBranch;
}

export function resolveDevLabel(devName, instanceNum) {
  return devName || (instanceNum ? `Dev ${instanceNum}` : 'Dev');
}
