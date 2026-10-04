import { z } from 'zod';

export const HOST_CHANNEL = 'primitive-host:exchange';
export const CHUNK_BYTES = 16 * 1024;
const id = z.string().min(1).max(256);
export const identitySchema = z
  .object({
    backendId: id,
    workspaceId: id,
    noteId: id,
    noteInstanceId: id,
    ownerRef: id,
    sourceRef: id,
    source: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('snapshot'), snapshotId: id, sourceRevision: id }).strict(),
      z
        .object({
          kind: z.literal('session-live'),
          snapshotId: id,
          sourceRevision: id,
          editorSessionId: id,
          editSequence: z.number().int().nonnegative(),
          generation: id,
        })
        .strict(),
    ]),
    profileId: id,
    jobId: id,
  })
  .strict();
export type HostIdentity = z.infer<typeof identitySchema>;
export const profileSchema = z
  .object({
    width: z.number().int().min(1).max(4096),
    height: z.number().int().min(1).max(4096),
    theme: z.enum(['light', 'dark']),
    font: z.string().min(1).max(512),
    fontSize: z.number().min(8).max(64),
    devicePixelRatio: z.number().min(0.5).max(4),
  })
  .strict();
export type HostProfile = z.infer<typeof profileSchema>;
export const readinessSchema = z
  .object({
    width: z.number().positive(),
    height: z.number().positive(),
    fontReady: z.literal(true),
    layoutReady: z.literal(true),
    devicePixelRatio: z.number().positive(),
  })
  .strict();
export type HostReadiness = z.infer<typeof readinessSchema>;
export const costsSchema = z
  .object({
    sourceBytes: z.number().int().nonnegative(),
    constructionMs: z.number().nonnegative(),
    outputBytes: z.number().int().nonnegative(),
    outputChunks: z.number().int().nonnegative(),
    peakDomNodes: z.number().int().nonnegative(),
    native: z
      .record(z.string().min(1).max(64), z.number().nonnegative())
      .refine((v) => Object.keys(v).length <= 32)
      .optional(),
  })
  .strict();
export type ConstructionCosts = z.infer<typeof costsSchema>;
export const requestSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('connect'),
      runtime: z.object({ sandboxed: z.literal(true), contextIsolated: z.literal(true) }).strict(),
    })
    .strict(),
  z.object({ op: z.literal('ready'), token: id, readiness: readinessSchema }).strict(),
  z.object({ op: z.literal('read'), token: id, sequence: z.number().int().nonnegative() }).strict(),
  z
    .object({
      op: z.literal('append'),
      kind: z.enum(['record', 'manifest']),
      token: id,
      sequence: z.number().int().nonnegative(),
      data: z.string().max(CHUNK_BYTES),
    })
    .strict(),
  z.object({ op: z.literal('complete'), token: id, costs: costsSchema }).strict(),
  z.object({ op: z.literal('fail'), token: id }).strict(),
]);
export type HostRequest = z.infer<typeof requestSchema>;
export interface HostHandshake {
  version: 1;
  token: string;
  identity: HostIdentity;
  profile: HostProfile;
  adapter: string;
  chunkBytes: number;
}
export interface SourceChunk {
  data: string;
  done: boolean;
}
export interface HostBridge {
  connect(): Promise<HostHandshake>;
  ready(token: string, readiness: HostReadiness): Promise<void>;
  read(token: string, sequence: number): Promise<SourceChunk>;
  append(token: string, sequence: number, data: string, kind: 'record' | 'manifest'): Promise<void>;
  complete(token: string, costs: ConstructionCosts): Promise<void>;
  fail(token: string): Promise<void>;
}
/** Validate UTF-8 size, not only JS length. Never encode a producer's unbounded string. */
export function chunkBytes(data: string): number {
  if (typeof data !== 'string' || data.length > CHUNK_BYTES)
    throw new Error('Host chunk exceeds limit');
  const bytes = new TextEncoder().encode(data).byteLength;
  if (bytes > CHUNK_BYTES) throw new Error('Host chunk exceeds limit');
  return bytes;
}
