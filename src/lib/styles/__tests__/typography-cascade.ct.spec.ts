import { expect, test } from '../../../test/ct-test';
import TypographyCascadeHost from './TypographyCascadeHost.svelte';

test('type roles preserve token defaults and allow weight utility overrides', async ({ mount }) => {
  const component = await mount(TypographyCascadeHost);
  const bare = component.getByTestId('bare');
  const tokenWeight = await bare.evaluate((element) =>
    getComputedStyle(element).getPropertyValue('--text-body-weight').trim(),
  );
  await expect(bare).toHaveCSS('font-weight', tokenWeight);
  await expect(component.getByTestId('medium')).toHaveCSS('font-weight', '500');
  await expect(component.getByTestId('semibold')).toHaveCSS('font-weight', '600');
  for (const id of ['medium', 'semibold']) {
    for (const property of ['font-size', 'line-height', 'letter-spacing']) {
      const expected = await bare.evaluate(
        (element, name) => getComputedStyle(element).getPropertyValue(name),
        property,
      );
      await expect(component.getByTestId(id)).toHaveCSS(property, expected);
    }
  }
});
