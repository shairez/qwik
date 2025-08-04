import { VirtualFileTree } from './virtual-file-tree';

/** Configuration for adding a Vite plugin */
export interface VitePluginConfig {
  /** Import path for the plugin (e.g., '@tailwindcss/vite') */
  importPath: string;
  /** Default import name (e.g., 'tailwindcss') */
  defaultImport: string;
  /** Plugin function call (e.g., 'tailwindcss()') */
  pluginCall: string;
}

/**
 * Minimal Plugin Context API - Built based on REAL discoveries from tailwind plugin implementation.
 *
 * Contains ONLY the helpers we actually need, not theoretical ones.
 */
export class PluginContext {
  constructor(
    private vft: VirtualFileTree,
    private projectRoot: string
  ) {}

  /**
   * 🚨 CRITICAL HELPER #1: Add dependency to package.json
   *
   * DISCOVERY: Manual JSON manipulation was error-prone and required 7+ lines of boilerplate. This
   * reduces it to 1 simple call.
   */
  async addDependency(
    name: string,
    version: string,
    type: 'dependencies' | 'devDependencies' | 'peerDependencies' = 'dependencies'
  ): Promise<void> {
    const packageJsonContent = await this.vft.readFile('package.json');
    const packageJson = JSON.parse(packageJsonContent);

    // Ensure the dependency section exists
    if (!packageJson[type]) {
      packageJson[type] = {};
    }

    // Add the dependency
    packageJson[type][name] = version;

    await this.vft.modifyFile('package.json', JSON.stringify(packageJson, null, 2));
  }

  /**
   * 🚨 CRITICAL HELPER #2: Add Vite plugin with import and configuration
   *
   * DISCOVERY: String manipulation for vite config was 30+ lines and extremely brittle. This
   * provides a simple API for the most common case.
   */
  async addVitePlugin(config: VitePluginConfig): Promise<void> {
    const viteConfigPath = this._findViteConfig();
    if (!viteConfigPath) {
      throw new Error('No vite.config file found. Cannot add plugin.');
    }

    const viteConfigContent = await this.vft.readFile(viteConfigPath);
    let modifiedConfig = viteConfigContent;

    // Add import if not present
    if (!modifiedConfig.includes(config.importPath)) {
      const importStatement = `import ${config.defaultImport} from '${config.importPath}';\n`;

      // Find where to insert the import (after existing imports or at top)
      const importRegex = /^import\s+.*?;$/gm;
      const imports = [...modifiedConfig.matchAll(importRegex)];

      if (imports.length > 0) {
        // Insert after last import
        const lastImport = imports[imports.length - 1];
        const insertPosition = lastImport.index! + lastImport[0].length + 1;
        modifiedConfig =
          modifiedConfig.slice(0, insertPosition) +
          importStatement +
          modifiedConfig.slice(insertPosition);
      } else {
        // No imports found, add at the beginning
        modifiedConfig = importStatement + modifiedConfig;
      }
    }

    // Add plugin to plugins array if not present
    if (!modifiedConfig.includes(config.pluginCall)) {
      // Find the plugins array and add our plugin
      const pluginsRegex = /plugins:\s*\[/;
      const match = modifiedConfig.match(pluginsRegex);

      if (match) {
        const insertPosition = match.index! + match[0].length;
        modifiedConfig =
          modifiedConfig.slice(0, insertPosition) +
          `\n    ${config.pluginCall},` +
          modifiedConfig.slice(insertPosition);
      } else {
        throw new Error('Could not find plugins array in vite config. Manual modification needed.');
      }
    }

    await this.vft.modifyFile(viteConfigPath, modifiedConfig);
  }

  /**
   * 🔧 UTILITY: Find vite config file
   *
   * DISCOVERY: Needed to handle multiple possible vite config file names.
   */
  private _findViteConfig(): string | null {
    const possibleConfigs = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'];

    for (const config of possibleConfigs) {
      if (this.vft.fileExists(config)) {
        return config;
      }
    }

    return null;
  }

  /**
   * ✅ DELEGATE: File operations work perfectly with Virtual File Tree
   *
   * These are just convenient delegates to VFT methods for plugin authors.
   */
  async createFile(path: string, content: string): Promise<void> {
    return this.vft.createFile(path, content);
  }

  async modifyFile(path: string, content: string): Promise<void> {
    return this.vft.modifyFile(path, content);
  }

  async readFile(path: string): Promise<string> {
    return this.vft.readFile(path);
  }

  fileExists(path: string): boolean {
    return this.vft.fileExists(path);
  }

  /**
   * 🔧 EXECUTION: Commit all changes
   *
   * DISCOVERY: Plugins need a simple way to apply all their changes.
   */
  async commit(): Promise<void> {
    return this.vft.commit();
  }

  /**
   * 🔧 EXECUTION: Rollback all changes
   *
   * DISCOVERY: Error handling requires easy rollback capability.
   */
  async rollback(): Promise<void> {
    return this.vft.rollback();
  }
}

/** Plugin function type - simple and focused */
export type PluginFunction = (ctx: PluginContext) => Promise<void>;

/**
 * 🚀 EXECUTION FRAMEWORK: Run a plugin with proper error handling
 *
 * DISCOVERY: Plugins need standardized execution with automatic rollback on errors.
 */
export async function runPlugin(pluginFn: PluginFunction, projectRoot: string): Promise<void> {
  const vft = new VirtualFileTree(projectRoot);
  await vft.initialize();

  const ctx = new PluginContext(vft, projectRoot);

  try {
    await pluginFn(ctx);
    await ctx.commit();
  } catch (error) {
    await ctx.rollback();
    throw error;
  }
}
