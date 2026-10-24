import type { HomeConfiguration } from './home-workspaces-persistence';

type HomeTab = HomeConfiguration['tab'];

export function getHomeTabChange(
  current: HomeTab | 'custom',
  next: string,
): { tab: HomeTab; direction: -1 | 1 } | null {
  if (next === current || (next !== 'workspaces' && next !== 'prs' && next !== 'linear'))
    return null;
  const order = ['workspaces', 'prs', 'linear', 'custom'];
  return { tab: next, direction: order.indexOf(next) > order.indexOf(current) ? 1 : -1 };
}
