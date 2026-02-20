/**
 * Configuration Parser
 *
 * Parses and validates YAML configuration files for parallel agent runs.
 * Supports templates, variable substitution, and dependency resolution.
 */

const yaml = require('js-yaml');
const fs = require('fs').promises;
const path = require('path');
const { Logger } = require('../utils/logger');

class ConfigParser {
  constructor() {
    this.logger = new Logger('ConfigParser');
    this.templates = new Map();
    this.loadBuiltInTemplates();
  }

  /**
   * Load built-in templates
   */
  async loadBuiltInTemplates() {
    const templatesDir = path.join(__dirname, '../../templates');
    try {
      const files = await fs.readdir(templatesDir);
      for (const file of files) {
        if (file.endsWith('.yaml')) {
          const content = await fs.readFile(path.join(templatesDir, file), 'utf8');
          const template = yaml.load(content);
          this.templates.set(path.basename(file, '.yaml'), template);
        }
      }
    } catch (error) {
      // Templates directory might not exist yet
      this.logger.debug('No templates directory found');
    }
  }

  /**
   * Parse a configuration file
   */
  async parse(configPath) {
    try {
      const content = await fs.readFile(configPath, 'utf8');
      let config = yaml.load(content);

      // Apply defaults
      config = this.applyDefaults(config);

      // Load and apply templates
      if (config.templates) {
        config = await this.applyTemplates(config);
      }

      // Process packages
      config.packages = this.processPackages(config.packages, config);

      // Resolve variables
      config = this.resolveVariables(config);

      return config;

    } catch (error) {
      this.logger.error(`Failed to parse config: ${error.message}`);
      throw error;
    }
  }

  /**
   * Apply default values
   */
  applyDefaults(config) {
    const configDefaults = {
      maxParallel: 4,
      timeoutMinutes: 30,
      autoRetry: true,
      retryAttempts: 3,
      continueOnError: false,
      runTests: false,
      ...(config.config || {})
    };

    return {
      ...config,
      // Flatten config values to top level for easier access
      maxParallel: configDefaults.maxParallel,
      timeoutMinutes: configDefaults.timeoutMinutes,
      autoRetry: configDefaults.autoRetry,
      retryAttempts: configDefaults.retryAttempts,
      continueOnError: configDefaults.continueOnError,
      runTests: configDefaults.runTests,
      // Keep nested config for backward compatibility
      config: configDefaults,
      model: config.model || 'claude-3-5-sonnet-20241022',
      consolidation: config.consolidation !== false
    };
  }

  /**
   * Apply templates to configuration
   */
  async applyTemplates(config) {
    for (const templateName of config.templates) {
      const template = this.templates.get(templateName);
      if (!template) {
        this.logger.warning(`Template not found: ${templateName}`);
        continue;
      }

      // Merge template into config
      config = this.mergeTemplate(config, template);
    }

    return config;
  }

  /**
   * Merge template into configuration
   */
  mergeTemplate(config, template) {
    // Merge prompts
    if (template.prompts) {
      config.prompts = [...(config.prompts || []), ...template.prompts];
    }

    // Merge package defaults
    if (template.packageDefaults) {
      config.packageDefaults = {
        ...template.packageDefaults,
        ...config.packageDefaults
      };
    }

    // Merge config
    if (template.config) {
      config.config = {
        ...template.config,
        ...config.config
      };
    }

    return config;
  }

  /**
   * Process packages with defaults and prompts
   */
  processPackages(packages, config) {
    return packages.map(pkg => {
      // Apply package defaults
      if (config.packageDefaults) {
        pkg = { ...config.packageDefaults, ...pkg };
      }

      // Build prompts for package
      if (config.prompts) {
        pkg.prompts = this.buildPackagePrompts(pkg, config.prompts);
      }

      // Ensure required fields
      if (!pkg.id) {
        throw new Error(`Package missing required field 'id': ${JSON.stringify(pkg)}`);
      }

      if (!pkg.name) {
        pkg.name = pkg.id;
      }

      return pkg;
    });
  }

  /**
   * Build prompts for a package
   */
  buildPackagePrompts(pkg, promptTemplates) {
    return promptTemplates.map(promptTemplate => {
      let prompt = promptTemplate.template || promptTemplate.prompt || promptTemplate;

      // Replace variables
      prompt = prompt.replace(/{package_id}/g, pkg.id);
      prompt = prompt.replace(/{package_name}/g, pkg.name);
      prompt = prompt.replace(/{package_description}/g, pkg.description || '');
      prompt = prompt.replace(/{title}/g, pkg.name);
      prompt = prompt.replace(/{description}/g, pkg.description || '');

      return {
        name: promptTemplate.name || 'default',
        prompt
      };
    });
  }

  /**
   * Resolve variables in configuration
   */
  resolveVariables(config) {
    const vars = {
      timestamp: new Date().toISOString().replace(/[:.]/g, '-'),
      date: new Date().toISOString().split('T')[0],
      ...config.variables
    };

    // Recursively replace variables
    const resolve = (obj) => {
      if (typeof obj === 'string') {
        return obj.replace(/{(\w+)}/g, (match, key) => vars[key] || match);
      } else if (Array.isArray(obj)) {
        return obj.map(resolve);
      } else if (obj && typeof obj === 'object') {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
          result[key] = resolve(value);
        }
        return result;
      }
      return obj;
    };

    return resolve(config);
  }

  /**
   * Validate configuration
   */
  validate(config) {
    const errors = [];

    // Required fields
    if (!config.title) {
      errors.push('Missing required field: title');
    }

    if (!config.packages || config.packages.length === 0) {
      errors.push('No packages defined');
    }

    // Validate packages
    const packageIds = new Set();
    for (const pkg of config.packages || []) {
      if (!pkg.id) {
        errors.push(`Package missing required field 'id': ${JSON.stringify(pkg)}`);
      }

      if (packageIds.has(pkg.id)) {
        errors.push(`Duplicate package ID: ${pkg.id}`);
      }
      packageIds.add(pkg.id);

      // Validate dependencies
      if (pkg.dependencies) {
        for (const dep of pkg.dependencies) {
          if (!packageIds.has(dep) && !config.packages.some(p => p.id === dep)) {
            errors.push(`Package ${pkg.id} has unknown dependency: ${dep}`);
          }
        }
      }
    }

    // Validate config values
    if (config.config) {
      if (config.config.maxParallel < 1) {
        errors.push('maxParallel must be at least 1');
      }

      if (config.config.timeoutMinutes < 1) {
        errors.push('timeoutMinutes must be at least 1');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

module.exports = { ConfigParser };
