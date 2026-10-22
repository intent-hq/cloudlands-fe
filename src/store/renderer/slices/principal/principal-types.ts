import type { PrincipalSnapshot } from '$shared/types/principal';

export interface PrincipalRead {
  context: string;
  invalidation: number;
  presentationVersion: number;
}

export interface PrincipalState {
  context: string | null;
  status: 'unknown' | 'loading' | 'ready' | 'error' | 'revoked';
  snapshot: PrincipalSnapshot | null;
  boundPrincipalId: string | null;
  minimumRevision: number;
  invalidation: number;
  presentationVersion: number;
  refreshedPresentationVersion: number | null;
  error: 'incompatible-response' | 'unavailable' | null;
}
