import { z } from 'zod';

export type ArtifactJson =
  null | boolean | number | string | ArtifactJson[] | { [key: string]: ArtifactJson };
const jsonValue: z.ZodType<ArtifactJson> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValue),
    z.record(jsonValue),
  ]),
);
const id = z.string().min(1).max(160);
const coordinate = z.number().finite().min(-100000).max(100000);
export function isAllowedArtifactImageSource(src: string): boolean {
  return (
    /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(src) ||
    /^workspace-asset:\/\/[^/\s]+\/[^\s]+$/.test(src) ||
    /^intent:\/\/local\/(?:[^/\s]+\/)?file\/[^\s]+$/.test(src)
  );
}
const imageSource = z
  .string()
  .min(1)
  .max(200000)
  .refine(isAllowedArtifactImageSource, 'Unsupported image source');
const ArtifactRegionSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .strict()
  .refine((r) => r.x + r.width <= 1.000001 && r.y + r.height <= 1.000001);
export type ArtifactRegion = z.infer<typeof ArtifactRegionSchema>;

export const ArtifactSelectionSchema = z
  .object({
    itemIds: z.array(id).max(200),
    region: ArtifactRegionSchema.optional(),
  })
  .strict();
export type ArtifactSelection = z.infer<typeof ArtifactSelectionSchema>;

const ArtifactItemSchema = z
  .object({
    id,
    type: z.enum(['card', 'text', 'image']),
    text: z.string().max(16000),
    x: coordinate,
    y: coordinate,
    width: z.number().positive().max(4000),
    height: z.number().positive().max(4000),
    src: imageSource.optional(),
    group: id.optional(),
  })
  .strict();
export type ArtifactItem = z.infer<typeof ArtifactItemSchema>;

export const ArtifactDocumentSchema = z
  .object({
    version: z.literal(1),
    id,
    title: z.string().min(1).max(240),
    kind: z.enum(['board', 'image', 'options', 'preview']),
    items: z.array(ArtifactItemSchema).max(200),
    connections: z
      .array(z.object({ id, from: id, to: id, label: z.string().max(1000).optional() }).strict())
      .max(400),
    annotations: z
      .array(
        z
          .object({ id, selection: ArtifactSelectionSchema, text: z.string().min(1).max(16000) })
          .strict(),
      )
      .max(200),
    image: z
      .object({ src: imageSource, alt: z.string().max(1000) })
      .strict()
      .optional(),
    html: z.string().max(200000).optional(),
    previewState: jsonValue.optional(),
    chosenIds: z.array(id).max(200).optional(),
  })
  .strict()
  .superRefine((doc, ctx) => {
    if (
      doc.previewState !== undefined &&
      new TextEncoder().encode(JSON.stringify(doc.previewState)).length > 32768
    )
      ctx.addIssue({ code: 'custom', message: 'Preview state exceeds 32 KiB' });
    const ids = new Set(doc.items.map((item) => item.id));
    if (ids.size !== doc.items.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate item IDs' });
    if (new Set(doc.connections.map((edge) => edge.id)).size !== doc.connections.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate connection IDs' });
    if (new Set(doc.annotations.map((a) => a.id)).size !== doc.annotations.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate annotation IDs' });
    if (doc.connections.some((edge) => !ids.has(edge.from) || !ids.has(edge.to)))
      ctx.addIssue({ code: 'custom', message: 'Connection target is missing' });
    if (
      doc.annotations.some((a) => a.selection.itemIds.some((target) => !ids.has(target))) ||
      doc.chosenIds?.some((target) => !ids.has(target))
    )
      ctx.addIssue({ code: 'custom', message: 'Selection target is missing' });
    if (doc.kind === 'image' && !doc.image)
      ctx.addIssue({ code: 'custom', message: 'Image source is required' });
    if (doc.kind === 'preview' && !doc.html)
      ctx.addIssue({ code: 'custom', message: 'Preview HTML is required' });
  });
export type ArtifactDocument = z.infer<typeof ArtifactDocumentSchema>;

/** Reference embeds resolve within the containing workspace; inline documents are snapshots. */
export const ArtifactBlockSchema = z.union([
  z.object({ noteId: id, artifactId: id }).strict(),
  z.object({ document: ArtifactDocumentSchema }).strict(),
]);
export type ArtifactBlock = z.infer<typeof ArtifactBlockSchema>;

export interface ArtifactSelectionSnapshot {
  version: 1;
  source: { workspaceId: string; noteId?: string; artifactId: string; revision?: number };
  title: string;
  kind: ArtifactDocument['kind'];
  selection: ArtifactSelection;
  items: ArtifactItem[];
  connections: ArtifactDocument['connections'];
  annotations: ArtifactDocument['annotations'];
  image?: ArtifactDocument['image'];
  previewState?: ArtifactJson;
  chosenIds?: string[];
  comment: string;
}
