export const intentMarkVariants = ['bloom', 'pulse', 'twist'] as const;
export type IntentMarkVariant = (typeof intentMarkVariants)[number];
