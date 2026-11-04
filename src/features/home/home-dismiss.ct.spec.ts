import { expect, test } from '../../test/ct-test';
import Preview from './home-dismiss.preview.svelte';
import { IPC_CHANNELS } from '$shared/ipc-registry';
const observedReasons = [
  { id: 'workspace:review', revision: 'review-1' },
  { id: 'agent:question', revision: 'question-1' },
];

test('Detailed status grouping moves a dismissed reminder to Waiting and restores new reasons', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  const component = await mount(Preview);
  await component.getByRole('button', { name: 'View options', exact: true }).click();
  await page.getByRole('combobox', { name: 'Group by', exact: true }).click();
  await page.getByRole('option', { name: 'Status', exact: true }).click();
  await page.keyboard.press('Escape');
  const attention = component.getByRole('listbox', { name: 'Needs attention', exact: true });
  const row = component.getByRole('option', { name: 'Review onboarding' });
  await expect(attention.getByRole('option', { name: 'Review onboarding' })).toBeVisible();
  await expect(
    component
      .getByRole('listbox', { name: 'PR mergeable', exact: true })
      .getByRole('option', { name: 'Ready to merge' }),
  ).toBeVisible();
  await row.click();
  await row.focus();
  await page.keyboard.press('Shift+F10');
  const before = await page.evaluate(() => window.__homeDismiss!.snapshot());
  await testInfo.attach('detailed-status-before-dismiss', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.getByRole('menuitem', { name: 'Dismiss for now', exact: true }).click();
  const waiting = component.getByRole('listbox', { name: 'Waiting', exact: true });
  await expect(waiting.getByRole('option', { name: 'Review onboarding' })).toBeVisible();
  await expect(attention.getByRole('option', { name: 'Review onboarding' })).toHaveCount(0);
  await expect(row).toBeFocused();
  await expect(row.locator('[data-home-status]')).toHaveAccessibleName(/Waiting/);
  await expect(component.locator('[data-home-detail]')).toBeVisible();
  const after = await page.evaluate(() => window.__homeDismiss!.snapshot());
  expect(after.displayStatus).toBe(before.displayStatus);
  expect(after.attention).toBe(before.attention);
  expect(after.attentionReminder?.dismissed).toBe(true);
  expect(await page.evaluate(() => window.__homeDismiss!.calls)).toEqual([
    {
      channel: IPC_CHANNELS.BACKEND.REQUEST,
      method: 'workspace.dismissAttention',
      params: { workspaceId: 'dismiss-review', reasons: observedReasons },
    },
  ]);
  await testInfo.attach('detailed-status-after-dismiss', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.evaluate(() => window.__homeDismiss!.addReason());
  await expect(attention.getByRole('option', { name: 'Review onboarding' })).toBeVisible();
  await expect(waiting).toHaveCount(0);
  await expect(row.locator('[data-home-status]')).toHaveAttribute('data-home-status', 'needs-you');
  await expect(attention.getByRole('option', { name: 'Blocked work' })).toBeVisible();
  await expect(attention.getByRole('option', { name: 'Failed work' })).toBeVisible();
  await expect(component.locator('[data-home-detail]')).toBeVisible();
  await testInfo.attach('detailed-status-new-reason', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await testInfo.attach('detailed-status-ledger', {
    body: JSON.stringify(
      await page.evaluate(() => ({
        current: window.__homeDismiss!.snapshot(),
        requests: window.__homeDismiss!.calls,
      })),
      null,
      2,
    ),
    contentType: 'application/json',
  });
});

for (const missing of [false, true]) {
  test(`initial selected workspace automatically resolves after admission (${missing ? 'missing' : 'present'})`, async ({
    mount,
    page,
  }, testInfo) => {
    await mount(Preview, { props: { admissions: true } });
    await page.evaluate(() => {
      window.__homeDismiss!.holdNextOpenReply();
    });
    await page.evaluate((missing) => window.__homeDismiss!.beginBootLoad(missing), missing);
    await expect.poll(() => page.evaluate(() => window.__homeDismiss!.openReplies.length)).toBe(1);
    const before = await page.evaluate(() => window.__homeDismiss!.bootLoadSnapshot());
    expect(before.workspace).toBeNull();
    expect(before.selectedId).toBe('dismiss-review');
    expect(before.openReplies[0].context).toBeNull();
    await page.evaluate(() => window.__homeDismiss!.changePrincipal('person-b'));
    await expect
      .poll(() => page.evaluate(() => window.__homeDismiss!.bootLoadSnapshot().loadState.status))
      .toBe(missing ? 'not-found' : 'ready');
    const admitted = await page.evaluate(() => window.__homeDismiss!.bootLoadSnapshot());
    expect(admitted.principalId).toBe('person-b');
    const acceptedReads = admitted.detailReads.filter((read) => read.principalId === 'person-b');
    if (missing) expect(acceptedReads).toHaveLength(2);
    else expect(acceptedReads.length).toBeGreaterThanOrEqual(1);
    if (missing) {
      expect(admitted.workspace).toBeNull();
      expect(admitted.selectedId).not.toBe('dismiss-review');
      expect(admitted.loadState.error?.kind).toBe('not_found');
    } else {
      expect(admitted.workspace?.setupScript).toBe('detail-for-person-b');
      expect(admitted.selectedId).toBe('dismiss-review');
    }
    await page.evaluate(() => window.__homeDismiss!.releaseOpenReply());
    await expect
      .poll(() => page.evaluate(() => window.__homeDismiss!.openReplies[0].status))
      .toBe('passed');
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const after = await page.evaluate(() => window.__homeDismiss!.bootLoadSnapshot());
    expect(after.loadState.status).toBe(missing ? 'not-found' : 'ready');
    expect(after.workspace?.setupScript).not.toBe(
      'detail-for-' + before.openReplies[0].principalId,
    );
    await testInfo.attach('automatic-admission-recovery-' + (missing ? 'missing' : 'present'), {
      body: JSON.stringify({ before, admitted, after }, null, 2),
      contentType: 'application/json',
    });
    await page.evaluate(() => window.__homeDismiss!.releaseList());
  });
}

test('admission recovery does not reopen a workspace after leaving its tab', async ({
  mount,
  page,
}, testInfo) => {
  await mount(Preview, { props: { admissions: true } });
  await page.evaluate(() => {
    window.__homeDismiss!.holdNextOpenReply();
    window.__homeDismiss!.beginBootLoad();
  });
  await expect.poll(() => page.evaluate(() => window.__homeDismiss!.openReplies.length)).toBe(1);
  await page.evaluate(() => {
    window.__homeDismiss!.leaveSelectedWorkspace();
    window.__homeDismiss!.changePrincipal('person-b');
    window.__homeDismiss!.releaseOpenReply();
  });
  await expect
    .poll(() => page.evaluate(() => window.__homeDismiss!.bootLoadSnapshot().loadState.status))
    .toBe('idle');
  const after = await page.evaluate(() => window.__homeDismiss!.bootLoadSnapshot());
  expect(after.selectedId).not.toBe('dismiss-review');
  expect(after.detailReads.filter((read) => read.principalId === 'person-b')).toHaveLength(0);
  expect(after.workspace).toBeNull();
  await testInfo.attach('admission-after-leaving-proof', {
    body: JSON.stringify(after, null, 2),
    contentType: 'application/json',
  });
  await page.evaluate(() => window.__homeDismiss!.releaseList());
});

test('failed reminder refresh keeps new attention visible and retires pending acknowledgement', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(Preview, { props: { admissions: true } });
  const row = component.getByRole('option', { name: 'Review onboarding' });
  await row.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Dismiss for now', exact: true }).click();
  await expect(row.locator('[data-home-status]')).toHaveAttribute('data-home-status', 'idle');
  await page.evaluate(() => {
    window.__homeDismiss!.stagePendingReminder();
    window.__homeDismiss!.holdNextDetail();
    window.__homeDismiss!.startDetailRead();
  });
  await expect.poll(() => page.evaluate(() => window.__homeDismiss!.detailReads.length)).toBe(1);
  const before = await page.evaluate(() => window.__homeDismiss!.admissionSnapshot());
  expect(before.pendingCreation?.attentionReminder?.dismissed).toBe(true);
  await testInfo.attach('failed-refresh-before', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.evaluate(() => {
    window.__homeDismiss!.failNextDetail();
    window.__homeDismiss!.addReason(false);
    window.__homeDismiss!.invalidate();
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__homeDismiss!.detailReads.some((read) => read.status === 'failed'),
      ),
    )
    .toBe(true);
  await expect(row.locator('[data-home-status]')).toHaveAttribute('data-home-status', 'needs-you');
  const failed = await page.evaluate(() => window.__homeDismiss!.admissionSnapshot());
  expect(failed.workspace.attentionReminder).toBeUndefined();
  expect(failed.pendingCreation?.attentionReminder).toBeUndefined();
  expect(failed.workspace.displayStatus).toBe(before.workspace.displayStatus);
  expect(failed.workspace.attention).toBe(before.workspace.attention);
  expect(failed.workspace.activity).toBe(before.workspace.activity);
  expect(failed.hudCard?.stateKey).toBe('wait');
  expect(failed.tabStatus?.categories.map((item) => item.category)).toContain('review');
  await testInfo.attach('failed-refresh-attention-visible', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.evaluate(() => window.__homeDismiss!.releaseDetail());
  await expect.poll(() => page.evaluate(() => window.__homeDismiss!.detailResults.length)).toBe(1);
  expect(
    await page.evaluate(() => window.__homeDismiss!.snapshot().attentionReminder),
  ).toBeUndefined();
  await page.evaluate(() => window.__homeDismiss!.invalidate());
  await expect
    .poll(() =>
      page.evaluate(() => window.__homeDismiss!.snapshot().attentionReminder?.reasons.length),
    )
    .toBe(3);
  const after = await page.evaluate(() => ({
    state: window.__homeDismiss!.admissionSnapshot(),
    reads: window.__homeDismiss!.detailReads,
    results: window.__homeDismiss!.detailResults,
  }));
  expect(after.state.workspace.attentionReminder?.dismissed).toBe(false);
  await expect(row.locator('[data-home-status]')).toHaveAttribute('data-home-status', 'needs-you');
  await testInfo.attach('failed-refresh-recovery-proof', {
    body: JSON.stringify({ before, failed, after }, null, 2),
    contentType: 'application/json',
  });
});

for (const source of ['detail', 'open', 'list', 'selected-load'] as const) {
  test(`new same-person reminder survives an older ${source} reply`, async ({
    mount,
    page,
  }, testInfo) => {
    const component = await mount(Preview, { props: { admissions: true } });
    const row = component.getByRole('option', { name: 'Review onboarding' });
    await row.focus();
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Dismiss for now', exact: true }).click();
    await expect(row.locator('[data-home-status]')).toHaveAttribute('data-home-status', 'idle');
    const before = await page.evaluate(() => window.__homeDismiss!.admissionSnapshot());
    await page.evaluate((source) => {
      const fixture = window.__homeDismiss!;
      if (source === 'detail') {
        fixture.holdNextDetail();
        fixture.startDetailRead();
      } else if (source === 'list') {
        fixture.holdNextList();
        fixture.refreshAdmission();
      } else {
        fixture.holdNextOpenReply();
        if (source === 'selected-load') {
          fixture.selectWorkspace();
          fixture.startLoadRead();
        } else fixture.startOpenRead();
      }
    }, source);
    await expect
      .poll(() =>
        page.evaluate((source) => {
          const fixture = window.__homeDismiss!;
          if (source === 'list') return fixture.listReads.some((read) => read.status === 'held');
          if (source === 'detail')
            return fixture.detailReads.some((read) => read.status === 'held');
          return fixture.openReplies.some((read) => read.status === 'held');
        }, source),
      )
      .toBe(true);
    const held = await page.evaluate(() => ({
      detail: window.__homeDismiss!.detailReads,
      list: window.__homeDismiss!.listReads,
      open: window.__homeDismiss!.openReplies,
    }));
    await page.evaluate(() => {
      window.__homeDismiss!.addReason(false);
      window.__homeDismiss!.invalidate();
    });
    await expect
      .poll(() =>
        page.evaluate(() => window.__homeDismiss!.snapshot().attentionReminder?.reasons.length),
      )
      .toBe(3);
    const fresh = await page.evaluate(() => window.__homeDismiss!.admissionSnapshot());
    expect(fresh.workspace.attentionReminder?.dismissed).toBe(false);
    await page.evaluate((source) => {
      const fixture = window.__homeDismiss!;
      if (source === 'detail') fixture.releaseDetail();
      else if (source === 'list') fixture.releaseList();
      else fixture.releaseOpenReply();
    }, source);
    if (source === 'detail')
      await expect
        .poll(() => page.evaluate(() => window.__homeDismiss!.detailResults.length))
        .toBe(1);
    else if (source === 'open') {
      await expect
        .poll(() => page.evaluate(() => window.__homeDismiss!.openResults.length))
        .toBe(1);
      expect(await page.evaluate(() => window.__homeDismiss!.openResults[0].result.ok)).toBe(false);
    } else if (source === 'list') {
      await expect
        .poll(() => page.evaluate(() => window.__homeDismiss!.listReads.length))
        .toBeGreaterThan(1);
      await expect
        .poll(() => page.evaluate(() => window.__homeDismiss!.admissionSnapshot().listLoading))
        .toBe(false);
      await expect
        .poll(() => page.evaluate(() => window.__homeDismiss!.admissionSnapshot().listError))
        .toBeNull();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              window.__homeDismiss!.bootLoadSnapshot().workspace?.attentionReminder?.reasons.length,
          ),
        )
        .toBe(3);
    } else {
      await expect
        .poll(() => page.evaluate(() => window.__homeDismiss!.bootLoadSnapshot().loadState.status))
        .toBe('ready');
      await expect
        .poll(() => page.evaluate(() => window.__homeDismiss!.openReplies[0].status))
        .toBe('passed');
    }
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const after = await page.evaluate(() => ({
      state: window.__homeDismiss!.admissionSnapshot(),
      detail: window.__homeDismiss!.detailReads,
      list: window.__homeDismiss!.listReads,
      open: window.__homeDismiss!.openReplies,
      results: window.__homeDismiss!.openResults,
    }));
    expect(after.state.principalId).toBe(before.principalId);
    expect(after.state.workspace.attentionReminder?.dismissed).toBe(false);
    expect(after.state.workspace.attentionReminder?.reasons).toContainEqual({
      id: 'agent:another:question',
      revision: 'question-2',
    });
    expect(after.state.hudCard?.stateKey).toBe('wait');
    expect(after.state.tabStatus?.categories.map((item) => item.category)).toContain('review');
    await expect(row.locator('[data-home-status]')).toHaveAttribute(
      'data-home-status',
      'needs-you',
    );
    await testInfo.attach('same-person-' + source + '-reply-order-proof', {
      body: JSON.stringify({ before, held, fresh, after }, null, 2),
      contentType: 'application/json',
    });
    await testInfo.attach('same-person-' + source + '-after', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}

test('production detail reads belong to one person and coalesce within that admission', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(Preview, { props: { admissions: true } });
  const row = component.getByRole('option', { name: 'Review onboarding' });
  await row.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Dismiss for now', exact: true }).click();
  await expect(row.locator('[data-home-status]')).toHaveAttribute('data-home-status', 'idle');
  const before = await page.evaluate(() => window.__homeDismiss!.admissionSnapshot());
  await testInfo.attach('detail-person-a-before', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.evaluate(() => {
    window.__homeDismiss!.holdNextDetail();
    window.__homeDismiss!.startDetailRead();
    window.__homeDismiss!.startDetailRead();
  });
  await expect.poll(() => page.evaluate(() => window.__homeDismiss!.detailReads.length)).toBe(1);
  const held = await page.evaluate(() => window.__homeDismiss!.detailReads[0]);
  expect(held.status).toBe('held');
  expect(held.workspace.attentionReminder?.dismissed).toBe(true);
  await page.evaluate(() => window.__homeDismiss!.changePrincipal('person-b'));
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window
            .__homeDismiss!.admissionSnapshot()
            .listReads.filter((read) => read.status === 'held').length,
      ),
    )
    .toBe(1);
  await page.evaluate(() => window.__homeDismiss!.releaseList());
  await expect
    .poll(() => page.evaluate(() => window.__homeDismiss!.snapshot().attentionReminder?.dismissed))
    .toBe(false);
  await page.evaluate(() => window.__homeDismiss!.startDetailRead());
  await expect.poll(() => page.evaluate(() => window.__homeDismiss!.detailReads.length)).toBe(2);
  await expect
    .poll(() => page.evaluate(() => window.__homeDismiss!.snapshot().setupScript))
    .toBe('detail-for-person-b');
  const fresh = await page.evaluate(() => window.__homeDismiss!.admissionSnapshot());
  await page.evaluate(() => window.__homeDismiss!.releaseDetail());
  await expect.poll(() => page.evaluate(() => window.__homeDismiss!.detailResults.length)).toBe(3);
  const after = await page.evaluate(() => ({
    state: window.__homeDismiss!.admissionSnapshot(),
    reads: window.__homeDismiss!.detailReads,
    results: window.__homeDismiss!.detailResults,
  }));
  expect(after.reads.map((read) => read.principalId)).toEqual([before.principalId, 'person-b']);
  expect(after.state.workspace.setupScript).toBe('detail-for-person-b');
  expect(after.state.workspace.attentionReminder?.dismissed).toBe(false);
  expect(after.state.hudCard?.stateKey).toBe('wait');
  expect(after.state.tabStatus?.categories.map((item) => item.category)).toContain('review');
  await expect(row.locator('[data-home-status]')).toHaveAttribute('data-home-status', 'needs-you');
  await testInfo.attach('detail-person-b-after', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await testInfo.attach('production-detail-admission-proof', {
    body: JSON.stringify({ before, held, fresh, after }, null, 2),
    contentType: 'application/json',
  });
});

test('missing-entity event reads cannot overwrite another person’s fresh row', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(Preview, { props: { admissions: true } });
  const row = component.getByRole('option', { name: 'Review onboarding' });
  await row.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Dismiss for now', exact: true }).click();
  await expect(row.locator('[data-home-status]')).toHaveAttribute('data-home-status', 'idle');
  const before = await page.evaluate(() => window.__homeDismiss!.admissionSnapshot());
  await page.evaluate(() => {
    window.__homeDismiss!.holdNextDetail();
    window.__homeDismiss!.startMissingEntityRead();
  });
  await expect.poll(() => page.evaluate(() => window.__homeDismiss!.detailReads.length)).toBe(1);
  await expect(row).toHaveCount(0);
  await page.evaluate(() => window.__homeDismiss!.changePrincipal('person-b'));
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__homeDismiss!.listReads.filter((read) => read.status === 'held').length,
      ),
    )
    .toBe(1);
  await page.evaluate(() => window.__homeDismiss!.releaseList());
  await expect(row.locator('[data-home-status]')).toHaveAttribute('data-home-status', 'needs-you');
  await expect
    .poll(() => page.evaluate(() => window.__homeDismiss!.snapshot().attentionReminder?.dismissed))
    .toBe(false);
  await page.evaluate(() => window.__homeDismiss!.startMissingEntityRead());
  await expect.poll(() => page.evaluate(() => window.__homeDismiss!.detailReads.length)).toBe(2);
  await expect(row).toBeVisible();
  expect(await page.evaluate(() => window.__homeDismiss!.snapshot().setupScript)).toBe(
    'detail-for-person-b',
  );
  const fresh = await page.evaluate(() => window.__homeDismiss!.admissionSnapshot());
  await page.evaluate(() => window.__homeDismiss!.releaseDetail());
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__homeDismiss!.detailReads.filter((read) => read.status === 'passed').length,
      ),
    )
    .toBe(2);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const after = await page.evaluate(() => ({
    state: window.__homeDismiss!.admissionSnapshot(),
    reads: window.__homeDismiss!.detailReads,
  }));
  expect(after.reads.map((read) => read.principalId)).toEqual([before.principalId, 'person-b']);
  expect(after.state.workspace.setupScript).toBe('detail-for-person-b');
  expect(after.state.workspace.attentionReminder?.dismissed).toBe(false);
  expect(after.state.hudCard?.stateKey).toBe('wait');
  expect(after.state.tabStatus?.categories.map((item) => item.category)).toContain('review');
  await expect(row.locator('[data-home-status]')).toHaveAttribute('data-home-status', 'needs-you');
  await testInfo.attach('missing-entity-admission-proof', {
    body: JSON.stringify({ before, fresh, after }, null, 2),
    contentType: 'application/json',
  });
});

