import { expect, test } from '../../../../../test/ct-test';
import SlashSkillsPreview from '../slash-skills.preview.svelte';

test('Escape preserves editor focus and keeps literal slash text free of suggestions', async ({
  mount,
  page,
}) => {
  await mount(SlashSkillsPreview, {
    props: {
      value: '/re',
      skills: [{ name: 'research', description: 'Research a topic', location: '/skills/research' }],
    },
  });
  const editor = page.getByRole('textbox', { name: 'Prompt' });
  await expect(page.getByRole('listbox')).toBeVisible();

  await editor.press('Escape');
  await expect(page.getByTestId('slash-skill-menu')).toHaveCount(0);
  await expect(editor).toBeFocused();
  await editor.pressSequentially('search');
  await expect(editor).toHaveText('/research');
  await expect(page.getByTestId('slash-skill-menu')).toHaveCount(0);

  await editor.pressSequentially(' /re');
  await expect(page.getByRole('listbox')).toBeVisible();
  await editor.pressSequentially('pository');
  await expect(page.getByTestId('slash-skill-menu')).toHaveCount(0);
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText('/research /repository');

  for (let index = 0; index < 'pository'.length; index++) {
    await editor.press('Backspace');
  }
  await expect(page.getByRole('listbox')).toBeVisible();
});
