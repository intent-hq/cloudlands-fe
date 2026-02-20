/**
 * Sample file tree data for the ecosystem visualizer sandbox
 * Represents a realistic web application codebase
 */

import type { FileNode } from './types';

/**
 * Generate a large sample dataset for stress testing
 * Creates a realistic codebase structure with many files
 */
export function generateLargeSampleData(numFiles: number = 500, maxDepth: number = 6): FileNode {
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.svelte', '.css', '.json', '.md'];
  const folderNames = [
    'components',
    'hooks',
    'utils',
    'services',
    'stores',
    'types',
    'api',
    'features',
    'pages',
    'layouts',
    'widgets',
    'shared',
    'core',
    'lib',
    'modules',
    'helpers',
    'constants',
    'config',
    'assets',
    'styles',
  ];
  const fileNames = [
    'index',
    'main',
    'app',
    'utils',
    'helpers',
    'types',
    'constants',
    'Button',
    'Input',
    'Modal',
    'Card',
    'List',
    'Table',
    'Form',
    'Header',
    'Footer',
    'Sidebar',
    'Nav',
    'Menu',
    'Dropdown',
    'useAuth',
    'useData',
    'useForm',
    'useState',
    'useEffect',
    'api',
    'fetch',
    'request',
    'client',
    'server',
    'handler',
    'store',
    'reducer',
    'action',
    'selector',
    'slice',
    'schema',
    'model',
    'entity',
    'dto',
    'validator',
  ];

  let fileCount = 0;
  const usedPaths = new Set<string>();

  function randomChoice<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function randomSize(): number {
    // File sizes follow a power law distribution
    const base = Math.random();
    return Math.floor(200 + Math.pow(base, 0.3) * 8000);
  }

  function generateUniqueFileName(basePath: string): { name: string; path: string } | null {
    const ext = randomChoice(extensions);
    let fileName = randomChoice(fileNames) + ext;
    let filePath = basePath ? `${basePath}/${fileName}` : fileName;

    // Try to find a unique name
    let attempt = 0;
    while (usedPaths.has(filePath) && attempt < 100) {
      fileName = `${randomChoice(fileNames)}_${Math.floor(Math.random() * 10000)}${ext}`;
      filePath = basePath ? `${basePath}/${fileName}` : fileName;
      attempt++;
    }

    if (usedPaths.has(filePath)) return null;
    usedPaths.add(filePath);
    return { name: fileName, path: filePath };
  }

  // Build the folder structure first
  interface FolderInfo {
    node: FileNode;
    depth: number;
    path: string;
  }

  const root: FileNode = {
    name: 'large-project',
    path: '',
    size: 0,
    children: [],
  };

  const allFolders: FolderInfo[] = [{ node: root, depth: 0, path: '' }];

  // Create folder structure - aim for a reasonable number of folders
  const targetFolders = Math.min(Math.ceil(numFiles / 8), 200); // ~8 files per folder on average
  let folderIndex = 0;

  while (allFolders.length < targetFolders && folderIndex < allFolders.length) {
    const parent = allFolders[folderIndex];

    if (parent.depth < maxDepth - 1) {
      // Add 2-5 subfolders to this folder
      const numSubfolders = Math.floor(Math.random() * 4) + 2;
      const usedNames = new Set<string>();

      for (let i = 0; i < numSubfolders && allFolders.length < targetFolders; i++) {
        let folderName = randomChoice(folderNames);
        let attempt = 0;
        while (usedNames.has(folderName) && attempt < 20) {
          folderName = `${randomChoice(folderNames)}_${Math.floor(Math.random() * 100)}`;
          attempt++;
        }

        if (!usedNames.has(folderName)) {
          usedNames.add(folderName);
          const subPath = parent.path ? `${parent.path}/${folderName}` : folderName;
          const subFolder: FileNode = {
            name: folderName,
            path: subPath,
            size: 0,
            children: [],
          };
          parent.node.children!.push(subFolder);
          allFolders.push({ node: subFolder, depth: parent.depth + 1, path: subPath });
        }
      }
    }

    folderIndex++;
  }

  // Now distribute files across all folders
  // First, ensure each folder has at least 1 file
  for (const folder of allFolders) {
    if (fileCount >= numFiles) break;

    const file = generateUniqueFileName(folder.path);
    if (file) {
      folder.node.children!.push({
        name: file.name,
        path: file.path,
        size: randomSize(),
      });
      fileCount++;
    }
  }

  // Then distribute remaining files randomly across folders
  while (fileCount < numFiles) {
    const folder = randomChoice(allFolders);
    const file = generateUniqueFileName(folder.path);
    if (file) {
      folder.node.children!.push({
        name: file.name,
        path: file.path,
        size: randomSize(),
      });
      fileCount++;
    }
  }

  // Calculate folder sizes recursively
  function calculateSize(node: FileNode): number {
    if (!node.children || node.children.length === 0) {
      return node.size;
    }
    node.size = node.children.reduce((sum, child) => sum + calculateSize(child), 0);
    return node.size;
  }
  calculateSize(root);

  return root;
}