test('concurrent workspace lists do not reuse another person’s held promise', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(Preview, { props: { admissions: true } });
  const row = component.getByRole('option', { name: 'Review onboarding' });
  await row.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Dismiss for now', exact: true }).click();
  await expect(row.locator('[data-home-status]')).toHaveAttribute('data-home-status', 'idle');
  const before = await page.evaluate(() => window.__homeDismiss!.admissionSnapshot());
  await page.evaluate(() => {
    window.__homeDismiss!.holdNextList();
    window.__homeDismiss!.startListRead();
    window.__homeDismiss!.startListRead();
  });
  await expect
    .poll(() => page.evaluate(() => window.__homeDismiss!.admissionSnapshot().listReads.length))
    .toBe(1);
  await page.evaluate(() => window.__homeDismiss!.changePrincipal('person-b'));
  await expect
    .poll(() => page.evaluate(() => window.__homeDismiss!.admissionSnapshot().listReads.length))
    .toBe(2);
  const held = await page.evaluate(() => window.__homeDismiss!.admissionSnapshot());
  expect(held.listReads.map((read) => read.principalId)).toEqual([before.principalId, 'person-b']);
  expect(
    held.listReads[0].workspaces?.find((workspace) => workspace.id === 'dismiss-review')
      ?.attentionReminder?.dismissed,
  ).toBe(true);
  expect(
    held.listReads[1].workspaces?.find((workspace) => workspace.id === 'dismiss-review')
      ?.attentionReminder?.dismissed,
  ).toBe(false);
  await page.evaluate(() => window.__homeDismiss!.releaseList('person-b'));
  await expect
    .poll(() => page.evaluate(() => window.__homeDismiss!.snapshot().attentionReminder?.dismissed))
    .toBe(false);
  const fresh = await page.evaluate(() => window.__homeDismiss!.admissionSnapshot());
  await page.evaluate(() => window.__homeDismiss!.releaseList());
  await expect.poll(() => page.evaluate(() => window.__homeDismiss!.listResults.length)).toBe(2);
  const after = await page.evaluate(() => ({
    state: window.__homeDismiss!.admissionSnapshot(),
    results: window.__homeDismiss!.listResults,
  }));
  expect(after.results.every((result) => result.error?.includes('WORKSPACE_READ_RETIRED'))).toBe(
    true,
  );
  expect(after.state.workspace.attentionReminder?.dismissed).toBe(false);
  await expect(row.locator('[data-home-status]')).toHaveAttribute('data-home-status', 'needs-you');
  await testInfo.attach('concurrent-list-admission-proof', {
    body: JSON.stringify({ before, held, fresh, after }, null, 2),
    contentType: 'application/json',
  });
});

