import { z } from 'zod';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';

const fixtureSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  states: z.array(z.string().min(1)).min(1),
  themes: z.array(z.enum(['light', 'dark', 'system', 'high-contrast'])).optional(),
  viewport: z.enum(['compact', 'desktop', 'both']).optional(),
  reducedMotion: z.boolean().optional(),
});

const patternMetadataSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  source: z.string().startsWith('src/lib/components/patterns/'),
  publicImport: z.string().startsWith('$lib/components/patterns/'),
  exports: z.array(z.string().min(1)).min(1),
  owner: z.string().min(1),
  fixtures: z.array(fixtureSchema).min(1),
  useWhen: z.array(z.string().min(1)).min(1),
  dontUseWhen: z.array(z.string().min(1)).min(1),
  replaces: z.array(z.string().min(1)),
});

export interface PatternMetadata {
  id: string;
  source: string;
  publicImport: string;
  exports: string[];
  owner: string;
  fixtures: UiComponentFixture[];
  useWhen: string[];
  dontUseWhen: string[];
  replaces: string[];
}

export function parsePatternMetadata(value: unknown): PatternMetadata {
  return patternMetadataSchema.parse(value) as PatternMetadata;
}