export const sampleData: FileNode = {
  name: 'my-project',
  path: '',
  size: 0,
  children: [
    {
      name: 'src',
      path: 'src',
      size: 0,
      children: [
        {
          name: 'components',
          path: 'src/components',
          size: 0,
          children: [
            {
              name: 'ui',
              path: 'src/components/ui',
              size: 0,
              children: [
                { name: 'Button.tsx', path: 'src/components/Button.tsx', size: 2500 },
                { name: 'Input.tsx', path: 'src/components/Input.tsx', size: 1800 },
                { name: 'Card.tsx', path: 'src/components/Card.tsx', size: 1200 },
                { name: 'Badge.tsx', path: 'src/components/ui/Badge.tsx', size: 600 },
                { name: 'Avatar.tsx', path: 'src/components/ui/Avatar.tsx', size: 900 },
              ],
            },
            {
              name: 'layout',
              path: 'src/components/layout',
              size: 0,
              children: [
                { name: 'Header.tsx', path: 'src/components/layout/Header.tsx', size: 2200 },
                { name: 'Sidebar.tsx', path: 'src/components/layout/Sidebar.tsx', size: 3100 },
                { name: 'Footer.tsx', path: 'src/components/layout/Footer.tsx', size: 800 },
              ],
            },
            { name: 'Modal.tsx', path: 'src/components/Modal.tsx', size: 3200 },
            { name: 'Table.tsx', path: 'src/components/Table.tsx', size: 4500 },
            { name: 'Select.tsx', path: 'src/components/Select.tsx', size: 2100 },
            { name: 'Tooltip.tsx', path: 'src/components/Tooltip.tsx', size: 900 },
          ],
        },
        {
          name: 'hooks',
          path: 'src/hooks',
          size: 0,
          children: [
            { name: 'useAuth.ts', path: 'src/hooks/useAuth.ts', size: 1500 },
            { name: 'useData.ts', path: 'src/hooks/useData.ts', size: 2200 },
            { name: 'useForm.ts', path: 'src/hooks/useForm.ts', size: 1800 },
            { name: 'useDebounce.ts', path: 'src/hooks/useDebounce.ts', size: 400 },
            { name: 'useMediaQuery.ts', path: 'src/hooks/useMediaQuery.ts', size: 600 },
          ],
        },
        {
          name: 'utils',
          path: 'src/utils',
          size: 0,
          children: [
            { name: 'format.ts', path: 'src/utils/format.ts', size: 800 },
            { name: 'validate.ts', path: 'src/utils/validate.ts', size: 1100 },
            { name: 'api.ts', path: 'src/utils/api.ts', size: 2500 },
            { name: 'cn.ts', path: 'src/utils/cn.ts', size: 200 },
          ],
        },
        {
          name: 'stores',
          path: 'src/stores',
          size: 0,
          children: [
            { name: 'user.ts', path: 'src/stores/user.ts', size: 1200 },
            { name: 'theme.ts', path: 'src/stores/theme.ts', size: 600 },
            { name: 'notifications.ts', path: 'src/stores/notifications.ts', size: 900 },
          ],
        },
        { name: 'App.tsx', path: 'src/App.tsx', size: 4000 },
        { name: 'main.tsx', path: 'src/main.tsx', size: 500 },
        { name: 'index.css', path: 'src/index.css', size: 1200 },
      ],
    },
    {
      name: 'lib',
      path: 'lib',
      size: 0,
      children: [
        { name: 'core.ts', path: 'lib/core.ts', size: 5500 },
        { name: 'types.ts', path: 'lib/types.ts', size: 2000 },
        { name: 'constants.ts', path: 'lib/constants.ts', size: 600 },
        {
          name: 'services',
          path: 'lib/services',
          size: 0,
          children: [
            { name: 'auth.ts', path: 'lib/services/auth.ts', size: 3200 },
            { name: 'database.ts', path: 'lib/services/database.ts', size: 4800 },
            { name: 'cache.ts', path: 'lib/services/cache.ts', size: 1500 },
            { name: 'analytics.ts', path: 'lib/services/analytics.ts', size: 1100 },
          ],
        },
      ],
    },
    {
      name: 'tests',
      path: 'tests',
      size: 0,
      children: [
        { name: 'setup.ts', path: 'tests/setup.ts', size: 400 },
        { name: 'Button.test.tsx', path: 'tests/Button.test.tsx', size: 1200 },
        { name: 'Modal.test.tsx', path: 'tests/Modal.test.tsx', size: 1800 },
        { name: 'api.test.ts', path: 'tests/api.test.ts', size: 2500 },
        { name: 'auth.test.ts', path: 'tests/auth.test.ts', size: 2000 },
      ],
    },
    { name: 'package.json', path: 'package.json', size: 1500 },
    { name: 'tsconfig.json', path: 'tsconfig.json', size: 800 },
    { name: 'vite.config.ts', path: 'vite.config.ts', size: 600 },
    { name: 'README.md', path: 'README.md', size: 3000 },
    { name: '.gitignore', path: '.gitignore', size: 200 },
  ],
};
