import { appClient } from '$lib/client';

function configured(value: unknown): boolean {
  if (value === '********') return true;
  if (value === null) return false;
  throw new Error('Invalid token settings response');
}

export async function readProviderToken(path: string): Promise<{ configured: boolean }> {
  const entry = await appClient.settings.get(path);
  if (!entry || entry.path !== path || entry.sensitive !== true) {
    throw new Error('Token settings unavailable');
  }
  return { configured: configured(entry.value) };
}

export async function writeProviderToken(
  path: string,
  token?: string,
): Promise<{ configured: boolean }> {
  const receipt =
    token === undefined
      ? await appClient.settings.reset(path)
      : (await appClient.settings.update([{ path, value: token }])).find(
          (entry) => entry.path === path,
        );
  if (!receipt || receipt.path !== path) throw new Error('Missing token settings receipt');
  const saved = configured(receipt.value);
  if (saved !== (token !== undefined)) throw new Error('Unexpected token settings receipt');
  return { configured: saved };
}
