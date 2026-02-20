# Ecosystem Visualizer

A circle-packing visualization for displaying file system hierarchies as nested circles.

## Architecture

### Files

- **`EcosystemCanvas.svelte`** - Main Svelte component with Canvas 2D rendering
- **`force-simulation.ts`** - D3 pack layout + force simulation for spreading folders
- **`tree-processor.ts`** - Converts file tree data to ProcessedNode hierarchy
- **`blob-shapes.ts`** - Generates organic blob shapes for folder boundaries
- **`language-colors.ts`** - Maps file extensions to colors (TypeScript=blue, etc.)
- **`types.ts`** - TypeScript interfaces and default settings
- **`sample-data.ts`** - Mock file tree for testing
- **`index.ts`** - Barrel exports

## Layout Algorithm

### 1. Tree Processing (`tree-processor.ts`)

Converts raw file tree nodes into `ProcessedNode` objects:
- Assigns unique IDs and parent references
- Calculates file sizes for radius scaling
- Determines language colors from extensions
- Builds hierarchical children arrays

### 2. Circle Packing (`force-simulation.ts`)

Uses D3's `pack()` layout for deterministic circle packing:

1. **Build hierarchy** - Creates nested structure with virtual root
2. **Pack layout** - D3 assigns x, y, r to each node
3. **Scale to viewport** - Uniform scaling to fit available space
4. **Force spreading** - In landscape mode, spreads top-level folders horizontally

### 3. Force Simulation for Spreading

When viewport is landscape (aspect ratio > 1.2):
- Runs a D3 force simulation on top-level folders only
- `forceX` pulls folders toward evenly-spaced horizontal positions
- `forceY` keeps folders centered vertically
- `forceCollide` prevents overlaps
- Children move with their parent folder

```typescript
const simulation = forceSimulation(topLevelNodes)
  .force('x', forceX(targetX).strength(0.8))
  .force('y', forceY(centerY).strength(0.3))
  .force('collide', forceCollide(d => d.r + 15).strength(1))
```

### 4. Rendering (`EcosystemCanvas.svelte`)

Canvas 2D rendering with:
- Blob shapes for folder boundaries (organic look)
- Colored circles for files
- Pan/zoom via mouse drag and wheel
- Hover detection for tooltips

## Key Types

```typescript
interface ProcessedNode {
  id: string;
  name: string;
  isFolder: boolean;
  x: number;           // Position after layout
  y: number;
  r: number;           // Radius
  color?: string;      // Language color for files
  parent?: ProcessedNode;
  children?: ProcessedNode[];
}

interface EcosystemSettings {
  folderPadding: number;      // Space around folder contents
  minFileRadius: number;      // Minimum file circle size
  collisionPadding: number;   // Gap between siblings
  spacingBuffer: number;      // Extra breathing room
  hullExpansion: number;      // Blob shape expansion
}
```

## Sandbox Testing

Test the visualizer at: `http://localhost:5178/sandbox/ecosystem`

Run with: `npm run dev:cdp`

Note: Sandbox runs in browser context without Electron IPC.

## Debug Logging

Force simulation logs to console:
- `[Force] Spread check:` - Shows aspect ratio, landscape detection, folder count
- `[Force] Running simulation with targets:` - Target X positions
- `[Force] After simulation:` - Final positions vs original

## Known Issues / TODOs

1. Force simulation may not spread aggressively enough - adjust forceX strength
2. Large codebases may have performance issues with Canvas rendering
3. Zoom/pan state resets on data changes
