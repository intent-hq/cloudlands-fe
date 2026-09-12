import type { ArtifactSelectionSnapshot } from '$shared/types/visual-artifact';

export interface ArtifactChatItem {
  id: string;
  type: 'selection' | 'file';
  label: string;
  description?: string;
  content?: string;
  metadata?: { semanticId: string; artifactSelection: ArtifactSelectionSnapshot };
  imageData?: string;
  imageMimeType?: string;
}
export interface PendingArtifactSelection {
  targetAgentId: string;
  items: ArtifactChatItem[];
}
export interface ArtifactImageState {
  dataUrl?: string;
  failed: boolean;
}
export interface ArtifactsWorkspaceState {
  images: Record<string, ArtifactImageState>;
  pending: Record<string, PendingArtifactSelection>;
}
export interface ArtifactsState {
  byWorkspaceId: Record<string, ArtifactsWorkspaceState>;
}
