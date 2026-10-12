// Ignored draft: no discovery or execution until separately released.
import {
  test,
  expect,
  openGroups,
  choice,
  toggle,
  button,
  expanded,
  capture,
  sameNode,
  detached,
  owners,
  receipts,
  childAction,
  focusCylinder,
  scrollState,
  bottom,
  wheel,
  grow,
  hittable,
} from '../lib/response-group.mjs';

test('response-group RG5 automatic manual and pending collapse writes use the current owner', async ({
  page,
}, info) => {
  const item = await openGroups(page);
  await expanded(item.primary, false);
  const automaticRoot = await item.primary.root.elementHandle();
  const automaticInitial = (await owners(item)).at(-1);
  expect(automaticInitial.value).toEqual({
    expanded: false,
    searchOwnsExpansion: false,
    override: 'automatic',
  });
  await choice(item.host, 'Primary initial saved expanded', 'true');
  await button(item.host, 'Replace Primary saved owner').click();
  // Original003's automatic effect reads the reactive saved owner through
  // setExpanded(false). Inspect publication before any toggle or unmount.
  const automaticReplacement = await owners(item);
  await info.attach('RG5-automatic-owner-publication.json', {
    body: JSON.stringify({ before: automaticInitial, after: automaticReplacement }, null, 2),
    contentType: 'application/json',
  });
  expect(automaticReplacement.find((owner) => owner.id === automaticInitial.id)).toEqual(
    automaticInitial,
  );
  expect(automaticReplacement.at(-1).id).not.toBe(automaticInitial.id);
  expect(automaticReplacement.at(-1).value).toEqual({
    expanded: false,
    searchOwnsExpansion: false,
    override: 'automatic',
  });
  await sameNode(item.primary.root, automaticRoot);
  await expanded(item.primary, false);
  await capture(page, item, 'RG5-automatic-owner-publication', info);
  await item.primary.trigger.click();
  await expanded(item.primary, true);
  await item.primary.input.fill('retain this child while changing owner');
  const root = await item.primary.root.elementHandle();
  const child = await item.primary.child.elementHandle();
  const initial = (await owners(item)).at(-1);
  expect(initial.value).toMatchObject({ expanded: true, override: 'expanded-completed' });
  await choice(item.host, 'Primary initial saved expanded', 'false');
  await choice(item.host, 'Primary initial saved override', 'collapsed');
  await button(item.host, 'Replace Primary saved owner').click();
  await expanded(item.primary, true);
  await sameNode(item.primary.root, root);
  await sameNode(item.primary.child, child);
  await expect(item.primary.input).toHaveValue('retain this child while changing owner');
  const replaced = await owners(item);
  expect(replaced.find((owner) => owner.id === initial.id)).toEqual(initial);
  expect(replaced.at(-1).id).not.toBe(initial.id);
  expect(replaced.at(-1).value).toMatchObject({ expanded: false, override: 'collapsed' });
  await item.primary.trigger.click();
  await expanded(item.primary, false);
  await item.primary.trigger.click();
  await expanded(item.primary, true);
  const current = (await owners(item)).at(-1);
  expect(current.value).toMatchObject({
    expanded: true,
    searchOwnsExpansion: false,
    override: 'expanded-completed',
  });
  await toggle(item.host, 'Mount Primary', false);
  await detached(root);
  const afterDestroy = await owners(item);
  expect(afterDestroy.find((owner) => owner.id === automaticInitial.id)).toEqual(automaticInitial);
  expect(afterDestroy.find((owner) => owner.id === initial.id)).toEqual(initial);
  expect(afterDestroy.at(-1)).toEqual(current);
  await toggle(item.host, 'Mount Primary', true);
  await expanded(item.primary, true);
  await capture(page, item, 'RG5-current-owner-remount', info);

  // Prepare the next owner before starting the real timer, using the untouched
  // neighbor so the manual primary override cannot change the source branch.
  await choice(item.host, 'Neighbor initial saved expanded', 'true');
  await choice(item.host, 'Neighbor initial saved searchOwnsExpansion', 'true');
  await choice(item.host, 'Neighbor initial saved override', 'collapsed');
  await choice(item.host, 'Neighbor blocks', 'empty');
  await choice(item.host, 'Neighbor isStreaming', 'true');
  await expanded(item.neighbor, true);
  const pendingRoot = await item.neighbor.root.elementHandle();
  const pendingChild = await item.neighbor.child.elementHandle();
  const timerOwner = (await owners(item, 'Neighbor')).at(-1);
  expect(timerOwner.value).toEqual({
    expanded: true,
    searchOwnsExpansion: false,
    override: 'automatic',
  });
  await capture(page, item, 'RG5-before-pending-owner-replacement', info);
  await button(item.neighbor.child, 'Neighbor finish stream').click();
  await button(item.host, 'Replace Neighbor saved owner').click();
  await expanded(item.neighbor, false);
  const afterTimer = await owners(item, 'Neighbor');
  await info.attach('RG5-pending-owner-eventual-collapse.json', {
    body: JSON.stringify({ before: timerOwner, after: afterTimer }, null, 2),
    contentType: 'application/json',
  });
  // If input latency missed the window, this fails: an already-fired timer
  // would have written false to the original owner. Preserve that evidence.
  expect(afterTimer.find((owner) => owner.id === timerOwner.id)).toEqual(timerOwner);
  expect(afterTimer.at(-1).id).not.toBe(timerOwner.id);
  expect(afterTimer.at(-1).value).toEqual({
    expanded: false,
    searchOwnsExpansion: false,
    override: 'automatic',
  });
  await sameNode(item.neighbor.root, pendingRoot);
  await detached(pendingChild);
  const timerReceipts = await receipts(item, info, 'RG5-pending-owner-input');
  const finishes = timerReceipts.callbacks.filter(
    (entry) => entry.kind === 'finish-stream' && entry.label === 'Neighbor',
  );
  expect(finishes).toHaveLength(1);
  expect(finishes[0].event).toMatchObject({ isTrusted: true, type: 'click' });
  await capture(page, item, 'RG5-current-owner-after-collapse', info);
  info.annotations.push({
    type: 'coverage-limit',
    description:
      'Pending replacement checks eventual current-owner writes, not unchanged deadline, transient publication, source-paired parity or StrictMode cleanup.',
  });
});

