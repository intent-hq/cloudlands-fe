import { expect, test } from '../../../test/ct-test';
import DirectoryPickerModal from './DirectoryPickerModal.svelte';
import DirectoryPickerView from './DirectoryPickerView.svelte';

const listing = {
  path: '/fixture/projects',
  parent: '/fixture',
  home: '/fixture',
  entries: ['alpha', 'beta'].map((name) => ({
    name,
    path: `/fixture/projects/${name}`,
    isDirectory: true,
    isGitRepo: false,
  })),
};

test('embedded picker keeps selection and cancel reachable in a short window', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 480 });
  const entries = Array.from({ length: 30 }, (_, index) => ({
    name: `project-${index}`,
    path: `/fixture/projects/project-${index}`,
    isDirectory: true,
    isGitRepo: false,
  }));
  let selected: string | undefined;
  let closed = false;
  await mount(DirectoryPickerModal, {
    props: {
      open: true,
      staticData: { listing: { ...listing, entries } },
      onSelect: (path) => {
        selected = path;
      },
      onClose: () => {
        closed = true;
      },
    },
  });
  const dialog = page.getByRole('dialog');
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
  const select = dialog.locator('footer').getByRole('button').last();
  await expect(cancel).toBeInViewport({ ratio: 1 });
  await expect(select).toBeInViewport({ ratio: 1 });
  await dialog.getByRole('option').last().click();
  await expect(dialog.locator('header')).toBeInViewport({ ratio: 1 });
  await expect(select).toBeInViewport({ ratio: 1 });
  expect(await dialog.evaluate((element) => element.scrollTop)).toBe(0);
  expect(
    await dialog.getByRole('listbox').evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(0);
  await select.click();
  await expect.poll(() => selected).toBe(entries.at(-1)!.path);
  await test.info().attach('directory-picker-short-window', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await cancel.click();
  await expect.poll(() => closed).toBe(true);
});

test('directory keyboard navigation and folder creation preserve callback paths', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 600 });
  const navigated: Array<string | undefined> = [];
  const created: string[] = [];
  let closed = false;
  await mount(DirectoryPickerView, {
    props: {
      open: true,
      listing,
      loading: false,
      error: null,
      pathError: null,
      onNavigate: (path) => {
        navigated.push(path);
      },
      onNavigateToPath: (path) => {
        navigated.push(path);
      },
      onCreateDirectory: (path) => {
        created.push(path);
      },
      onClearPathError: () => {},
      onSelect: () => {},
      onClose: () => {
        closed = true;
      },
    },
  });
  const contents = page.getByRole('listbox');
  await contents.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(() => navigated.at(-1)).toBe('/fixture/projects/beta');
  await page.keyboard.press('Backspace');
  await expect.poll(() => navigated.at(-1)).toBe('/fixture');
  await page.getByRole('button', { name: 'Enter a folder path', exact: true }).click();
  await page.getByRole('textbox', { name: 'Path', exact: true }).fill('~/other');
  await page.keyboard.press('Enter');
  await expect.poll(() => navigated.at(-1)).toBe('/fixture/other');
  await page.keyboard.press('Escape');
  expect(closed).toBe(false);
  await page.getByRole('button', { name: 'New Folder', exact: true }).click();
  await page.getByRole('textbox', { name: 'New folder name', exact: true }).fill('  example  ');
  await page.keyboard.press('Enter');
  await expect.poll(() => created).toEqual(['/fixture/projects/example']);
  await page.keyboard.press('Escape');
  expect(closed).toBe(false);
  await contents.focus();
  await page.keyboard.press('Escape');
  await expect.poll(() => closed).toBe(true);
});

test('directory retry requests the listing and path retry restores editing', async ({
  mount,
  page,
}) => {
  let retried: string | undefined;
  let cleared = false;
  const props = {
    open: true,
    listing,
    loading: false,
    error: 'Permission denied while reading this directory.',
    pathError: null,
    onNavigate: (path?: string) => {
      retried = path;
    },
    onNavigateToPath: () => {},
    onClearPathError: () => {
      cleared = true;
    },
    onSelect: () => {},
    onClose: () => {},
  };
  const component = await mount(DirectoryPickerView, { props });
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect.poll(() => retried).toBe(listing.path);
  await component.update({ props: { ...props, error: null, pathError: 'Folder does not exist.' } });
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect.poll(() => cleared).toBe(true);
  await expect(page.getByRole('textbox', { name: 'Path', exact: true })).toBeFocused();
});
