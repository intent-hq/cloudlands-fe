import { z } from 'zod';
import { customViewIcons } from './types/custom-views';

const text = (limit: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(limit)
    .refine((s) => !s.includes('\0'));

export const customViewIdSchema = z.object({ id: z.string().uuid() }).strict();
export const customViewInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: text(100),
    directory: text(4096),
    command: text(8192),
    port: z.number().int().min(1024).max(65535),
    icon: z.enum(customViewIcons),
  })
  .strict();

export const savedCustomViewsSchema = z
  .array(customViewInputSchema.extend({ id: z.string().uuid() }))
  .max(100)
  .refine(
    (views) =>
      new Set(views.map((view) => view.id)).size === views.length &&
      new Set(views.map((view) => view.port)).size === views.length,
  );
