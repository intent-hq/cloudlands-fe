import { expect, test } from '../../../../test/ct-test';
import ScreenReferenceBrowserHarness from './__tests__/ScreenReferenceBrowserHarness.svelte';

// Synthetic composition exercises Chromium/ProseMirror ordering, not an OS IME.
test('composition commits before queued references and each reference deletes as one unit', async ({
  mount,
}) => {
  const component = await mount(ScreenReferenceBrowserHarness);
  const editor = component.locator('[contenteditable="true"]');
  await editor.focus();
  await editor.press('End');
  await editor.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    const paragraph = element.querySelector('p');
    if (!paragraph) throw new Error('Missing editor paragraph');
    paragraph.textContent = 'A漢';
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertCompositionText',
        data: '漢',
        isComposing: true,
      }),
    );
  });
  await expect(component).toHaveAttribute('data-composing', 'true');
  await component.update({
    props: {
      events: [
        {
          id: 'speech-one',
          parts: [
            { kind: 'text', text: ' voice ' },
            { kind: 'mark', markId: 'first-mark' },
          ],
        },
        { id: 'speech-two', parts: [{ kind: 'mark', markId: 'second-mark' }] },
      ],
    },
  });
  await component.getByRole('button', { name: 'Flush evidence' }).click();
  await expect(component).toHaveAttribute('data-flush', 'false');
  await expect(component).toHaveAttribute('data-committed', '[]');
  await expect(editor).toHaveText('A漢');
  await editor.dispatchEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true });
  await expect(component).toHaveAttribute('data-submissions', '0');
  await editor.dispatchEvent('compositionend', { data: '漢' });
  await expect(component).toHaveAttribute('data-composing', 'false');
  await expect(component).toHaveAttribute('data-committed', '["speech-one","speech-two"]');
  await expect(component).toHaveAttribute('data-value', 'A漢 voice [[mark:1]][[mark:2]]');
  await expect(editor.locator('[data-screen-reference]')).toHaveCount(2);
  // Inserting the native events must leave focus with the existing owner.
  await expect(component.getByRole('button', { name: 'Flush evidence' })).toBeFocused();
  await editor.focus();
  await editor.press('End');
  await editor.press('Backspace');
  await expect(editor.locator('[data-screen-reference]')).toHaveCount(1);
  await expect(component).toHaveAttribute('data-value', 'A漢 voice [[mark:1]]');
  await editor.press('Enter');
  await expect(component).toHaveAttribute('data-submissions', '1');
});

test('interim speech replaces its decoration and becomes saved text only on a final commit', async ({
  mount,
}) => {
  const component = await mount(ScreenReferenceBrowserHarness);
  const editor = component.locator('[contenteditable="true"]');
  await editor.focus();
  await editor.press('End');
  await component.update({ props: { interim: [{ kind: 'text', text: ' draft words' }] } });
  await expect(editor.locator('[data-screen-interim]')).toHaveText(' draft words…');
  await expect(component).toHaveAttribute('data-value', 'A');
  await expect(editor).toBeFocused();
  await component.update({ props: { interim: [{ kind: 'text', text: ' revised words' }] } });
  await expect(editor.locator('[data-screen-interim]')).toHaveCount(1);
  await expect(editor.locator('[data-screen-interim]')).toHaveText(' revised words…');
  await editor.pressSequentially(' typed');
  await expect(component).toHaveAttribute('data-value', 'A typed');
  await component.update({
    props: {
      interim: [],
      events: [
        {
          id: 'final',
          parts: [
            { kind: 'text', text: ' final words ' },
            { kind: 'mark', markId: 'first-mark' },
          ],
        },
      ],
    },
  });
  await expect(editor.locator('[data-screen-interim]')).toHaveCount(0);
  await expect(component).toHaveAttribute('data-value', 'A typed final words [[mark:1]]');
  await expect(component).toHaveAttribute('data-committed', '["final"]');
  await expect(editor).toBeFocused();
});
