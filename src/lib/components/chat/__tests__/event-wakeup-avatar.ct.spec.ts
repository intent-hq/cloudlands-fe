import { expect, test } from '@playwright/experimental-ct-svelte';
import EventWakeupAvatarHost from './EventWakeupAvatarHost.svelte';

test('keeps named standard wake-up avatars optically centered at every required geometry', async ({
  mount,
}) => {
  const component = await mount(EventWakeupAvatarHost);

  for (const theme of ['light', 'dark'] as const) {
    for (const width of [280, 480]) {
      for (const zoom of [1, 2]) {
        await component.update({ props: { theme, width, zoom } });
        const value = await component.evaluate((root) => {
          const rect = (node: Element) => {
            const box = node.getBoundingClientRect();
            return {
              top: box.top,
              left: box.left,
              right: box.right,
              bottom: box.bottom,
              width: box.width,
              height: box.height,
              centerX: (box.left + box.right) / 2,
              centerY: (box.top + box.bottom) / 2,
            };
          };
          const triggers = [
            ...root.querySelectorAll('[data-testid="inline-agent-avatar-trigger"]'),
          ];
          const row = root.querySelector('[data-testid="event-wakeup-header"]')!;
          const stackHost = root.querySelector('[data-testid="event-wakeup-avatar-stack"]')!;
          const stack = root.querySelector('[data-agent-avatar-stack]')!;
          const summary = root.querySelector('[data-testid="event-wakeup-summary"]')!;
          const avatars = triggers.map((trigger) => {
            const ring = trigger.querySelector('[data-testid="inline-agent-avatar-ring"]')!;
            const surface = trigger.querySelector('[data-agent-avatar-surface]')!;
            const glyph = trigger.querySelector('[data-agent-avatar]')!;
            const glyphStyle = getComputedStyle(glyph);
            return {
              trigger: rect(trigger),
              ring: rect(ring),
              surface: rect(surface),
              glyph: rect(glyph),
              radii: [trigger, ring, surface, glyph].map(
                (node) => getComputedStyle(node).borderRadius,
              ),
              variants: [surface, glyph].map((node) => node.getAttribute('data-avatar-variant')),
              inlineSizes: [surface, glyph].map((node) => ({
                width: (node as HTMLElement).style.width,
                height: (node as HTMLElement).style.height,
              })),
              clipPath: getComputedStyle(surface).clipPath,
              clearSpace: Number.parseFloat(glyphStyle.paddingInlineStart),
              artWidth:
                (glyph as HTMLElement).clientWidth -
                Number.parseFloat(glyphStyle.paddingInlineStart) -
                Number.parseFloat(glyphStyle.paddingInlineEnd),
              lineHeights: [trigger, ring, surface].map(
                (node) => getComputedStyle(node).lineHeight,
              ),
            };
          });
          const overflow = root.querySelector('[data-testid="event-wakeup-avatar-overflow"]')!;
          const overflowStyle = getComputedStyle(overflow);
          return {
            avatars,
            row: rect(row),
            stackHost: rect(stackHost),
            stack: rect(stack),
            summary: rect(summary),
            stackAlign: stack.getAttribute('data-agent-avatar-stack-align'),
            stackJustification: getComputedStyle(stack).justifyContent,
            overflow: rect(overflow),
            overflowRadius: overflowStyle.borderRadius,
            overflowBackground: overflowStyle.backgroundColor,
            overflowBorder: overflowStyle.borderTopWidth,
            overflowShadow: overflowStyle.boxShadow,
            overflowAlignment: [overflowStyle.alignItems, overflowStyle.justifyContent],
            overflowText: overflow.textContent?.trim(),
            devicePixelRatio: window.devicePixelRatio,
          };
        });

        expect(value.avatars).toHaveLength(5);
        expect(value.stackAlign).toBe('start');
        expect(value.stackJustification).toBe('flex-start');
        expect(value.stack.left).toBeCloseTo(value.stackHost.left, 1);
        expect(value.avatars[0].trigger.left).toBeCloseTo(value.stackHost.left, 1);
        expect(value.summary.left - value.stackHost.right).toBeCloseTo(8 * zoom, 1);
        for (const avatar of value.avatars) {
          expect(avatar.variants).toEqual(['standard', 'standard']);
          expect(avatar.inlineSizes).toEqual([
            { width: '', height: '' },
            { width: '', height: '' },
          ]);
          for (const box of [avatar.trigger, avatar.ring, avatar.surface, avatar.glyph]) {
            expect(box.width).toBeCloseTo(20 * zoom, 1);
            expect(box.height).toBeCloseTo(20 * zoom, 1);
            expect(
              Math.abs(box.centerX - avatar.surface.centerX) * value.devicePixelRatio,
            ).toBeLessThanOrEqual(0.5);
            expect(
              Math.abs(box.centerY - avatar.surface.centerY) * value.devicePixelRatio,
            ).toBeLessThanOrEqual(0.5);
          }
          expect(new Set(avatar.radii)).toEqual(new Set([`${6}px`]));
          expect(avatar.clipPath).toContain('6px');
          expect(avatar.clearSpace).toBe(2);
          expect(avatar.artWidth).toBe(16);
          expect(avatar.lineHeights).toEqual(['0px', '0px', '0px']);
          expect(
            Math.abs(avatar.trigger.centerY - value.row.centerY) * value.devicePixelRatio,
          ).toBeLessThanOrEqual(0.5);
        }
        for (let index = 1; index < value.avatars.length; index += 1) {
          expect(
            value.avatars[index - 1].trigger.right - value.avatars[index].trigger.left,
          ).toBeCloseTo(5 * zoom, 1);
        }
        expect(value.avatars.at(-1)!.trigger.right - value.overflow.left).toBeCloseTo(5 * zoom, 1);
        expect(value.overflow.width).toBeGreaterThan(20 * zoom);
        expect(value.overflow.width).toBeLessThanOrEqual(32 * zoom);
        expect(value.overflow.height).toBeCloseTo(20 * zoom, 1);
        expect(Number.parseFloat(value.overflowRadius)).toBeGreaterThan(0);
        expect(value.overflowBackground).not.toBe('rgba(0, 0, 0, 0)');
        expect(value.overflowBorder).toBe('0px');
        expect(value.overflowShadow).toBe('none');
        expect(value.overflowAlignment).toEqual(['center', 'center']);
        expect(
          Math.abs(value.overflow.centerY - value.avatars.at(-1)!.surface.centerY) *
            value.devicePixelRatio,
        ).toBeLessThanOrEqual(0.5);
        expect(value.overflowText).toBe('+1');
      }
    }
  }
});