for (const refresh of ['delayed', 'failed'] as const) {
  test(
    'activity event reads do not reinsert another person’s reminder while their list is ' + refresh,
    async ({ mount, page }, testInfo) => {
      const component = await mount(Preview, { props: { admissions: true } });
      const row = component.getByRole('option', { name: 'Review onboarding' });
      await row.focus();
      await page.keyboard.press('Shift+F10');
      await page.getByRole('menuitem', { name: 'Dismiss for now', exact: true }).click();
      await expect(row.locator('[data-home-status]')).toHaveAttribute('data-home-status', 'idle');
      const before = await page.evaluate(() => window.__homeDismiss!.admissionSnapshot());
      await page.evaluate(() => {
        window.__homeDismiss!.holdNextDetail();
        window.__homeDismiss!.startActivityRead();
      });
      await expect
        .poll(() => page.evaluate(() => window.__homeDismiss!.detailReads.length))
        .toBe(1);
      expect(
        await page.evaluate(
          () => window.__homeDismiss!.detailReads[0].workspace.attentionReminder?.dismissed,
        ),
      ).toBe(true);
      await page.evaluate(() => window.__homeDismiss!.startActivityRead());
      await expect(row).toHaveCount(0);
      await page.evaluate(
        (fail) => window.__homeDismiss!.changePrincipal('person-b', fail),
        refresh === 'failed',
      );
      await expect
        .poll(() =>
          page.evaluate(
            () => window.__homeDismiss!.listReads.filter((read) => read.status === 'held').length,
          ),
        )
        .toBe(1);
      await page.evaluate(() => window.__homeDismiss!.releaseDetail());
      await expect
        .poll(() => page.evaluate(() => window.__homeDismiss!.detailReads[0].status))
        .toBe('passed');
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(row).toHaveCount(0);
      const afterOldReply = await page.evaluate(() => ({
        exists: window.__homeDismiss!.workspaceExists(),
        reads: window.__homeDismiss!.detailReads,
        lists: window.__homeDismiss!.listReads,
      }));
      expect(afterOldReply.exists).toBe(false);
      expect(afterOldReply.reads).toHaveLength(1);
      await page.evaluate(() => window.__homeDismiss!.releaseList());
      if (refresh === 'failed') {
        await expect
          .poll(() => page.evaluate(() => window.__homeDismiss!.listReads[0].status))
          .toBe('failed');
        await expect(row).toHaveCount(0);
        await page.evaluate(() => window.__homeDismiss!.refreshAdmission());
      }
      await expect(row.locator('[data-home-status]')).toHaveAttribute(
        'data-home-status',
        'needs-you',
      );
      const fresh = await page.evaluate(() => window.__homeDismiss!.admissionSnapshot());
      expect(fresh.workspace.attentionReminder?.dismissed).toBe(false);
      expect(fresh.hudCard?.stateKey).toBe('wait');
      expect(fresh.tabStatus?.categories.map((item) => item.category)).toContain('review');
      await testInfo.attach('activity-admission-' + refresh + '-proof', {
        body: JSON.stringify({ before, afterOldReply, fresh }, null, 2),
        contentType: 'application/json',
      });
    },
  );
}

