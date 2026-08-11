let pendingChiefThreadCreation: Promise<string> | null = null;

/** Share one Chief-thread launch across the hover card and combined panel hosts. */
export function ensureChiefThreadCreation(create: () => Promise<string>): Promise<string> {
  if (pendingChiefThreadCreation) return pendingChiefThreadCreation;

  const creation = Promise.resolve().then(create);
  const trackedCreation = creation.finally(() => {
    if (pendingChiefThreadCreation === trackedCreation) {
      pendingChiefThreadCreation = null;
    }
  });

  pendingChiefThreadCreation = trackedCreation;
  return trackedCreation;
}
