import type { ElectronApplication } from '@playwright/test';

// TEST ONLY: the first evaluate argument is Electron, not the serialized query.
// Adapted from Diff 8b0e8cfc; the oracle stays in the supervisor process.
export function readPersistedPage(
  app: ElectronApplication,
  kind: string,
  start: number,
  limit = 16,
) {
  return app.evaluate(
    (_electron, { kind, start, limit }) =>
      (globalThis as any).persistedPaint.read(kind, start, limit),
    { kind, start, limit },
  );
}

export function comparePersistedOracle(
  app: ElectronApplication,
  camera: number,
  clip?: { x: number; y: number; width: number; height: number },
) {
  return app.evaluate(
    (_electron, { camera, clip }) => (globalThis as any).persistedPaint.compareOracle(camera, clip),
    { camera, clip },
  );
}
