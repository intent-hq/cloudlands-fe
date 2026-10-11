import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pnpmInvocation } from './pnpm-launcher.mjs';

const [workspace, script, ...args] = process.argv.slice(2);
if (!['apps/react', 'packages/view-parity'].includes(workspace) || !script) {
  throw new Error('Usage: run-workspace.mjs <apps/react|packages/view-parity> <script> [args...]');
}

const invocation = pnpmInvocation(['--dir', workspace, 'run', script, ...args]);
const child = spawn(invocation.executable, invocation.args, {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  stdio: 'inherit',
  shell: invocation.shell,
  windowsVerbatimArguments: invocation.shell,
});
child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
