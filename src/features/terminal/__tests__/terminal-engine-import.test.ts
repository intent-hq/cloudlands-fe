import { expect, it, vi } from 'vitest';

// Runtime poison modules prove that importing the shared engine cannot initialize
// the source app, its Store, its IPC transport, or its history singleton.
vi.mock('$store/renderer/store', () => {
  throw new Error('Source Store imported');
});
vi.mock('$lib/client', () => {
  throw new Error('Source app client imported');
});
vi.mock('$shared/generated/ipc-client', () => {
  throw new Error('Source IPC imported');
});
vi.mock('../terminal-history-tracker', () => {
  throw new Error('Source history imported');
});
vi.mock('svelte/store', () => {
  throw new Error('Svelte store imported');
});

it('loads the shared terminal engine without source application side effects', async () => {
  await expect(import('../TerminalEngine')).resolves.toHaveProperty(
    'TerminalEngine',
    expect.any(Function),
  );
});
