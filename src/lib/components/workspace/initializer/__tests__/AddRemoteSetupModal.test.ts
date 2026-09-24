/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { expect, it, vi } from 'vitest';
import { warmImport } from '../../../../../test/warm-import';

warmImport(() => import('../AddRemoteSetupModal.svelte'));

it('switches transport exclusively, resets the draft, and saves the selected transport', async () => {
  const AddRemoteSetupModal = (await import('../AddRemoteSetupModal.svelte')).default;
  const onsave = vi.fn();
  const onclose = vi.fn();
  render(AddRemoteSetupModal, {
    props: {
      isOpen: true,
      inline: true,
      initialSetup: {
        name: 'SSH server',
        host: 'dev.example.com',
        username: 'developer',
        workspacePath: '/srv/project',
      },
      onsave,
      onclose,
    },
  });
  const ssh = screen.getByRole('button', { name: 'SSH', exact: true });
  const websocket = screen.getByRole('button', { name: 'WebSocket', exact: true });
  const save = screen.getByRole('button', { name: 'Add Setup' }) as HTMLButtonElement;
  expect(ssh.getAttribute('aria-pressed')).toBe('true');
  expect(websocket.getAttribute('aria-pressed')).toBe('false');
  expect(save.disabled).toBe(false);

  await fireEvent.click(websocket);
  expect(ssh.getAttribute('aria-pressed')).toBe('false');
  expect(websocket.getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByLabelText('Host *')).toBeNull();
  expect((screen.getByLabelText('Setup Name *') as HTMLInputElement).value).toBe('');
  expect(save.disabled).toBe(true);
  await fireEvent.click(save);
  expect(onsave).not.toHaveBeenCalled();

  for (const [label, value] of [
    ['Setup Name *', 'WebSocket server'],
    ['WebSocket URL *', 'wss://dev.example.com/ws'],
    ['Username *', 'developer'],
    ['Repository Path *', '/srv/project'],
  ]) {
    await fireEvent.input(screen.getByLabelText(label), { target: { value } });
  }
  await fireEvent.click(websocket);
  expect(websocket.getAttribute('aria-pressed')).toBe('true');
  expect(save.disabled).toBe(false);
  await fireEvent.click(save);
  expect(onsave).toHaveBeenCalledExactlyOnceWith({
    id: expect.any(String),
    name: 'WebSocket server',
    transport: 'websocket',
    wsUrl: 'wss://dev.example.com/ws',
    host: '',
    port: 0,
    username: 'developer',
    workspacePath: '/srv/project',
    branch: 'main',
    useAgent: true,
    keyPath: undefined,
    password: undefined,
  });
  expect(onclose).toHaveBeenCalledOnce();
});
