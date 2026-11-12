import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process';

export function spawnWorkflowBash(args: string[], options: SpawnSyncOptionsWithStringEncoding) {
  const env = { ...(options.env ?? process.env) };
  // No-startup flags alone do not suppress BASH_ENV in non-interactive Bash.
  delete env.BASH_ENV;
  delete env.ENV;
  return spawnSync('bash', ['--noprofile', '--norc', ...args], { ...options, env });
}
