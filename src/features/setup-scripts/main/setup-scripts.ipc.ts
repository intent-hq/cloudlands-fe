/**
 * Setup Scripts IPC Handlers
 *
 * Handles template-based setup script generation and project type detection.
 * AI-assisted generation lives on the intentd daemon
 * (`workspace.generateSetupScript`, PROTOCOL §5.25) and is reached through the
 * AppClient seam — the former local AugmentCLI streaming path was retired.
 */

import { ipcMain } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';
import { Logger } from '../../../shared/logger';
import { m } from '../../../shared/paraglide/messages.js';
import type { ProjectType } from '../types';
import { SETUP_SCRIPT_TEMPLATES, getTemplateContent } from '../types';

const logger = new Logger('SetupScriptsIPC');

interface ProjectAnalysis {
  projectType: ProjectType;
  packageManager?: string;
  gitIgnoredFiles: string[];
  suggestions: string[];
}

/**
 * Detect project type from files in a repository
 */
async function detectProjectType(repoPath: string): Promise<ProjectAnalysis> {
  const analysis: ProjectAnalysis = {
    projectType: 'generic',
    gitIgnoredFiles: [],
    suggestions: [],
  };

  try {
    const files = await fs.readdir(repoPath);

    // Check for Node.js projects
    if (files.includes('package.json')) {
      const packageJsonPath = path.join(repoPath, 'package.json');
      try {
        // Parse to validate JSON; the parsed result is unused — we only detect the package manager from lock files
        JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));

        // Detect package manager
        if (files.includes('pnpm-lock.yaml')) {
          analysis.projectType = 'node-pnpm';
          analysis.packageManager = 'pnpm';
        } else if (files.includes('yarn.lock')) {
          analysis.projectType = 'node-yarn';
          analysis.packageManager = 'yarn';
        } else {
          analysis.projectType = 'node-npm';
          analysis.packageManager = 'npm';
        }
      } catch {
        analysis.projectType = 'node-npm';
      }
    }

    // Check for Python projects
    if (files.includes('requirements.txt')) {
      analysis.projectType = 'python-pip';
    } else if (files.includes('pyproject.toml')) {
      const pyprojectPath = path.join(repoPath, 'pyproject.toml');
      try {
        const content = await fs.readFile(pyprojectPath, 'utf-8');
        if (content.includes('[tool.poetry]')) {
          analysis.projectType = 'python-poetry';
        } else {
          analysis.projectType = 'python-pip';
        }
      } catch {
        analysis.projectType = 'python-pip';
      }
    }

    // Check for Go projects
    if (files.includes('go.mod')) {
      analysis.projectType = 'go';
    }

    // Check for Rust projects
    if (files.includes('Cargo.toml')) {
      analysis.projectType = 'rust';
    }

    // Check for Ruby projects
    if (files.includes('Gemfile')) {
      analysis.projectType = 'ruby';
    }

    // Find gitignored files that might need copying
    const commonEnvFiles = ['.env', '.env.local', '.env.development', '.env.development.local'];
    for (const envFile of commonEnvFiles) {
      const envPath = path.join(repoPath, envFile);
      try {
        await fs.access(envPath);
        analysis.gitIgnoredFiles.push(envFile);
      } catch {
        // File doesn't exist
      }
    }

    // Add suggestions based on analysis
    if (analysis.gitIgnoredFiles.length > 0) {
      analysis.suggestions.push(
        m.setupScripts_ipc_copySuggestion_message({ files: analysis.gitIgnoredFiles.join(', ') }),
      );
    }
    if (analysis.packageManager) {
      analysis.suggestions.push(
        m.setupScripts_ipc_installSuggestion_message({ packageManager: analysis.packageManager }),
      );
    }
  } catch (error) {
    logger.error('Failed to analyze project', error as Error);
  }

  return analysis;
}

/**
 * Generate a setup script based on project analysis.
 * Uses the matching template content which references $MAIN_CHECKOUT for env file copying.
 */
function generateScript(analysis: ProjectAnalysis): string {
  // Find matching template, fall back to generic
  const template =
    SETUP_SCRIPT_TEMPLATES.find((t) => t.projectType === analysis.projectType) ??
    SETUP_SCRIPT_TEMPLATES.find((t) => t.projectType === 'generic');

  if (template) {
    return getTemplateContent(template);
  }

  return '';
}

export function registerSetupScriptsHandlers(): void {
  // Generate setup script for a repository
  ipcMain.handle('setup-scripts:generate', async (_event, { repoPath }: { repoPath: string }) => {
    try {
      logger.info('Generating setup script', { repoPath });

      const analysis = await detectProjectType(repoPath);
      const script = generateScript(analysis);

      logger.info('Setup script generated', {
        repoPath,
        projectType: analysis.projectType,
        envFilesFound: analysis.gitIgnoredFiles.length,
      });

      return {
        success: true,
        data: {
          script,
          projectType: analysis.projectType,
          analysis,
        },
      };
    } catch (error) {
      logger.error('Failed to generate setup script', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : m.setupScripts_ipc_unknown_error(),
      };
    }
  });

  // Detect project type only (without generating script)
  ipcMain.handle(
    'setup-scripts:detect-type',
    async (_event, { repoPath }: { repoPath: string }) => {
      try {
        const analysis = await detectProjectType(repoPath);
        return { success: true, data: analysis };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : m.setupScripts_ipc_unknown_error(),
        };
      }
    },
  );

  logger.info('Setup scripts IPC handlers registered');
}
