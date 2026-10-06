import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, expect, it } from 'vitest';
import Host from './SetupScriptProvenanceHost.svelte';

afterEach(cleanup);
it('keeps an explicit custom script custom when committed content happens to match', async () => {
  render(Host);
  await waitFor(() =>
    expect(screen.getByLabelText('script content').textContent).toBe('echo identical'),
  );
  expect(screen.getByLabelText('script provenance').textContent).toBe('custom');
});
