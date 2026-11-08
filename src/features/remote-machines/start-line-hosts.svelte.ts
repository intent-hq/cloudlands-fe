/**
 * Counts the chat working rows that show a cloud machine's start line, so the
 * conversation notice leaves it out while one does (and keeps it otherwise).
 */
export class StartLineHosts {
  #count = $state(0);

  get shown(): boolean {
    return this.#count > 0;
  }

  register = (): (() => void) => {
    this.#count += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#count -= 1;
    };
  };
}
