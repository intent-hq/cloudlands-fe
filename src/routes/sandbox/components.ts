import { m } from '$shared/paraglide/messages.js';

export interface SandboxComponent {
  slug: string;
  name: string;
  description: string;
}

export const sandboxComponents: SandboxComponent[] = [
  {
    slug: 'directory-picker',
    get name() {
      return m.sandbox_directoryPicker_title();
    },
    get description() {
      return m.sandbox_directoryPicker_navDescription_description();
    },
  },
  {
    slug: 'proposal-card',
    name: 'Proposal Card',
    description: 'Inline-editable proposal card used in Chief chat',
  },
];
