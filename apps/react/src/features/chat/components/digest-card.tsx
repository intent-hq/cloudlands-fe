// Source: src/lib/components/chat/DigestCard.svelte.
export interface DigestCardProps {
  digest: string;
}

export function DigestCard({ digest }: DigestCardProps) {
  return (
    <div className="digest-card flex items-start gap-2.5 py-5 px-6 my-4 shadow-xs text-base leading-normal border border-border">
      {digest}
    </div>
  );
}

export default DigestCard;
