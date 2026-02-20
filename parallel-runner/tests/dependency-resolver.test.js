/**
 * Tests for Dependency Resolver
 */

const { DependencyResolver } = require('../lib/core/dependency-resolver');

describe('DependencyResolver', () => {
  describe('getExecutionWaves', () => {
    it('should handle packages with no dependencies', () => {
      const packages = [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' }
      ];

      const resolver = new DependencyResolver(packages);
      const waves = resolver.getExecutionWaves();

      expect(waves).toHaveLength(1);
      expect(waves[0].packages).toHaveLength(3);
    });

    it('should create waves based on dependencies', () => {
      const packages = [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B', dependencies: ['a'] },
        { id: 'c', name: 'C', dependencies: ['b'] }
      ];

      const resolver = new DependencyResolver(packages);
      const waves = resolver.getExecutionWaves();

      expect(waves).toHaveLength(3);
      expect(waves[0].packages[0].id).toBe('a');
      expect(waves[1].packages[0].id).toBe('b');
      expect(waves[2].packages[0].id).toBe('c');
    });

    it('should handle complex dependencies', () => {
      const packages = [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C', dependencies: ['a', 'b'] },
        { id: 'd', name: 'D', dependencies: ['a'] },
        { id: 'e', name: 'E', dependencies: ['c', 'd'] }
      ];

      const resolver = new DependencyResolver(packages);
      const waves = resolver.getExecutionWaves();

      expect(waves).toHaveLength(3);
      expect(waves[0].packages).toHaveLength(2); // a, b
      expect(waves[1].packages).toHaveLength(2); // c, d
      expect(waves[2].packages).toHaveLength(1); // e
    });

    it('should detect circular dependencies', () => {
      const packages = [
        { id: 'a', name: 'A', dependencies: ['b'] },
        { id: 'b', name: 'B', dependencies: ['a'] }
      ];

      const resolver = new DependencyResolver(packages);

      expect(() => resolver.getExecutionWaves()).toThrow('Circular dependencies detected');
    });

    it('should detect indirect circular dependencies', () => {
      const packages = [
        { id: 'a', name: 'A', dependencies: ['c'] },
        { id: 'b', name: 'B', dependencies: ['a'] },
        { id: 'c', name: 'C', dependencies: ['b'] }
      ];

      const resolver = new DependencyResolver(packages);

      expect(() => resolver.getExecutionWaves()).toThrow('Circular dependencies detected');
    });
  });

  describe('getDependencies', () => {
    it('should return dependencies for a package', () => {
      const packages = [
        { id: 'a', name: 'A', dependencies: ['b', 'c'] },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' }
      ];

      const resolver = new DependencyResolver(packages);

      expect(resolver.getDependencies('a')).toEqual(['b', 'c']);
      expect(resolver.getDependencies('b')).toEqual([]);
      expect(resolver.getDependencies('unknown')).toEqual([]);
    });
  });
});
