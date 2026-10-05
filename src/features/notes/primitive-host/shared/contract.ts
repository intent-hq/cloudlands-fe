/** Type-only handshake used by native construction adapters. The separately
 * owned host validates its runtime protocol; this reader installs no host route. */
type HostIdentity = {
  backendId: string;
  workspaceId: string;
  noteId: string;
  noteInstanceId: string;
  ownerRef: string;
  sourceRef: string;
  source:
    | { kind: 'snapshot'; snapshotId: string; sourceRevision: string }
    | {
        kind: 'session-live';
        snapshotId: string;
        sourceRevision: string;
        editorSessionId: string;
        editSequence: number;
        generation: string;
      };
  profileId: string;
  jobId: string;
};
type HostProfile = {
  width: number;
  height: number;
  theme: 'light' | 'dark';
  font: string;
  fontSize: number;
  devicePixelRatio: number;
};
export interface HostHandshake {
  version: 1;
  token: string;
  identity: HostIdentity;
  profile: HostProfile;
  adapter: string;
  chunkBytes: number;
}
