import { backendRequest } from '$lib/client/live/backend-transport';
import type { Assignment, MapActivity, MapActivityKind, Route, SemanticMapSnapshot } from './types';

export interface MapActivityOptions {
  sinceTs?: string;
  minutesAgo?: number;
  agentId?: string;
  kinds?: MapActivityKind[];
  limit?: number;
}

type MapRouteSubject =
  { agentId: string; taskNoteId?: never } | { agentId?: never; taskNoteId: string };

export type MapRouteOptions = MapRouteSubject & { sinceTs?: string };

export class SemanticMapClient {
  get(workspaceId: string): Promise<SemanticMapSnapshot> {
    return backendRequest<SemanticMapSnapshot>('map.get', { workspaceId });
  }

  classify(workspaceId: string, paths: string[]): Promise<Assignment[]> {
    return backendRequest<Assignment[]>('map.classify', { workspaceId, paths });
  }

  activity(workspaceId: string, options: MapActivityOptions = {}): Promise<MapActivity[]> {
    return backendRequest<MapActivity[]>('map.activity', { workspaceId, ...options });
  }

  route(workspaceId: string, options: MapRouteOptions): Promise<Route> {
    return backendRequest<Route>('map.route', { workspaceId, ...options });
  }
}