test('aggregate reminder reads cannot replace another person’s current projection', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(Preview, { props: { admissions: true } });
  const row = component.getByRole('option', { name: 'Review onboarding' });
  await row.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Dismiss for now', exact: true }).click();
  await expect(row.locator('[data-home-status]')).toHaveAttribute('data-home-status', 'idle');
  const before = await page.evaluate(() => window.__homeDismiss!.admissionSnapshot());
  await page.evaluate(() => {
    window.__homeDismiss!.holdNextDetail();
    window.__homeDismiss!.invalidate();
  });
  await expect.poll(() => page.evaluate(() => window.__homeDismiss!.detailReads.length)).toBe(1);
  await page.evaluate(() => window.__homeDismiss!.changePrincipal('person-b'));
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__homeDismiss!.listReads.filter((read) => read.status === 'held').length,
      ),
    )
    .toBe(1);
  await page.evaluate(() => window.__homeDismiss!.releaseList());
  await expect
    .poll(() => page.evaluate(() => window.__homeDismiss!.snapshot().attentionReminder?.dismissed))
    .toBe(false);
  const fresh = await page.evaluate(() => window.__homeDismiss!.admissionSnapshot());
  await page.evaluate(() => window.__homeDismiss!.releaseDetail());
  await expect
    .poll(() => page.evaluate(() => window.__homeDismiss!.detailReads[0].status))
    .toBe('passed');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const after = await page.evaluate(() => ({
    state: window.__homeDismiss!.admissionSnapshot(),
    reads: window.__homeDismiss!.detailReads,
  }));
  expect(after.state.workspace.attentionReminder?.dismissed).toBe(false);
  expect(after.state.hudCard?.stateKey).toBe('wait');
  expect(after.state.tabStatus?.categories.map((item) => item.category)).toContain('review');
  await expect(row.locator('[data-home-status]')).toHaveAttribute('data-home-status', 'needs-you');
  await testInfo.attach('aggregate-admission-proof', {
    body: JSON.stringify({ before, fresh, after }, null, 2),
    contentType: 'application/json',
  });
});

test('workspace opening IPC coalesces only within one admission', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(Preview, { props: { admissions: true } });
  const row = component.getByRole('option', { name: 'Review onboarding' });
  await row.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Dismiss for now', exact: true }).click();
  await expect(row.locator('[data-home-status]')).toHaveAttribute('data-home-status', 'idle');
  const before = await page.evaluate(() => window.__homeDismiss!.admissionSnapshot());
  await page.evaluate(() => {
    window.__homeDismiss!.holdNextOpenReply();
    window.__homeDismiss!.startOpenRead();
    window.__homeDismiss!.startOpenRead();
  });
  await expect.poll(() => page.evaluate(() => window.__homeDismiss!.openReplies.length)).toBe(1);
  expect(
    await page.evaluate(
      () => window.__homeDismiss!.openReplies[0].workspace.attentionReminder?.dismissed,
    ),
  ).toBe(true);
  await page.evaluate(() => window.__homeDismiss!.changePrincipal('person-b'));
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__homeDismiss!.listReads.filter((read) => read.status === 'held').length,
      ),
    )
    .toBe(1);
  await page.evaluate(() => window.__homeDismiss!.startOpenRead());
  await expect.poll(() => page.evaluate(() => window.__homeDismiss!.openReplies.length)).toBe(2);
  await expect.poll(() => page.evaluate(() => window.__homeDismiss!.openResults.length)).toBe(1);
  const fresh = await page.evaluate(() => window.__homeDismiss!.openResults[0]);
  expect(fresh.principalId).toBe('person-b');
  expect(fresh.result.ok).toBe(true);
  if (fresh.result.ok) expect(fresh.result.data.attentionReminder?.dismissed).toBe(false);
  await page.evaluate(() => window.__homeDismiss!.releaseOpenReply());
  await expect.poll(() => page.evaluate(() => window.__homeDismiss!.openResults.length)).toBe(3);
  const after = await page.evaluate(() => ({
    state: window.__homeDismiss!.admissionSnapshot(),
    replies: window.__homeDismiss!.openReplies,
    results: window.__homeDismiss!.openResults,
  }));
  expect(
    after.results
      .filter((result) => result.principalId === before.principalId)
      .every((result) => !result.result.ok),
  ).toBe(true);
  expect(after.replies.map((reply) => reply.principalId)).toEqual([before.principalId, 'person-b']);
  expect(after.state.workspace.attentionReminder).toBeUndefined();
  await page.evaluate(() => window.__homeDismiss!.releaseList());
  await expect
    .poll(() => page.evaluate(() => window.__homeDismiss!.snapshot().attentionReminder?.dismissed))
    .toBe(false);
  await expect(row.locator('[data-home-status]')).toHaveAttribute('data-home-status', 'needs-you');
  await testInfo.attach('workspace-open-ipc-admission-proof', {
    body: JSON.stringify({ before, fresh, after }, null, 2),
    contentType: 'application/json',
  });
});

