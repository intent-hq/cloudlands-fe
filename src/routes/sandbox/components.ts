export interface SandboxComponent {
  slug: string;
  name: string;
  description: string;
}

export const sandboxComponents: SandboxComponent[] = [
  {
    slug: 'proposal-card',
    name: 'Proposal Card',
    description: 'Inline-editable proposal card used in Chief chat',
  },
];
