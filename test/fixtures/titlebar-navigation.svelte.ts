export * from '../../playwright/app-stubs/navigation';

export const page = $state({
  url: new URL('http://localhost/workspace/titlebar-test'),
  params: { id: 'titlebar-test' },
});

export async function goto(path: string): Promise<void> {
  page.url = new URL(path, page.url);
}