for (const newerLoad of ['after-old-reply', 'while-old-reply-held'] as const) {
  test(
    'workspace load retires an earlier admission ' + newerLoad,
    async ({ mount, page }, testInfo) => {
      const component = await mount(Preview, { props: { admissions: true } });
      const row = component.getByRole('option', { name: 'Review onboarding' });
      await row.focus();
      await page.keyboard.press('Shift+F10');
      await page.getByRole('menuitem', { name: 'Dismiss for now', exact: true }).click();
      await expect(row.locator('[data-home-status]')).toHaveAttribute('data-home-status', 'idle');
      const before = await page.evaluate(() => window.__homeDismiss!.admissionSnapshot());
      await page.evaluate(() => {
        window.__homeDismiss!.holdNextOpenReply();
        window.__homeDismiss!.startLoadRead();
      });
      await expect
        .poll(() => page.evaluate(() => window.__homeDismiss!.openReplies.length))
        .toBe(1);
      await expect
        .poll(() => page.evaluate(() => window.__homeDismiss!.admissionSnapshot().loadState.status))
        .toBe('cached-ready');
      expect(
        await page.evaluate(
          () => window.__homeDismiss!.openReplies[0].workspace.attentionReminder?.dismissed,
        ),
      ).toBe(true);
      await page.evaluate(() => window.__homeDismiss!.changePrincipal('person-b'));
      await expect
        .poll(() =>
          page.evaluate(
            () => window.__homeDismiss!.listReads.filter((read) => read.status === 'held').length,
          ),
        )
        .toBe(1);
      if (newerLoad === 'after-old-reply') {
        await page.evaluate(() => window.__homeDismiss!.releaseOpenReply());
        await expect
          .poll(() =>
            page.evaluate(() => window.__homeDismiss!.admissionSnapshot().loadState.status),
          )
          .toBe('idle');
        expect(
          await page.evaluate(() => window.__homeDismiss!.snapshot().setupScript),
        ).toBeUndefined();
        await expect(row.locator('[data-home-status]')).toHaveAttribute(
          'data-home-status',
          'needs-you',
        );
      }
      const held = await page.evaluate(() => window.__homeDismiss!.admissionSnapshot());
      await page.evaluate(() => window.__homeDismiss!.startLoadRead());
      await expect
        .poll(() => page.evaluate(() => window.__homeDismiss!.openReplies.length))
        .toBe(2);
      await expect
        .poll(() => page.evaluate(() => window.__homeDismiss!.admissionSnapshot().loadState.status))
        .toBe('ready');
      expect(await page.evaluate(() => window.__homeDismiss!.snapshot().setupScript)).toBe(
        'detail-for-person-b',
      );
      await expect(row.locator('[data-home-status]')).toHaveAttribute(
        'data-home-status',
        'needs-you',
      );
      if (newerLoad === 'while-old-reply-held') {
        await page.evaluate(() => window.__homeDismiss!.releaseOpenReply());
        await expect
          .poll(() => page.evaluate(() => window.__homeDismiss!.openReplies[0].status))
          .toBe('passed');
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
      }
      expect(await page.evaluate(() => window.__homeDismiss!.snapshot().setupScript)).toBe(
        'detail-for-person-b',
      );
      await page.evaluate(() => window.__homeDismiss!.releaseList());
      await expect
        .poll(() =>
          page.evaluate(() => window.__homeDismiss!.snapshot().attentionReminder?.dismissed),
        )
        .toBe(false);
      const after = await page.evaluate(() => ({
        state: window.__homeDismiss!.admissionSnapshot(),
        replies: window.__homeDismiss!.openReplies,
        reads: window.__homeDismiss!.detailReads,
      }));
      expect(after.state.loadState.status).toBe('ready');
      expect(after.state.workspace.attentionReminder?.dismissed).toBe(false);
      expect(after.state.hudCard?.stateKey).toBe('wait');
      expect(after.state.tabStatus?.categories.map((item) => item.category)).toContain('review');
      await testInfo.attach('workspace-load-' + newerLoad + '-proof', {
        body: JSON.stringify({ before, held, after }, null, 2),
        contentType: 'application/json',
      });
    },
  );
}

for (const surface of ['home', 'sidebar'] as const) {
  for (const refresh of ['delayed', 'failed'] as const) {
    test(
      surface + ' discards another person’s dismissal while their list is ' + refresh,
      async ({ mount, page }, testInfo) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
        await page.evaluate(() => document.documentElement.classList.remove('dark'));
        const component = await mount(Preview, {
          props: { sidebar: surface === 'sidebar', admissions: true },
        });
        const row =
          surface === 'home'
            ? component.getByRole('option', { name: 'Review onboarding' })
            : component.locator('[data-workspace-card-trigger]');
        const status =
          surface === 'home'
            ? row.locator('[data-home-status]')
            : component.locator('[data-workspace-status]');
        const attribute = surface === 'home' ? 'data-home-status' : 'data-workspace-status';
        const pending = surface === 'home' && refresh === 'delayed';
        const sidebarActions = component.getByRole('button', {
          name: 'Workspace actions',
          exact: true,
        });
        await row.focus();
        await page.keyboard.press('Shift+F10');
        await page.getByRole('menuitem', { name: 'Dismiss for now', exact: true }).click();
        await expect(status).toHaveAttribute(attribute, surface === 'home' ? 'idle' : 'waiting');
        if (pending) {
          await page.evaluate(() => window.__homeDismiss!.addPendingCreation());
          await expect(component.getByRole('option', { name: 'Pending review' })).toBeVisible();
        }
        const before = await page.evaluate(() => window.__homeDismiss!.admissionSnapshot());
        expect(before.workspace.attentionReminder?.dismissed).toBe(true);
        expect(before.hudCard?.stateKey).toBe('idle');
        expect(
          before.tabStatus?.categories.some((item) => item.category === 'review') ?? false,
        ).toBe(false);
        await testInfo.attach(surface + '-account-before', {
          body: await page.screenshot(),
          contentType: 'image/png',
        });
        await page.evaluate(
          (fail) => window.__homeDismiss!.changePrincipal('person-b', fail),
          refresh === 'failed',
        );
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                window
                  .__homeDismiss!.admissionSnapshot()
                  .listReads.filter((read) => read.status === 'held').length,
            ),
          )
          .toBeGreaterThan(0);
        await expect(status).toHaveAttribute(
          attribute,
          surface === 'home' ? 'needs-you' : 'needs_attention',
        );
        const held = await page.evaluate(() => window.__homeDismiss!.admissionSnapshot());
        expect(held.principalId).toBe('person-b');
        expect(held.context).not.toBe(before.context);
        expect(held.workspace.attentionReminder).toBeUndefined();
        expect(held.hudCard).toMatchObject({ stateKey: 'wait', attention: 'review_required' });
        expect(held.attentionItems.length).toBeGreaterThan(0);
        expect(held.tabStatus?.categories.map((item) => item.category)).toEqual(
          expect.arrayContaining(['review', 'needs_input']),
        );
        expect(held.workspace).toMatchObject({
          id: before.workspace.id,
          title: before.workspace.title,
          displayStatus: 'needs_attention',
          attention: 'review_required',
          createdAt: before.workspace.createdAt,
          updatedAt: before.workspace.updatedAt,
        });
        if (surface === 'home') {
          await expect(
            component
              .locator('[data-home-status-filters]')
              .getByRole('button', { name: /Needs you/ }),
          ).toContainText(pending ? '5' : '4');
          await expect(
            component.getByRole('option', { name: 'Ready to merge' }).locator('[data-home-status]'),
          ).toHaveAttribute('data-home-status', 'pr-ready');
        }
        if (pending) expect(held.pendingCreation?.attentionReminder).toBeUndefined();
        if (surface === 'sidebar') await expect(sidebarActions).toBeHidden();
        await testInfo.attach(surface + '-account-after', {
          body: await page.screenshot(),
          contentType: 'image/png',
        });
        await page.evaluate(() => window.__homeDismiss!.releaseList());
        let failed;
        if (refresh === 'failed') {
          await expect
            .poll(() =>
              page.evaluate(() =>
                window.__homeDismiss!.listReads.some(
                  (read) => read.principalId === 'person-b' && read.status === 'failed',
                ),
              ),
            )
            .toBe(true);
          failed = await page.evaluate(() => window.__homeDismiss!.admissionSnapshot());
          expect(failed.workspace.attentionReminder).toBeUndefined();
          await expect(status).toHaveAttribute(
            attribute,
            surface === 'home' ? 'needs-you' : 'needs_attention',
          );
          await page.evaluate(() => window.__homeDismiss!.refreshAdmission());
        }
        await expect
          .poll(() =>
            page.evaluate(() => window.__homeDismiss!.snapshot().attentionReminder?.dismissed),
          )
          .toBe(false);
        const fresh = await page.evaluate(() => window.__homeDismiss!.admissionSnapshot());
        if (pending) {
          expect(fresh.pendingCreation?.attentionReminder).toBeUndefined();
          await expect(
            component.getByRole('option', { name: 'Pending review' }).locator('[data-home-status]'),
          ).toHaveAttribute('data-home-status', 'needs-you');
        }
        if (surface === 'sidebar') await expect(sidebarActions).toBeVisible();
        await row.focus();
        await page.keyboard.press('Shift+F10');
        await page.getByRole('menuitem', { name: 'Dismiss for now', exact: true }).click();
        await expect(status).toHaveAttribute(attribute, surface === 'home' ? 'idle' : 'waiting');
        const after = await page.evaluate(() => window.__homeDismiss!.admissionSnapshot());
        expect(after.workspace.attentionReminder?.dismissed).toBe(true);
        await testInfo.attach(surface + '-account-' + refresh + '-proof', {
          body: JSON.stringify({ before, held, failed, fresh, after }, null, 2),
          contentType: 'application/json',
        });
      },
    );
  }

  test(
    surface + ' restores the same person’s saved dismissal after reconnect admission',
    async ({ mount, page }, testInfo) => {
      const component = await mount(Preview, {
        props: { sidebar: surface === 'sidebar', admissions: true },
      });
      const row =
        surface === 'home'
          ? component.getByRole('option', { name: 'Review onboarding' })
          : component.locator('[data-workspace-card-trigger]');
      const status =
        surface === 'home'
          ? row.locator('[data-home-status]')
          : component.locator('[data-workspace-status]');
      const attribute = surface === 'home' ? 'data-home-status' : 'data-workspace-status';
      await row.focus();
      await page.keyboard.press('Shift+F10');
      await page.getByRole('menuitem', { name: 'Dismiss for now', exact: true }).click();
      await expect(status).toHaveAttribute(attribute, surface === 'home' ? 'idle' : 'waiting');
      const before = await page.evaluate(() => window.__homeDismiss!.admissionSnapshot());
      await page.evaluate(() => window.__homeDismiss!.reconnect());
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              window
                .__homeDismiss!.admissionSnapshot()
                .listReads.filter((read) => read.status === 'held').length,
          ),
        )
        .toBeGreaterThan(0);
      await expect(status).toHaveAttribute(
        attribute,
        surface === 'home' ? 'needs-you' : 'needs_attention',
      );
      const held = await page.evaluate(() => window.__homeDismiss!.admissionSnapshot());
      expect(held.workspace.attentionReminder).toBeUndefined();
      expect(held.principalId).toBe(before.principalId);
      expect(held.context).not.toBe(before.context);
      await page.evaluate(() => window.__homeDismiss!.releaseList());
      await expect(status).toHaveAttribute(attribute, surface === 'home' ? 'idle' : 'waiting');
      const after = await page.evaluate(() => window.__homeDismiss!.admissionSnapshot());
      expect(after.workspace.attentionReminder?.dismissed).toBe(true);
      expect(after.hudCard?.stateKey).toBe('idle');
      expect(after.tabStatus?.categories.some((item) => item.category === 'review') ?? false).toBe(
        false,
      );
      await testInfo.attach(surface + '-reconnect-person-proof', {
        body: JSON.stringify({ before, held, after }, null, 2),
        contentType: 'application/json',
      });
    },
  );

  test(
    surface + ' ignores an old person’s dismissal response after new admission',
    async ({ mount, page }, testInfo) => {
      const component = await mount(Preview, {
        props: { sidebar: surface === 'sidebar', admissions: true },
      });
      const row =
        surface === 'home'
          ? component.getByRole('option', { name: 'Review onboarding' })
          : component.locator('[data-workspace-card-trigger]');
      const status =
        surface === 'home'
          ? row.locator('[data-home-status]')
          : component.locator('[data-workspace-status]');
      const attribute = surface === 'home' ? 'data-home-status' : 'data-workspace-status';
      await row.focus();
      await page.keyboard.press('Shift+F10');
      await page.evaluate(() => window.__homeDismiss!.holdNextResponse());
      await page.getByRole('menuitem', { name: 'Dismiss for now', exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.__homeDismiss!.calls.length)).toBe(1);
      const before = await page.evaluate(() => window.__homeDismiss!.admissionSnapshot());
      await page.evaluate(() => window.__homeDismiss!.changePrincipal('person-b'));
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              window
                .__homeDismiss!.admissionSnapshot()
                .listReads.filter((read) => read.status === 'held').length,
          ),
        )
        .toBeGreaterThan(0);
      await page.evaluate(() => window.__homeDismiss!.release());
      await expect.poll(() => page.evaluate(() => window.__homeDismiss!.responses.length)).toBe(1);
      await expect(status).toHaveAttribute(
        attribute,
        surface === 'home' ? 'needs-you' : 'needs_attention',
      );
      const afterReply = await page.evaluate(() => window.__homeDismiss!.admissionSnapshot());
      expect(afterReply.workspace.attentionReminder).toBeUndefined();
      expect(afterReply.hudCard?.stateKey).toBe('wait');
      await page.evaluate(() => window.__homeDismiss!.releaseList());
      await expect
        .poll(() =>
          page.evaluate(() => window.__homeDismiss!.snapshot().attentionReminder?.dismissed),
        )
        .toBe(false);
      await expect(status).toHaveAttribute(
        attribute,
        surface === 'home' ? 'needs-you' : 'needs_attention',
      );
      const afterList = await page.evaluate(() => window.__homeDismiss!.admissionSnapshot());
      await testInfo.attach(surface + '-old-person-reply-proof', {
        body: JSON.stringify({ before, afterReply, afterList }, null, 2),
        contentType: 'application/json',
      });
    },
  );
}

