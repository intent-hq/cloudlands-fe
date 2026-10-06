import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import Host from './SetupScriptProvenanceHost.svelte';
import ReopenHost from './SetupScriptReopenHost.svelte';
vi.mock('$lib/components/editor/CodeEditor.svelte', async () => ({
  default: (await import('./SetupScriptInputMock.svelte')).default,
}));

afterEach(cleanup);
it('keeps an explicit custom script custom when committed content happens to match', async () => {
  render(Host);
  await waitFor(() =>
    expect(screen.getByLabelText('script content').textContent).toBe('echo identical'),
  );
  expect(screen.getByLabelText('script provenance').textContent).toBe('custom');
});

it.each(['', '  \n\t'])(
  'preserves explicit %j through clear, Done, reopen, Done and create',
  async (blank) => {
    render(ReopenHost);
    const editor = await screen.findByRole('textbox', { name: 'setup editor' });
    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toBe('echo committed setup'));
    await fireEvent.input(editor, { target: { value: blank } });
    await fireEvent.click(await screen.findByRole('button', { name: 'Save & Done' }));
    await waitFor(() =>
      expect(screen.getByLabelText('committed script').textContent).toBe(JSON.stringify(blank)),
    );
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'setup editor' })).toBeNull());
    await fireEvent.click(screen.getByRole('button', { name: 'Reopen setup' }));
    const reopened = await screen.findByRole('textbox', { name: 'setup editor' });
    await waitFor(() => expect((reopened as HTMLTextAreaElement).value).toBe(blank));
    await fireEvent.click(await screen.findByRole('button', { name: 'Done', exact: true }));
    expect(screen.getByLabelText('committed source').textContent).toBe('custom');
    await fireEvent.click(screen.getByRole('button', { name: 'Create', exact: true }));
    expect(screen.getByLabelText('create override').textContent).toBe('cd .');
  },
);
it('still selects committed config for an untouched blank', async () => {
  render(ReopenHost, { props: { untouched: true } });
  const editor = await screen.findByRole('textbox', { name: 'setup editor' });
  await waitFor(() => expect((editor as HTMLTextAreaElement).value).toBe('echo committed setup'));
});

it.each(['', '  \n\t'])('retains an explicit blank %j on a fresh editor mount', async (initial) => {
  render(Host, { props: { initial } });
  await waitFor(() => expect(screen.getByLabelText('script content').textContent).toBe(initial));
  expect(screen.getByLabelText('script provenance').textContent).toBe('custom');
});
