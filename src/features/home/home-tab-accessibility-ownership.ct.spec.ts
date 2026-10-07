import { expect, test } from '../../test/ct-test';
import Preview from './home.preview.svelte';
import LifecycleHarness from './home-ownership-lifecycle-harness.svelte';

declare global {
  interface Window {
    __homeTabOwnershipGate: {
      held: { view: string; node: HTMLElement; animation: Animation }[];
      initial: HTMLElement | null;
      outgoing: HTMLElement | null;
      release: () => void;
      restore: () => void;
    };
    __homeDeparture: {
      pane: HTMLElement;
      observed: {
        connected: boolean;
        inert: boolean;
        ariaHidden: string | null;
        focusAccepted: boolean;
      }[];
      held: Animation[];
      restore: () => void;
    };
  }
}

test('Home departure revokes ownership and reentry restores the same pane', async ({
  mount,
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const component = await mount(LifecycleHarness);
  const toggle = component.getByRole('button', { name: 'Toggle Home', exact: true });
  const tabs = component.locator('.home-tabs');
  await expect(tabs.getByRole('tab')).toHaveCount(3);
  await expect
    .poll(() =>
      page.evaluate(() =>
        document
          .querySelector('[data-home-page]')!
          .getAnimations({ subtree: true })
          .every((animation) => animation.playState === 'finished'),
      ),
    )
    .toBe(true);

  await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>('[data-home-view="workspaces"]')!;
    const original = Element.prototype.animate;
    const held: Animation[] = [];
    const observed: typeof window.__homeDeparture.observed = [];
    const record = () => {
      const tab = pane.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!;
      tab.focus();
      observed.push({
        connected: pane.isConnected,
        inert: pane.inert,
        ariaHidden: pane.getAttribute('aria-hidden'),
        focusAccepted: document.activeElement === tab,
      });
    };
    pane.addEventListener('outrostart', record);
    Element.prototype.animate = function (keyframes, options) {
      const animation = original.call(this, keyframes, options);
      const duration = typeof options === 'number' ? options : options?.duration;
      // Keep the real outer outro present after observing its real start event.
      // Do not condition the hold on inert: the regression incorrectly clears it.
      if (this === pane && observed.length > 0 && typeof duration === 'number' && duration > 0) {
        animation.pause();
        held.push(animation);
      }
      return animation;
    };
    window.__homeDeparture = {
      pane,
      observed,
      held,
      restore: () => {
        Element.prototype.animate = original;
        pane.removeEventListener('outrostart', record);
        for (const animation of held) animation.play();
      },
    };
  });
  try {
    await toggle.click();
    await expect.poll(() => page.evaluate(() => window.__homeDeparture.observed.length)).toBe(1);
    const departure = await page.evaluate(() => ({
      observed: window.__homeDeparture.observed,
      held: window.__homeDeparture.held.length,
      connected: window.__homeDeparture.pane.isConnected,
    }));
    await testInfo.attach('outer-home-departure', {
      body: JSON.stringify(departure, null, 2),
      contentType: 'application/json',
    });
    expect(departure.observed).toEqual([
      { connected: true, inert: true, ariaHidden: 'true', focusAccepted: false },
    ]);
    expect(departure.held).toBeGreaterThan(0);
    expect(departure.connected).toBe(true);
    expect(await tabs.getByRole('tab').count()).toBe(0);
    await expect(toggle).toBeFocused();

    await toggle.click();
    await expect(tabs.getByRole('tab')).toHaveCount(3);
    expect(
      await page.evaluate(
        () =>
          document.querySelector('[data-home-view="workspaces"]') === window.__homeDeparture.pane,
      ),
    ).toBe(true);
    await expect(toggle).toBeFocused();
    await page.evaluate(() => window.__homeDeparture.restore());
    await tabs.getByRole('tab', { name: 'Pull requests', exact: true }).click();
    await expect(tabs.getByRole('tab', { name: 'Pull requests', exact: true })).toBeFocused();
    await expect(tabs.getByRole('tab', { selected: true })).toHaveCount(1);
  } finally {
    await page.evaluate(() => window.__homeDeparture.restore());
  }
});