test('response-group RG7 canonical search requests preserve expansion ownership', async ({
  page,
}, info) => {
  const item = await openGroups(page);
  await button(item.host, 'Primary search expand').click();
  await expanded(item.primary, true);
  expect((await owners(item)).at(-1).value.searchOwnsExpansion).toBe(true);
  await button(item.host, 'Primary search restore').click();
  await expanded(item.primary, false);
  await item.primary.trigger.click();
  await button(item.host, 'Primary search expand').click();
  await button(item.host, 'Primary search restore').click();
  await expanded(item.primary, true);
  expect((await owners(item)).at(-1).value).toMatchObject({
    searchOwnsExpansion: false,
    override: 'expanded-completed',
  });
  await item.primary.trigger.click();
  await item.host
    .getByRole('textbox', { name: 'Primary searchPath', exact: true })
    .fill('current-primary');
  await button(item.host, 'Primary search expand').click();
  await expect(item.primary.root).toHaveAttribute(
    'data-chat-search-disclosure-id',
    'group:current-primary',
  );
  await expanded(item.primary, true);
  await expanded(item.neighbor, false);
  await item.primary.trigger.click(); // User ownership supersedes this search request.
  await button(item.host, 'Primary search restore').click();
  await expanded(item.primary, false);
  await button(item.host, 'Neighbor search expand').click();
  await expanded(item.neighbor, true);
  await expanded(item.primary, false);
  await capture(page, item, 'RG7-independent-search-owner', info);
  await choice(item.host, 'Neighbor isStreaming', 'true');
  await expanded(item.neighbor, false);
  expect((await owners(item, 'Neighbor')).at(-1).value.searchOwnsExpansion).toBe(false);
  await expect(item.neighbor.preview).toHaveCount(1);
  await receipts(item, info, 'RG7-search-requests');
});

