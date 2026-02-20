import { goto } from '$app/navigation';

class PaletteStore {
  isOpen = $state(false);
  query = $state('');

  open() {
    this.isOpen = true;
    this.query = '';
  }

  close() {
    this.isOpen = false;
    this.query = '';
  }

  setQuery(q: string) {
    this.query = q;
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  exec(action: { type: 'open-palette'; mode?: any } | { type: 'navigate'; href: string }) {
    if (action.type === 'open-palette') {
      // Ignore legacy mode; unified palette now
      this.open();
      return;
    }
    if (action.type === 'navigate') {
      goto(action.href);
      return;
    }
  }
}

export const paletteStore = new PaletteStore();
