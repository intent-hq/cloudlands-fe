import { z } from 'zod';
import type { TokenUsage } from './token-usage-types';

const TokenUsageCostSchema = z
  .object({
    amount: z.number().finite(),
    currency: z.string().min(1),
  })
  .passthrough();

const TokenUsageTotalsSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative(),
    cacheCreationTokens: z.number().int().nonnegative(),
    thoughtTokens: z.number().int().nonnegative().optional(),
    cost: TokenUsageCostSchema.optional(),
  })
  .passthrough();

const TokenUsageCrossFilterRowSchema = z
  .object({
    agentId: z.string().min(1),
    model: z.string().min(1),
    totals: TokenUsageTotalsSchema,
    humanMessages: z.number().int().nonnegative(),
    agentMessages: z.number().int().nonnegative(),
  })
  .passthrough();

const TokenUsageCrossFilterRowsSchema = z
  .array(TokenUsageCrossFilterRowSchema)
  .superRefine((rows, context) => {
    let previousKey: string | undefined;
    for (const [index, row] of rows.entries()) {
      const key = `${row.agentId}\0${row.model}`;
      if (previousKey !== undefined && key <= previousKey) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'byAgentModel rows must be unique and sorted by agentId, then model',
          path: [index],
        });
      }
      previousKey = key;
    }
  });

export const TokenUsageSchema = z
  .object({
    byAgentId: z.record(TokenUsageTotalsSchema),
    totals: TokenUsageTotalsSchema,
    byModel: z.record(TokenUsageTotalsSchema),
    byAgentModel: TokenUsageCrossFilterRowsSchema.optional(),
    lastScanAt: z.string().datetime({ offset: true }).nullable(),
  })
  .passthrough();

export function parseTokenUsage(data: unknown): TokenUsage {
  return TokenUsageSchema.parse(data) as TokenUsage;
}

export function safeParseTokenUsage(data: unknown): TokenUsage | null {
  const parsed = TokenUsageSchema.safeParse(data);
  return parsed.success ? (parsed.data as TokenUsage) : null;
}