test('response-group RG8 closing retires children and re-expansion creates the current lifetime', async ({
  page,
}, info) => {
  const item = await openGroups(page);
  await item.neighbor.trigger.click();
  await item.neighbor.input.fill('independent neighbor value');
  const neighborChild = await item.neighbor.child.elementHandle();
  await item.primary.trigger.click();
  await expanded(item.primary, true);
  await item.primary.input.fill('outgoing primary value');
  const old = await item.primary.child.elementHandle();
  const before = await receipts(item, info, 'RG8-before-close');
  const attached = before.ownership
    .filter((r) => r.kind === 'child-attached' && r.label === 'Primary')
    .at(-1);
  expect(attached).toBeTruthy();
  await capture(page, item, 'RG8-before-close', info);
  await item.primary.trigger.click();
  await expanded(item.primary, false);
  await detached(old);
  await expect(item.primary.input).toHaveCount(0);
  expect(await item.primary.frame.ariaSnapshot()).not.toContain('Primary child edit');
  const after = await receipts(item, info, 'RG8-after-close');
  const released = after.ownership
    .filter((r) => r.kind === 'child-released' && r.node?.objectId === attached.node.objectId)
    .at(-1);
  expect(released).toBeTruthy();
  expect(released.containsFocus).toBe(false);
  // The coordinator permits an explicit evidence gap for the unobservable
  // reduced-motion transient phase; cleanup observations never prove two commits.
  info.annotations.push({
    type: 'closing-evidence',
    description:
      released.detailsInert === true && released.detailsAriaHidden === 'true'
        ? 'Actual cleanup observed inert and aria-hidden before child detachment; separate transient commit ordering remains unverified.'
        : 'Reduced native cleanup did not establish transient inert/hidden ordering; that phase remains unverified.',
  });
  await item.primary.trigger.click();
  await expanded(item.primary, true);
  expect(await item.primary.child.evaluate((node, previous) => node === previous, old)).toBe(false);
  await expect(item.primary.input).toHaveValue('Primary editable value');
  await sameNode(item.neighbor.child, neighborChild);
  await expect(item.neighbor.input).toHaveValue('independent neighbor value');
  await capture(page, item, 'RG8-reexpanded-current-child', info);
  await choice(item.host, 'Primary isStreaming', 'true');
  await expanded(item.primary, false);
  await expect(item.primary.preview).toHaveCount(1);
  await expect(item.primary.child).toHaveCount(1);
  await item.primary.trigger.click();
  await expanded(item.primary, true);
  await expect(item.primary.preview).toHaveCount(0);
  await expect(item.primary.child).toHaveCount(1);
  await capture(page, item, 'RG8-preview-details-current', info);
});

test('response-group RG11 native scroll keys pause following while child editing does not', async ({
  page,
}, info) => {
  const item = await openGroups(page);
  await bottom(item.cylinder);
  await focusCylinder(item);
  const before = await scrollState(item.cylinder);
  await item.cylinder.press('Home');
  await expect
    .poll(async () => (await scrollState(item.cylinder)).top)
    .toBeLessThan(before.top - 5);
  await grow(item);
  await expect
    .poll(async () => {
      const s = await scrollState(item.cylinder);
      return s.total - s.height - s.top;
    })
    .toBeGreaterThan(5);
  await capture(page, item, 'RG11-native-key-paused', info, item.cylinderFrame);
  await focusCylinder(item);
  await item.cylinder.press('End');
  await bottom(item.cylinder);
  await grow(item);
  await bottom(item.cylinder);
  const editor = item.cylinderFrame.getByRole('textbox', {
    name: 'Cylinder child edit',
    exact: true,
  });
  await editor.fill('Editable tail retains follow ownership');
  await editor.press('End');
  await editor.press('Home');
  await expect(editor).toBeFocused();
  expect(await editor.evaluate((node) => node.selectionStart)).toBe(0);
  await bottom(item.cylinder);
  await grow(item);
  await bottom(item.cylinder);
  await expect(editor).toHaveValue('Editable tail retains follow ownership');
  await capture(page, item, 'RG11-editing-preserves-follow', info, item.cylinderFrame);
  await receipts(item, info, 'RG11-native-key-editing');
  info.annotations.push({
    type: 'coverage-limit',
    description:
      'No separate caller control prevents the key default; that branch and touch remain unverified.',
  });
});

