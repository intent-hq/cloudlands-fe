// @vitest-environment node
import path from 'node:path';
import { RuleTester } from 'eslint';
import { describe, expect, it } from 'vitest';
import rule from './no-raw-mouse-wheel-in-ct.js';

const filename = path.resolve('src/lib/components/example/example.ct.spec.ts');
const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

const error = (line) => ({ messageId: 'rawMouseWheel', line });

const inTest = (body) => `
test('scrolls the list', async ({ mount, page }) => {
${body}
});`;

describe('no-raw-mouse-wheel-in-ct guidance', () => {
  it('explains the dropped wheel, names the helper, and cites the incidents', () => {
    const message = rule.meta.messages.rawMouseWheel;
    expect(message).toContain('compositor');
    expect(message).toContain('await wheelUntilScrolled(scroller, { deltaY })');
    expect(message).toContain('cloudlands-fe#3733');
    expect(message).toContain('intent-hq/intent#7255');
    expect(message).toContain('disable this rule on that line with a reason');
  });
});

tester.run('no-raw-mouse-wheel-in-ct', rule, {
  valid: [
    {
      name: 'the shared helper',
      filename,
      code: inTest(`
  await wheelUntilScrolled(list, { deltaY: 600 });
  await expect(list.getByRole('option').last()).toBeInViewport();`),
    },
    {
      name: 'other mouse input',
      filename,
      code: inTest(`
  await page.mouse.move(10, 10);
  await page.mouse.click(10, 10);`),
    },
    {
      name: 'a wheel method that is not on a mouse',
      filename,
      code: inTest(`
  await zoom.wheel(0, 100);
  await page.wheel(0, 100);`),
    },
    {
      name: 'other methods on an aliased mouse, and an unrelated wheel name',
      filename,
      code: inTest(`
  const m = page.mouse;
  await m.move(10, 10);
  const wheel = getWheel();
  await wheel(0, 100);`),
    },
    {
      name: 'a property read is not a call',
      filename,
      code: inTest(`
  const send = typeof page.mouse.wheel;`),
    },
    {
      name: 'files other than component specs',
      filename: path.resolve('src/test/ct-wheel.ts'),
      code: inTest(`
  await page.mouse.wheel(0, 600);`),
    },
    {
      name: 'Playwright e2e specs',
      filename: path.resolve('e2e/chat.spec.ts'),
      code: inTest(`
  await page.mouse.wheel(0, 600);`),
    },
  ],
  invalid: [
    {
      name: 'a raw page wheel',
      filename,
      code: inTest(`
  await list.hover();
  await page.mouse.wheel(0, 600);
  await expect.poll(() => list.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);`),
      errors: [error(5)],
    },
    {
      name: 'a resend loop written by hand',
      filename,
      code: inTest(`
  await expect(async () => {
    await region.hover();
    await page.mouse.wheel(0, 300);
    await expect.poll(() => region.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  }).toPass();`),
      errors: [error(6)],
    },
    {
      name: 'other receivers, including a destructured mouse',
      filename,
      code: inTest(`
  await this.page.mouse.wheel(0, 100);
  await host.page().mouse.wheel(100, 0);
  const { mouse } = page;
  await mouse.wheel(0, -100);`),
      errors: [error(4), error(5), error(7)],
    },
    {
      name: 'computed and optional access',
      filename,
      code: inTest(`
  await page.mouse['wheel'](0, 100);
  await page.mouse?.wheel(0, 100);`),
      errors: [error(4), error(5)],
    },
    {
      name: 'indirect calls and a template-literal key',
      filename,
      code: inTest(`
  await page.mouse.wheel.call(page.mouse, 0, 100);
  await page.mouse.wheel.apply(page.mouse, [0, 100]);
  const later = page.mouse.wheel.bind(page.mouse);
  await page.mouse[\`wheel\`](0, 100);`),
      errors: [error(4), error(5), error(6), error(7)],
    },
    {
      name: 'a mouse or wheel saved to another name',
      filename,
      code: inTest(`
  const m = page.mouse;
  await m.wheel(0, 100);
  const { wheel } = page.mouse;
  await wheel(0, 100);
  const send = page.mouse.wheel;
  await send(0, 100);
  const { mouse: pointer } = page;
  await pointer.wheel(0, 100);`),
      errors: [error(5), error(7), error(9), error(11)],
    },
  ],
});
