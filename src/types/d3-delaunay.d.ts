declare module 'd3-delaunay' {
  // Minimal type shim to satisfy TypeScript without installing @types/d3-delaunay.
  // Only the subset used by Tree.svelte and blob-shapes.ts is typed here.

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export class Voronoi<T = [number, number]> {
    cellPolygon(i: number): [number, number][] | null;
  }

  export class Delaunay<T = [number, number]> {
    static from(points: ArrayLike<[number, number]>): Delaunay<[number, number]>;
    find(x: number, y: number, i?: number): number;
    voronoi(bounds?: [number, number, number, number]): Voronoi<T>;
  }
}