for (const { reducedMotion, holdOutgoing, label } of [
  { reducedMotion: 'no-preference', holdOutgoing: true, label: 'held motion' },
  { reducedMotion: 'no-preference', holdOutgoing: false, label: 'ordinary motion' },
  { reducedMotion: 'reduce', holdOutgoing: true, label: 'reduced motion' },
] as const) {
  test(`Home exposes one active tab set before outgoing animation starts (${label})`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion });
    const component = await mount(Preview);
    await expect(component.locator('[data-home-view="workspaces"]')).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          document
            .querySelector('[data-home-page]')!
            .getAnimations({ subtree: true })
            .every((animation) => animation.playState === 'finished'),
        ),
      )
      .toBe(true);

    await page.evaluate((holdOutgoing) => {
      const original = Element.prototype.animate;
      const held: { view: string; node: HTMLElement; animation: Animation }[] = [];
      Element.prototype.animate = function (keyframes, options) {
        const animation = original.call(this, keyframes, options);
        const duration = typeof options === 'number' ? options : options?.duration;
        // Hold only Svelte's outgoing, zero-duration scheduling animation.
        // The real outgoing pane and new pane remain mounted, with no altered
        // visibility, input state, event handler, selector, or motion duration.
        if (
          holdOutgoing &&
          this instanceof HTMLElement &&
          this === window.__homeTabOwnershipGate.outgoing &&
          this.inert &&
          Array.isArray(keyframes) &&
          keyframes.length === 0 &&
          duration === 0
        ) {
          animation.pause();
          held.push({ view: this.dataset.homeView!, node: this, animation });
        }
        return animation;
      };
      window.__homeTabOwnershipGate = {
        held,
        initial: document.querySelector<HTMLElement>('[data-home-view="workspaces"]'),
        outgoing: null,
        release: () => {
          for (const item of held) item.animation.play();
        },
        restore: () => {
          Element.prototype.animate = original;
          for (const item of held) item.animation.play();
        },
      };
    }, holdOutgoing);

    const tabs = component.locator('.home-tabs');
    const captureOutgoing = () =>
      page.evaluate(() => {
        window.__homeTabOwnershipGate.outgoing =
          Array.from(document.querySelectorAll<HTMLElement>('[data-home-view]')).find(
            (pane) => !pane.inert,
          ) ?? null;
        if (!window.__homeTabOwnershipGate.outgoing) throw new Error('No active Home pane');
      });
    const assertTabs = async (name: string) => {
      expect(await tabs.getByRole('tab').count()).toBe(3);
      for (const title of ['Workspaces', 'Pull requests', 'Linear issues']) {
        expect(await tabs.getByRole('tab', { name: new RegExp(`^${title}`) }).count()).toBe(1);
      }
      await expect(tabs.getByRole('tab', { selected: true })).toHaveCount(1);
      const selected = tabs.getByRole('tab', { name: new RegExp(`^${name}`) });
      await expect(selected).toHaveAttribute('aria-selected', 'true');
      await expect(selected).toHaveAttribute('tabindex', '0');
      expect(
        await tabs
          .getByRole('tab')
          .evaluateAll(
            (nodes) => nodes.filter((node) => node.getAttribute('tabindex') === '0').length,
          ),
      ).toBe(1);
    };

    try {
      for (const [name, view] of [
        ['Pull requests', 'prs'],
        ['Workspaces', 'workspaces'],
        ['Pull requests', 'prs'],
        ['Linear issues', 'linear'],
        ['Workspaces', 'workspaces'],
      ]) {
        await page.evaluate(() => {
          window.__homeTabOwnershipGate.outgoing =
            Array.from(document.querySelectorAll<HTMLElement>('[data-home-view]')).find(
              (pane) => !pane.inert,
            ) ?? null;
          if (!window.__homeTabOwnershipGate.outgoing) throw new Error('No active Home pane');
        });
        await component
          .locator('.home-tabs')
          .getByRole('tab', { name: new RegExp(`^${name}`) })
          .click();
        await expect(component.locator(`[data-home-view="${view}"]`)).toBeVisible();
        // Visibility alone also matches a retained outgoing pane on reversal.
        // Selection identifies the committed destination without releasing its outro.
        await expect(tabs.getByRole('tab', { name: new RegExp(`^${name}`) })).toHaveAttribute(
          'aria-selected',
          'true',
        );
        const ownership = await page.evaluate(() => ({
          outgoingHeld: window.__homeTabOwnershipGate.held.some(
            (item) =>
              item.node === window.__homeTabOwnershipGate.outgoing &&
              item.animation.playState === 'paused',
          ),
          resumedInitial:
            document.querySelector('[data-home-view="workspaces"]') ===
            window.__homeTabOwnershipGate.initial,
          held: window.__homeTabOwnershipGate.held.map((item) => item.view),
          panes: Array.from(document.querySelectorAll<HTMLElement>('[data-home-view]')).map(
            (pane) => ({
              view: pane.dataset.homeView,
              inert: pane.inert,
              ariaHidden: pane.getAttribute('aria-hidden'),
            }),
          ),
        }));
        const workspaces = component
          .locator('.home-tabs')
          .getByRole('tab', { name: /^Workspaces/ });
        const accessibleCount = await workspaces.count();
        await testInfo.attach(`tab-ownership-${view}`, {
          body: JSON.stringify({ ownership, accessibleCount }, null, 2),
          contentType: 'application/json',
        });
        if (reducedMotion === 'no-preference' && holdOutgoing) {
          expect(ownership.held.length).toBeGreaterThan(0);
          expect(ownership.outgoingHeld).toBe(true);
          if (view === 'workspaces') expect(ownership.resumedInitial).toBe(true);
          expect(ownership.panes.length).toBeGreaterThan(1);
        } else expect(ownership.held).toHaveLength(0);
        expect(accessibleCount).toBe(1);
        await assertTabs(name);
        for (const pane of ownership.panes) {
          if (pane.view !== view) {
            expect(pane.inert).toBe(true);
            expect(pane.ariaHidden).toBe('true');
          }
        }
        await expect(
          component.locator('.home-tabs').getByRole('tab', { name: new RegExp(`^${name}`) }),
        ).toBeFocused();
      }
      // Keyboard reversal must restore focus even when Svelte resumes a pane
      // whose mount action does not run again.
      await captureOutgoing();
      await page.keyboard.press('ArrowRight');
      await assertTabs('Pull requests');
      await expect(tabs.getByRole('tab', { name: /^Pull requests/ })).toBeFocused();
      await captureOutgoing();
      await page.keyboard.press('ArrowLeft');
      await assertTabs('Workspaces');
      await expect(tabs.getByRole('tab', { name: /^Workspaces/ })).toBeFocused();

      // Completing old outros must not revoke or move the current owner's focus.
      await page.evaluate(() => window.__homeTabOwnershipGate.release());
      await expect(component.locator('[data-home-view]')).toHaveCount(1);
      await assertTabs('Workspaces');
      await expect(tabs.getByRole('tab', { name: /^Workspaces/ })).toBeFocused();

      const sidebar = component.getByRole('navigation', { name: 'Home', exact: true });
      const assistant = sidebar.getByRole('tab', { name: 'Assistant', exact: true });
      const workspacesDestination = sidebar.getByRole('tab', { name: 'Workspaces', exact: true });
      await captureOutgoing();
      await assistant.click();
      await expect(component.locator('[data-home-destination="assistant"]')).toBeVisible();
      expect(await tabs.getByRole('tab').count()).toBe(0);
      await expect(assistant).toBeFocused();
      if (reducedMotion === 'no-preference' && holdOutgoing) {
        await expect(component.locator('[data-home-view="workspaces"]')).toHaveCount(1);
        await expect(component.locator('[data-home-view="workspaces"]')).toHaveAttribute(
          'aria-hidden',
          'true',
        );
      }
      await workspacesDestination.click();
      await expect(component.locator('[data-home-destination="assistant"]')).toBeHidden();
      await assertTabs('Workspaces');
      await expect(workspacesDestination).toBeFocused();
      await page.evaluate(() => window.__homeTabOwnershipGate.restore());
      await expect(component.locator('[data-home-view]')).toHaveCount(1);
      await assertTabs('Workspaces');
      await expect(workspacesDestination).toBeFocused();
      await testInfo.attach('home-ownership-settled', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    } finally {
      await page.evaluate(() => window.__homeTabOwnershipGate.restore());
    }
  });
}