test('Board dismissal keeps selected details and focus when the card moves', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  const component = await mount(Preview);
  await component.getByRole('button', { name: 'Board view', exact: true }).click();
  const board = component.locator('[data-home-board]');
  const card = board.getByRole('button', { name: 'Review onboarding', exact: true });
  await card.click();
  await card.focus();
  await page.keyboard.press('Shift+F10');
  const dismiss = page.getByRole('menuitem', { name: 'Dismiss for now', exact: true });
  await expect(dismiss).toBeVisible();
  await testInfo.attach('home-board-dismiss-before', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await dismiss.click();
  const moved = board
    .getByRole('region', { name: 'Waiting', exact: true })
    .getByRole('button', { name: 'Review onboarding', exact: true });
  await expect(moved.locator('[data-home-status]')).toHaveAccessibleName(/Waiting/);
  await expect(moved).toBeFocused();
  await expect(component.locator('[data-home-detail]')).toBeVisible();
  await expect(board.getByRole('region', { name: 'PR ready', exact: true })).toBeVisible();
  await testInfo.attach('home-board-dismiss-layout', {
    body: JSON.stringify(
      await board.evaluate((element) => ({
        scrollTop: element.scrollTop,
        scrollLeft: element.scrollLeft,
        bounds: element.getBoundingClientRect().toJSON(),
        headings: [...element.querySelectorAll('h3')].map((heading) => ({
          label: heading.textContent?.trim(),
          bounds: heading.getBoundingClientRect().toJSON(),
        })),
      })),
      null,
      2,
    ),
    contentType: 'application/json',
  });
  for (const label of ['Needs you', 'PR ready', 'Running', 'Waiting', 'Done & idle']) {
    await expect(board.getByRole('heading', { name: label, exact: true })).toBeInViewport({
      ratio: 1,
    });
  }
  await testInfo.attach('home-board-dismiss-after', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

for (const view of ['list', 'board'] as const) {
  test(`Home ${view} preserves frozen dismissal and pin focus across Micro connection changes`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
    const component = await mount(Preview, { props: { micro: true } });
    if (view === 'board')
      await component.getByRole('button', { name: 'Board view', exact: true }).click();
    const row =
      view === 'list'
        ? component.getByRole('option', { name: 'Review onboarding' })
        : component
            .locator('[data-home-board]')
            .getByRole('button', { name: 'Review onboarding', exact: true });
    await row.focus();
    await page.keyboard.press('Shift+F10');
    await expect(
      page.getByRole('menuitem', { name: 'Assign to Micro Key', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('menuitem', { name: 'Dismiss for now', exact: true }),
    ).toBeVisible();
    await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
    await expect(row).toBeFocused();
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Unpin', exact: true }).click();
    await expect(row).toBeFocused();
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
    await expect(row).toBeFocused();
    await page.keyboard.press('Shift+F10');
    await testInfo.attach(`dismiss-micro-${view}-before`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await page.evaluate(() => {
      window.__homeDismiss!.addReason();
      window.__homeMicroPreview!.setConnected(false);
    });
    await expect(
      page.getByRole('menuitem', { name: 'Assign to Micro Key', exact: true }),
    ).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Dismiss for now', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__homeDismiss!.calls.length)).toBe(1);
    expect(await page.evaluate(() => window.__homeDismiss!.calls[0])).toEqual({
      channel: IPC_CHANNELS.BACKEND.REQUEST,
      method: 'workspace.dismissAttention',
      params: { workspaceId: 'dismiss-review', reasons: observedReasons },
    });
    await expect(row.locator('[data-home-status]')).toHaveAttribute(
      'data-home-status',
      'needs-you',
    );
    await expect(row).toBeFocused();
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Dismiss for now', exact: true }).click();
    await expect(row.locator('[data-home-status]')).toHaveAccessibleName(/Waiting/);
    await expect(row).toBeFocused();
    await testInfo.attach(`dismiss-micro-${view}-after`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await testInfo.attach(`dismiss-micro-${view}-wire`, {
      body: JSON.stringify(
        await page.evaluate(() => ({
          requests: window.__homeDismiss!.calls,
          responses: window.__homeDismiss!.responses,
          current: window.__homeDismiss!.snapshot(),
        })),
        null,
        2,
      ),
      contentType: 'application/json',
    });
  });
}

for (const surface of ['home', 'sidebar'] as const) {
  test(`${surface} freezes the menu snapshot and acknowledges only observed reasons`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    });
    const component = await mount(Preview, { props: { sidebar: surface === 'sidebar' } });
    const row =
      surface === 'home'
        ? component.getByRole('option', { name: 'Review onboarding' })
        : component.locator('[data-workspace-card-trigger]');
    await row.focus();
    await page.keyboard.press('Shift+F10');
    const dismiss = page.getByRole('menuitem', { name: 'Dismiss for now', exact: true });
    await expect(dismiss).toBeVisible();
    await testInfo.attach(`${surface}-before`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await page.evaluate(() => {
      window.__homeDismiss!.holdNext();
      window.__homeDismiss!.addReason();
    });
    await dismiss.click();
    await expect.poll(() => page.evaluate(() => window.__homeDismiss!.calls.length)).toBe(1);
    expect(await page.evaluate(() => window.__homeDismiss!.calls[0])).toEqual({
      channel: IPC_CHANNELS.BACKEND.REQUEST,
      method: 'workspace.dismissAttention',
      params: { workspaceId: 'dismiss-review', reasons: observedReasons },
    });
    await page.evaluate(() => window.__homeDismiss!.release());
    await expect(
      surface === 'home'
        ? row.locator('[data-home-status]')
        : component.locator('[data-workspace-status]'),
    ).toHaveAttribute(
      surface === 'home' ? 'data-home-status' : 'data-workspace-status',
      surface === 'home' ? 'needs-you' : 'needs_attention',
    );
    if (surface === 'sidebar') {
      await component.getByRole('button', { name: 'Workspace actions', exact: true }).click();
    } else {
      await row.focus();
      await page.keyboard.press('Shift+F10');
    }
    await dismiss.click();
    await expect(
      surface === 'home'
        ? row.locator('[data-home-status]')
        : component.locator('[data-workspace-status]'),
    ).toHaveAttribute(
      surface === 'home' ? 'data-home-status' : 'data-workspace-status',
      surface === 'home' ? 'idle' : 'waiting',
    );
    await expect(row).toBeFocused();
    await page.evaluate(() => {
      window.__homeDismiss!.refresh();
      window.__homeDismiss!.unchangedEvents();
      window.__homeDismiss!.invalidate();
    });
    await expect
      .poll(() => page.evaluate(() => window.__homeDismiss!.reads))
      .toEqual(['dismiss-review']);
    await expect(
      surface === 'home'
        ? row.locator('[data-home-status]')
        : component.locator('[data-workspace-status]'),
    ).toHaveAttribute(
      surface === 'home' ? 'data-home-status' : 'data-workspace-status',
      surface === 'home' ? 'idle' : 'waiting',
    );
    await expect(page.getByRole('menu')).toHaveCount(0);
    await testInfo.attach(`${surface}-after`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await testInfo.attach(`${surface}-wire`, {
      body: JSON.stringify(await page.evaluate(() => window.__homeDismiss!.calls), null, 2),
      contentType: 'application/json',
    });
    await page.evaluate(() => window.__homeDismiss!.setActivity('agent_running'));
    await expect(
      surface === 'home'
        ? row.locator('[data-home-status]')
        : component.locator('[data-workspace-status]'),
    ).toHaveAttribute(
      surface === 'home' ? 'data-home-status' : 'data-workspace-status',
      surface === 'home' ? 'running' : 'in_progress',
    );
    await testInfo.attach(`${surface}-activity-running`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await page.evaluate(() => window.__homeDismiss!.setActivity('idle'));
    await expect(
      surface === 'home'
        ? row.locator('[data-home-status]')
        : component.locator('[data-workspace-status]'),
    ).toHaveAttribute(
      surface === 'home' ? 'data-home-status' : 'data-workspace-status',
      surface === 'home' ? 'idle' : 'waiting',
    );
  });
}

for (const incoming of ['new reason', 'activity', 'failure'] as const) {
  test(`A late dismissal reply preserves newer ${incoming}`, async ({ mount, page }, testInfo) => {
    const component = await mount(Preview);
    const row = component.getByRole('option', { name: 'Review onboarding' });
    await row.focus();
    await page.keyboard.press('Shift+F10');
    await page.evaluate(() => window.__homeDismiss!.holdNextResponse());
    await page.getByRole('menuitem', { name: 'Dismiss for now', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__homeDismiss!.calls.length)).toBe(1);
    await page.evaluate((edge) => {
      const fixture = window.__homeDismiss!;
      if (edge === 'new reason') {
        fixture.addReason();
        fixture.invalidate();
      } else if (edge === 'activity') fixture.setActivity('agent_running');
      else fixture.setStatus('failed');
    }, incoming);
    if (incoming === 'new reason')
      await expect
        .poll(() => page.evaluate(() => window.__homeDismiss!.reads))
        .toEqual(['dismiss-review']);
    await page.evaluate(() => window.__homeDismiss!.release());
    await expect.poll(() => page.evaluate(() => window.__homeDismiss!.responses.length)).toBe(1);
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    await expect(row.locator('[data-home-status]')).toHaveAttribute(
      'data-home-status',
      incoming === 'new reason' ? 'needs-you' : incoming === 'activity' ? 'running' : 'blocked',
    );
    if (incoming === 'failure')
      await expect(row.locator('[data-home-status]')).toHaveAccessibleName(/^Failed\./);
    await testInfo.attach(`late-dismiss-${incoming}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await testInfo.attach(`late-dismiss-${incoming}-wire`, {
      body: JSON.stringify(
        await page.evaluate(() => ({
          requests: window.__homeDismiss!.calls,
          responses: window.__homeDismiss!.responses,
        })),
        null,
        2,
      ),
      contentType: 'application/json',
    });
  });
}

test('Dismissal keeps active work in Running', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const component = await mount(Preview);
  await page.evaluate(() => window.__homeDismiss!.setStatus('in_progress'));
  const row = component.getByRole('option', { name: 'Review onboarding' });
  await row.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Dismiss for now', exact: true }).click();
  const running = component
    .getByRole('listbox', { name: 'Running', exact: true })
    .getByRole('option', { name: 'Review onboarding' });
  await expect(running.locator('[data-home-status]')).toHaveAttribute(
    'data-home-status',
    'running',
  );
  await expect(running).toBeFocused();
  await testInfo.attach('home-dismiss-running', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('Home preserves selected details under Needs you and handles rejection, new reasons and priority states', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const component = await mount(Preview);
  const statuses = component.getByRole('group', { name: 'Status', exact: true });
  await statuses.getByRole('button', { name: /^Needs you/ }).click();
  const row = component.getByRole('option', { name: 'Review onboarding' });
  await row.click();
  await row.getByRole('button', { name: 'Workspace actions', exact: true }).click();
  await page.evaluate(() => window.__homeDismiss!.failNext());
  await page.getByRole('menuitem', { name: 'Dismiss for now', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__homeDismiss!.calls.length)).toBe(1);
  await expect(row).toBeVisible();
  await expect(component.locator('[data-home-detail]')).toBeVisible();
  await row.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Dismiss for now', exact: true }).click();
  await expect(row).toHaveCount(0);
  await expect(component.locator('[data-home-detail]')).toBeVisible();
  const compactFilter = component.getByRole('combobox', { name: 'Status', exact: true });
  await expect(compactFilter).toBeFocused();
  await compactFilter.click();
  await page.getByRole('option', { name: 'All', exact: true }).click();
  const moved = component.getByRole('option', { name: 'Review onboarding' });
  await expect(moved.locator('[data-home-status]')).toHaveAccessibleName(/Waiting/);
  await page.evaluate(() => window.__homeDismiss!.refresh());
  await expect(moved.locator('[data-home-status]')).toHaveAccessibleName(/Waiting/);
  await page.evaluate(() => window.__homeDismiss!.setStatus('in_progress'));
  await expect(moved.locator('[data-home-status]')).toHaveAttribute('data-home-status', 'running');
  await page.evaluate(() => window.__homeDismiss!.addReason());
  await expect(moved.locator('[data-home-status]')).toHaveAttribute(
    'data-home-status',
    'needs-you',
  );
  for (const status of ['blocked', 'failed'] as const) {
    await page.evaluate((value) => window.__homeDismiss!.setStatus(value), status);
    await moved.focus();
    await page.keyboard.press('Shift+F10');
    await expect(page.getByRole('menuitem', { name: 'Dismiss for now', exact: true })).toHaveCount(
      0,
    );
    await page.keyboard.press('Escape');
  }
  await testInfo.attach('home-dismiss-priority', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('Dismiss menus remain readable for collaborators in dark narrow layout; PR-only and older daemons hide action', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 900, height: 740 });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  const component = await mount(Preview, { props: { collaborator: true } });
  for (const title of ['Ready to merge', 'Older daemon reminder']) {
    const row = component.getByRole('option', { name: title });
    await row.focus();
    await page.keyboard.press('Shift+F10');
    await expect(page.getByRole('menuitem', { name: 'Dismiss for now', exact: true })).toHaveCount(
      0,
    );
    await page.keyboard.press('Escape');
  }
  const row = component.getByRole('option', { name: 'Review onboarding' });
  await row.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Dismiss for now', exact: true })).toBeVisible();
  await testInfo.attach('home-dismiss-dark-narrow', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

for (const destination of ['search', 'another workspace'] as const) {
  test(`Slow Home dismissal preserves focus moved into ${destination}`, async ({
    mount,
    page,
  }, testInfo) => {
    const component = await mount(Preview);
    const row = component.getByRole('option', { name: 'Review onboarding' });
    await row.focus();
    await page.keyboard.press('Shift+F10');
    await page.evaluate(() => window.__homeDismiss!.holdNext());
    await page.getByRole('menuitem', { name: 'Dismiss for now', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__homeDismiss!.calls.length)).toBe(1);
    const target =
      destination === 'search'
        ? component.getByRole('searchbox')
        : component.getByRole('option', { name: 'Ready to merge' });
    await target.focus();
    await page.evaluate(() => window.__homeDismiss!.release());
    await expect(row.locator('[data-home-status]')).toHaveAccessibleName(/Waiting/);
    await expect(target).toBeFocused();
    await testInfo.attach(`home-dismiss-focus-${destination}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}

for (const surface of ['home', 'sidebar'] as const) {
  for (const change of ['newer acknowledgement', 'resolved reason'] as const) {
    test(`A late partial dismissal preserves a ${change} in ${surface}`, async ({
      mount,
      page,
    }, testInfo) => {
      const component = await mount(Preview, { props: { sidebar: surface === 'sidebar' } });
      const row =
        surface === 'home'
          ? component.getByRole('option', { name: 'Review onboarding' })
          : component.locator('[data-workspace-card-trigger]');
      const status =
        surface === 'home'
          ? row.locator('[data-home-status]')
          : component.locator('[data-workspace-status]');
      const attribute = surface === 'home' ? 'data-home-status' : 'data-workspace-status';
      const waiting = surface === 'home' ? 'idle' : 'waiting';
      await row.focus();
      await page.keyboard.press('Shift+F10');
      await page.evaluate(() => {
        window.__homeDismiss!.addReason();
        window.__homeDismiss!.holdNextResponse();
      });
      await page.getByRole('menuitem', { name: 'Dismiss for now', exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.__homeDismiss!.calls.length)).toBe(1);
      expect(await page.evaluate(() => window.__homeDismiss!.calls[0])).toEqual({
        channel: IPC_CHANNELS.BACKEND.REQUEST,
        method: 'workspace.dismissAttention',
        params: { workspaceId: 'dismiss-review', reasons: observedReasons },
      });
      await testInfo.attach(`${surface}-${change}-before`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      if (change === 'resolved reason') {
        await page.evaluate(() => window.__homeDismiss!.resolveAddedReason());
      } else {
        await row.focus();
        await page.keyboard.press('Shift+F10');
        await page.getByRole('menuitem', { name: 'Dismiss for now', exact: true }).click();
        await expect
          .poll(() => page.evaluate(() => window.__homeDismiss!.responses.length))
          .toBe(1);
      }
      await expect(status).toHaveAttribute(attribute, waiting);
      const beforeReply = await page.evaluate(() => window.__homeDismiss!.snapshot());
      await page.evaluate(() => window.__homeDismiss!.release());
      await expect
        .poll(() => page.evaluate(() => window.__homeDismiss!.responses.length))
        .toBe(change === 'resolved reason' ? 1 : 2);
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
      );
      await expect(status).toHaveAttribute(attribute, waiting);
      await expect(row).toBeFocused();
      expect(await page.evaluate(() => window.__homeDismiss!.snapshot().attentionReminder)).toEqual(
        beforeReply.attentionReminder,
      );
      if (change === 'resolved reason')
        expect(beforeReply.attentionReminder?.reasons).toEqual(observedReasons);
      await page.evaluate(() => window.__homeDismiss!.refresh());
      await expect(status).toHaveAttribute(attribute, waiting);
      await testInfo.attach(`${surface}-${change}-after`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      await testInfo.attach(`${surface}-${change}-wire`, {
        body: JSON.stringify(
          {
            beforeReply,
            ...(await page.evaluate(() => ({
              requests: window.__homeDismiss!.calls,
              responses: window.__homeDismiss!.responses,
              current: window.__homeDismiss!.snapshot(),
            }))),
          },
          null,
          2,
        ),
        contentType: 'application/json',
      });
    });
  }

  test(`A dismissal response can reveal a fresh server reason in ${surface}`, async ({
    mount,
    page,
  }, testInfo) => {
    const component = await mount(Preview, { props: { sidebar: surface === 'sidebar' } });
    const row =
      surface === 'home'
        ? component.getByRole('option', { name: 'Review onboarding' })
        : component.locator('[data-workspace-card-trigger]');
    await row.focus();
    await page.keyboard.press('Shift+F10');
    await page.evaluate(() => window.__homeDismiss!.holdNext());
    await page.getByRole('menuitem', { name: 'Dismiss for now', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__homeDismiss!.calls.length)).toBe(1);
    await page.evaluate(() => {
      window.__homeDismiss!.addReason(false);
      window.__homeDismiss!.release();
    });
    await expect
      .poll(() => page.evaluate(() => window.__homeDismiss!.snapshot().attentionReminder?.reasons))
      .toEqual([...observedReasons, { id: 'agent:another:question', revision: 'question-2' }]);
    await expect(
      surface === 'home'
        ? row.locator('[data-home-status]')
        : component.locator('[data-workspace-status]'),
    ).toHaveAttribute(
      surface === 'home' ? 'data-home-status' : 'data-workspace-status',
      surface === 'home' ? 'needs-you' : 'needs_attention',
    );
    expect(await page.evaluate(() => window.__homeDismiss!.calls[0])).toEqual({
      channel: IPC_CHANNELS.BACKEND.REQUEST,
      method: 'workspace.dismissAttention',
      params: { workspaceId: 'dismiss-review', reasons: observedReasons },
    });
    await testInfo.attach(`${surface}-fresh-server-reason`, {
      body: JSON.stringify(
        await page.evaluate(() => ({
          requests: window.__homeDismiss!.calls,
          responses: window.__homeDismiss!.responses,
          current: window.__homeDismiss!.snapshot(),
        })),
        null,
        2,
      ),
      contentType: 'application/json',
    });
  });
}
