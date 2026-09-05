import { navigateToRoute } from '$lib/utils/navigation.client';
import type { ResolveStartInput } from '../resolver';

const START_INPUT_PREFIX = 'new-workspace-start:';

function newInstanceId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

export function buildNewWorkspaceRoute(
  input?: ResolveStartInput,
  instanceId = newInstanceId(),
): string {
  if (typeof sessionStorage !== 'undefined' && input) {
    sessionStorage.setItem(`${START_INPUT_PREFIX}${instanceId}`, JSON.stringify(input));
  }
  return `/workspace/new?instance=${encodeURIComponent(instanceId)}`;
}

export function consumeNewWorkspaceStartInput(url: URL): ResolveStartInput {
  const instanceId = url.searchParams.get('instance');
  if (!instanceId || typeof sessionStorage === 'undefined') return {};
  const key = `${START_INPUT_PREFIX}${instanceId}`;
  const raw = sessionStorage.getItem(key);
  sessionStorage.removeItem(key);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ResolveStartInput;
  } catch {
    return {};
  }
}

export async function navigateToNewWorkspace(input?: ResolveStartInput): Promise<void> {
  await navigateToRoute(buildNewWorkspaceRoute(input));
}