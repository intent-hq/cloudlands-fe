import { z } from 'zod';

const uiComponentCategorySchema = z.enum([
  'primitive',
  'pattern',
  'product',
  'deprecated-wrapper',
  'deletion-candidate',
]);

const uiComponentFixtureSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  states: z.array(z.string().min(1)).min(1),
  themes: z.array(z.enum(['light', 'dark', 'system', 'high-contrast'])).optional(),
  viewport: z.enum(['compact', 'desktop', 'both']).optional(),
  reducedMotion: z.boolean().optional(),
});

const pathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.includes('\\'), {
    message: 'use a repository-relative POSIX path',
  });

const uiComponentMetadataSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    source: pathSchema,
    publicImport: z.string().startsWith('$lib/components/ui/'),
    legacyImports: z.array(z.string().startsWith('$lib/components/ui/')).default([]),
    exports: z.array(z.string().min(1)).min(1),
    category: uiComponentCategorySchema,
    owner: z.string().min(1),
    callers: z.array(pathSchema),
    replacement: z.string().min(1).nullable(),
    characterizationTest: pathSchema.nullable(),
    removalGate: z.string().min(1),
    dynamicImports: z.array(pathSchema),
    fixtures: z.array(uiComponentFixtureSchema),
  })
  .superRefine((record, context) => {
    if (!['deprecated-wrapper', 'deletion-candidate'].includes(record.category)) return;
    if (!record.replacement) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['replacement'],
        message: 'deprecated and deletion records require a canonical replacement or deletion plan',
      });
    }
    if (!record.characterizationTest) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['characterizationTest'],
        message: 'deprecated and deletion records require a characterization test',
      });
    }
    if (!record.removalGate.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['removalGate'],
        message: 'deprecated and deletion records require a measurable removal gate',
      });
    }
  });

const uiComponentFolderTemplateSchema = z.object({
  implementation: z.string().min(1),
  publicModule: z.string().min(1),
  metadata: z.string().min(1),
  behavioralTest: z.string().min(1),
  fixture: z.string().min(1),
  variantRecipe: z.string().min(1).optional(),
});

const uiDependencyRuleSchema = z.object({
  layer: z.enum(['primitive', 'pattern', 'product']),
  allowed: z.array(z.string().min(1)).min(1),
  forbidden: z.array(z.string().min(1)),
  repair: z.string().min(1),
});

const uiComponentInventorySchema = z.object({
  version: z.literal(1),
  folderTemplate: uiComponentFolderTemplateSchema,
  dependencyRules: z.array(uiDependencyRuleSchema).length(3),
  components: z.array(uiComponentMetadataSchema).min(1),
});

export type UiComponentCategory = z.infer<typeof uiComponentCategorySchema>;
export type UiComponentFixture = z.infer<typeof uiComponentFixtureSchema>;
export type UiComponentMetadata = z.infer<typeof uiComponentMetadataSchema>;
export type UiComponentInventory = z.infer<typeof uiComponentInventorySchema>;

function formatSchemaError(scope: string, error: z.ZodError): Error {
  const id = error.issues.find((issue) => issue.path[0] === 'id');
  const repairPath = error.issues
    .map((issue) => `${issue.path.join('.') || scope}: ${issue.message}`)
    .join('; ');
  return new Error(`${scope}${id ? ` (${id.message})` : ''}: ${repairPath}`);
}

export function parseUiComponentMetadata(value: unknown): UiComponentMetadata {
  const result = uiComponentMetadataSchema.safeParse(value);
  if (!result.success) {
    const recordId =
      typeof value === 'object' && value !== null && 'id' in value ? String(value.id) : 'unknown';
    throw formatSchemaError(`UI component ${recordId}`, result.error);
  }
  return result.data;
}

export function parseUiComponentInventory(value: unknown): UiComponentInventory {
  const result = uiComponentInventorySchema.safeParse(value);
  if (!result.success) throw formatSchemaError('UI component inventory', result.error);
  return result.data;
}
