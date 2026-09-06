import { navigateToRoute } from '$lib/utils/navigation.client';
import type { ResolveStartInput } from '../resolver';

const START_INPUT_PREFIX = 'new-workspace-start:';

function newInstanceId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

interface NewWorkspaceRouteOptions {
  instanceId?: string;
  carrier?: 'session' | 'url';
}

export function buildNewWorkspaceRoute(
  input?: ResolveStartInput,
  options: NewWorkspaceRouteOptions = {},
): string {
  const instanceId = options.instanceId ?? newInstanceId();
  const params = new URLSearchParams({ instance: instanceId });
  if (input && options.carrier === 'url') {
    params.set('start', JSON.stringify(input));
  } else if (typeof sessionStorage !== 'undefined' && input) {
    sessionStorage.setItem(`${START_INPUT_PREFIX}${instanceId}`, JSON.stringify(input));
  }
  return `/workspace/new?${params.toString()}`;
}

export function requestedDraftIdForRoute(url: URL): string | null | undefined {
  const draftId = url.searchParams.get('draft');
  if (draftId) return draftId;
  return url.searchParams.has('instance') ? null : undefined;
}

export function consumeNewWorkspaceStartInput(url: URL): ResolveStartInput {
  const instanceId = url.searchParams.get('instance');
  let raw: string | null = null;
  if (instanceId && typeof sessionStorage !== 'undefined') {
    const key = `${START_INPUT_PREFIX}${instanceId}`;
    raw = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
  }
  raw ??= url.searchParams.get('start');
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
