import FaWrapper from './FaWrapper.svelte';

// Export as both named and default
export { FaWrapper as Fa };
export default FaWrapper;

// Re-export named layers from original package entry
export { FaLayers, FaLayersText } from 'svelte-fa-original';
