/**
 * Ecosystem Visualizer - Organic force-based codebase visualization
 */

export { default as EcosystemCanvas } from './EcosystemCanvas.svelte';
export { sampleData, generateLargeSampleData } from './sample-data';
export * from './types';
export { processTree, getLeafNodes, getFolderNodes, findNodeAtPosition } from './tree-processor';
export { runForceSimulation } from './force-simulation';
export { computeBlobShapes, drawBlobToCanvas, createBlobPath } from './blob-shapes';
export { default as languageColors, getColorForExtension } from './language-colors';
