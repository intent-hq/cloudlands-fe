/**
 * Dependency Resolver
 *
 * Resolves package dependencies and creates execution waves
 * ensuring all dependencies are satisfied before execution.
 */

class DependencyResolver {
  constructor(packages) {
    this.packages = packages;
    this.packageMap = new Map(packages.map(p => [p.id, p]));
    this.resolved = new Set();
    this.waves = [];
  }

  /**
   * Get execution waves based on dependencies
   */
  getExecutionWaves() {
    if (this.waves.length > 0) {
      return this.waves;
    }

    // Build dependency graph
    const graph = this.buildDependencyGraph();

    // Detect cycles
    if (this.hasCycles(graph)) {
      throw new Error('Circular dependencies detected');
    }

    // Create waves using topological sort
    this.waves = this.createWaves(graph);

    return this.waves;
  }

  /**
   * Build dependency graph
   */
  buildDependencyGraph() {
    const graph = new Map();

    for (const pkg of this.packages) {
      graph.set(pkg.id, {
        package: pkg,
        dependencies: new Set(pkg.dependencies || []),
        dependents: new Set()
      });
    }

    // Build reverse dependencies (dependents)
    for (const [id, node] of graph) {
      for (const dep of node.dependencies) {
        const depNode = graph.get(dep);
        if (depNode) {
          depNode.dependents.add(id);
        }
      }
    }

    return graph;
  }

  /**
   * Check for circular dependencies
   */
  hasCycles(graph) {
    const visited = new Set();
    const recursionStack = new Set();

    const hasCycleDFS = (nodeId) => {
      visited.add(nodeId);
      recursionStack.add(nodeId);

      const node = graph.get(nodeId);
      for (const dep of node.dependencies) {
        if (!visited.has(dep)) {
          if (hasCycleDFS(dep)) {
            return true;
          }
        } else if (recursionStack.has(dep)) {
          return true;
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const [nodeId] of graph) {
      if (!visited.has(nodeId)) {
        if (hasCycleDFS(nodeId)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Create execution waves using Kahn's algorithm
   */
  createWaves(graph) {
    const waves = [];
    const inDegree = new Map();
    const queue = [];

    // Calculate in-degrees
    for (const [id, node] of graph) {
      inDegree.set(id, node.dependencies.size);
      if (node.dependencies.size === 0) {
        queue.push(id);
      }
    }

    // Process nodes in waves
    while (queue.length > 0) {
      const currentWave = [...queue];
      queue.length = 0;

      const wavePackages = currentWave.map(id => graph.get(id).package);
      waves.push({
        number: waves.length + 1,
        packages: wavePackages
      });

      // Update in-degrees for dependents
      for (const id of currentWave) {
        const node = graph.get(id);
        for (const dependent of node.dependents) {
          const newDegree = inDegree.get(dependent) - 1;
          inDegree.set(dependent, newDegree);

          if (newDegree === 0) {
            queue.push(dependent);
          }
        }
      }
    }

    // Check if all packages were processed
    const processedCount = waves.reduce((sum, wave) => sum + wave.packages.length, 0);
    if (processedCount !== this.packages.length) {
      throw new Error('Failed to resolve all dependencies - possible circular dependency');
    }

    return waves;
  }

  /**
   * Get dependencies for a package
   */
  getDependencies(packageId) {
    const pkg = this.packageMap.get(packageId);
    return pkg ? pkg.dependencies || [] : [];
  }
}

module.exports = { DependencyResolver };
