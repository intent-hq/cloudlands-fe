import { expect, test } from '../../../test/ct-test';
import AddRemoteSetupModal from '../workspace/initializer/AddRemoteSetupModal.svelte';

for (const mode of ['Key File', 'Password'] as const) {
  test(`remote ${mode} field is labeled and saves only its selected credential`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 600 });
    let saved: Record<string, unknown> | undefined;
    await mount(AddRemoteSetupModal, {
      props: {
        isOpen: true,
        initialSetup: {
          name: 'Team server',
          host: 'dev.example.com',
          port: 22,
          username: 'developer',
          workspacePath: '/srv/project',
          branch: 'main',
        },
        onclose: () => {},
        onsave: (value) => {
          saved = value;
        },
      },
    });
    await page.getByRole('radio', { name: mode, exact: true }).click();
    const field = page.getByLabel(mode, { exact: true }).filter({ visible: true });
    await field.fill(mode === 'Key File' ? '/fixture/id_ed25519' : 'fixture-only-password');
    const save = page.getByRole('button', { name: 'Add Setup', exact: true });
    await expect(save).toBeEnabled();
    await expect(save).toBeInViewport();
    expect(
      await page.getByRole('dialog').evaluate((node) => node.scrollWidth - node.clientWidth),
    ).toBeLessThanOrEqual(1);
    await save.click();
    await expect.poll(() => saved?.host).toBe('dev.example.com');
    expect(saved?.transport).toBe('ssh');
    expect(saved?.useAgent).toBe(false);
    expect(saved?.keyPath).toBe(mode === 'Key File' ? '/fixture/id_ed25519' : undefined);
    expect(saved?.password).toBe(mode === 'Password' ? 'fixture-only-password' : undefined);
  });
}