test('response-group RG12 inactive and constrained transitions preserve growth behavior', async ({
  page,
}, info) => {
  const item = await openGroups(page);
  await choice(item.host, 'Cylinder isActive', 'false');
  await grow(item);
  await bottom(item.cylinder); // Inactive does not disconnect the source growth observer.
  await capture(page, item, 'RG12-inactive-still-follows', info, item.cylinderFrame);
  const beforeUp = await scrollState(item.cylinder);
  await wheel(page, item.cylinder, -500);
  await expect
    .poll(async () => (await scrollState(item.cylinder)).top)
    .toBeLessThan(beforeUp.top - 5);
  await choice(item.host, 'Cylinder isActive', 'true');
  await grow(item); // Active restores intent; no invented immediate snap assertion.
  await bottom(item.cylinder);
  const constrained = await scrollState(item.cylinder);
  await choice(item.host, 'Cylinder constrained', 'false');
  expect(await item.cylinder.evaluate((node) => node.tabIndex)).toBe(-1);
  await expect
    .poll(async () => (await scrollState(item.cylinder)).height)
    .toBeGreaterThan(constrained.height);
  await choice(item.host, 'Cylinder constrained', 'true');
  expect(await item.cylinder.evaluate((node) => node.tabIndex)).toBe(0);
  await bottom(item.cylinder);
  const old = await item.cylinder.elementHandle();
  await toggle(item.host, 'Mount Cylinder', false);
  await detached(old);
  await toggle(item.host, 'Mount Cylinder', true);
  expect(await item.cylinder.evaluate((node, previous) => node === previous, old)).toBe(false);
  await grow(item);
  await bottom(item.cylinder);
  await capture(page, item, 'RG12-remounted-growth', info, item.cylinderFrame);
  info.annotations.push({
    type: 'coverage-limit',
    description:
      'Visible remount behavior does not establish internal observer/listener counts, pending rAF cancellation or teardown timing.',
  });
});

test('response-group RG13 nearby groups retain current callbacks and usable narrow controls', async ({
  page,
}, info) => {
  const item = await openGroups(page);
  await item.primary.trigger.click();
  await expanded(item.primary, true);
  await item.primary.trigger.press('Tab');
  await expect(item.primary.input).toBeFocused();
  await item.primary.input.fill('primary survives neighbor changes');
  const root = await item.primary.root.elementHandle();
  const child = await item.primary.child.elementHandle();
  await childAction(item, 'Primary', info, 0);
  await button(item.host, 'Replace Primary child callback').click();
  await sameNode(item.primary.root, root);
  await sameNode(item.primary.child, child);
  await childAction(item, 'Primary', info, 1);
  await item.neighbor.trigger.click();
  await expanded(item.neighbor, true);
  const primaryId = await item.primary.trigger.getAttribute('aria-controls');
  expect(await item.neighbor.trigger.getAttribute('aria-controls')).not.toBe(primaryId);
  await item.neighbor.trigger.click();
  await button(item.host, 'Remount Neighbor').click();
  await sameNode(item.primary.root, root);
  await sameNode(item.primary.child, child);
  await expect(item.primary.input).toHaveValue('primary survives neighbor changes');
  await choice(item.host, 'Primary headerAdmitted', 'false');
  await expect(item.primary.trigger).toHaveCount(0);
  await sameNode(item.primary.child, child);
  await hittable(item.primary.input, info, 'RG13-hidden-header-child');
  await choice(item.host, 'Primary headerAdmitted', 'true');
  await item.host
    .getByRole('textbox', { name: 'Primary name', exact: true })
    .fill(
      'A long current response group name that must retain accessible disclosure and child controls at narrow width',
    );
  await hittable(item.primary.trigger, info, 'RG13-narrow-disclosure');
  await item.primary.trigger.click();
  await expanded(item.primary, false);
  await item.primary.trigger.press('Space');
  await expanded(item.primary, true);
  await hittable(button(item.primary.child, 'Primary child action'), info, 'RG13-narrow-action');
  await capture(page, item, 'RG13-narrow-current-groups', info);
});
