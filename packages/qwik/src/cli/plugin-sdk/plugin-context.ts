import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { VirtualFileTree } from './virtual-file-tree';

export interface CopyTemplateFileConfig {
  templatePath: string;
  targetPath: string;
  templateVars?: TemplateVars;
}

export interface CopyTemplateDirectoryConfig {
  templatePath: string;
  targetPath: string;
  templateVars?: TemplateVars;
}

export interface TemplateVars {
  [key: string]: string;
}

export interface PluginMetadata {
  dependencies?: string[];
  customizationNote?: string;
}

export interface PluginFunction {
  (ctx: PluginContext): Promise<void>;
  metadata?: PluginMetadata;
}

export interface PluginRegistryEntry {
  id: string;
  name: string;
  description: string;
  pluginPath: string;
  npmPackage?: string; // Optional npm package name for auto-installation
}

export interface ViteImport {
  importPath: string;
  defaultImport?: string;
  namedImports?: string[];
}

export interface VitePluginConfig {
  imports: ViteImport[];
  pluginCall: string;
}

export interface VitePluginConfigLegacy {
  importPath: string;
  defaultImport?: string;
  namedImports?: string[];
  pluginCall: string;
}

export class PluginContext {
  private vft: VirtualFileTree;
  private currentPluginName: string = '';
  private nextSteps: string[] = [];

  constructor(projectRoot: string) {
    this.vft = new VirtualFileTree(projectRoot);
  }

  _setCurrentPluginName(pluginName: string): void {
    this.currentPluginName = pluginName;
  }

  _getChangedFiles(): string[] {
    return this.vft.getChangedFiles();
  }

  _getNextSteps(): string[] {
    return [...this.nextSteps];
  }

  addNextStep(step: string): void {
    this.nextSteps.push(step);
  }

  addNextSteps(steps: string): void {
    const stepLines = steps.split('\n');
    stepLines.forEach((step) => this.nextSteps.push(step));
  }

  async addDependency(
    name: string,
    version: string,
    type: 'dependencies' | 'devDependencies' = 'dependencies'
  ): Promise<void> {
    const packageJsonContent = await this.vft.readFile('package.json');
    const packageJson = JSON.parse(packageJsonContent);

    if (!packageJson[type]) {
      packageJson[type] = {};
    }
    packageJson[type][name] = version;

    await this.vft.modifyFile('package.json', JSON.stringify(packageJson, null, 2));
  }

  async modifyViteConfig(plugins: VitePluginConfig[]): Promise<void> {
    const viteConfigPath = this._findViteConfig();
    if (!viteConfigPath) {
      throw new Error(
        'No vite.config file found. Please ensure you have a vite.config.ts or vite.config.js file.'
      );
    }

    let viteConfigContent = await this.vft.readFile(viteConfigPath);

    // Collect and deduplicate all imports from all plugins
    const allImports: ViteImport[] = [];
    const seenImports = new Set<string>();

    for (const plugin of plugins) {
      for (const importConfig of plugin.imports) {
        // Create a unique key for deduplication
        const importKey = `${importConfig.importPath}:${importConfig.defaultImport || ''}:${(importConfig.namedImports || []).sort().join(',')}`;

        if (!seenImports.has(importKey)) {
          seenImports.add(importKey);
          allImports.push(importConfig);
        }
      }
    }

    // Add all unique imports
    for (const importConfig of allImports) {
      viteConfigContent = this._addImportToContent(viteConfigContent, importConfig);
    }

    // Add all plugin calls
    for (const plugin of plugins) {
      viteConfigContent = this._addPluginCallToContent(viteConfigContent, plugin.pluginCall);
    }

    await this.vft.modifyFile(viteConfigPath, viteConfigContent);
  }

  private _addImportToContent(viteConfigContent: string, importConfig: ViteImport): string {
    const importParts = [];
    if (importConfig.defaultImport) {
      importParts.push(importConfig.defaultImport);
    }
    if (importConfig.namedImports && importConfig.namedImports.length > 0) {
      importParts.push(`{ ${importConfig.namedImports.join(', ')} }`);
    }

    const importStatement = `import ${importParts.join(', ')} from '${importConfig.importPath}';\n`;

    const importRegex = new RegExp(
      `import\\s+.*\\s+from\\s+['"]${importConfig.importPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`
    );

    if (importRegex.test(viteConfigContent)) {
      return viteConfigContent; // Import already exists
    }

    const defineConfigMatch = viteConfigContent.match(
      /import\s+.*\s+from\s+['"]@builder\.io\/qwik-city\/vite['"];?\s*\n/
    );
    if (defineConfigMatch) {
      const insertIndex = defineConfigMatch.index! + defineConfigMatch[0].length;
      return (
        viteConfigContent.slice(0, insertIndex) +
        importStatement +
        viteConfigContent.slice(insertIndex)
      );
    }

    const importMatch = viteConfigContent.match(/^import\s+.*;\s*\n/gm);
    if (importMatch) {
      const lastImportIndex =
        viteConfigContent.lastIndexOf(importMatch[importMatch.length - 1]) +
        importMatch[importMatch.length - 1].length;
      return (
        viteConfigContent.slice(0, lastImportIndex) +
        importStatement +
        viteConfigContent.slice(lastImportIndex)
      );
    }

    return importStatement + viteConfigContent;
  }

  private _addPluginCallToContent(viteConfigContent: string, pluginCall: string): string {
    // Skip empty plugin calls (for standalone imports)
    if (!pluginCall.trim()) {
      return viteConfigContent;
    }

    const pluginsMatch = viteConfigContent.match(/plugins:\s*\[([\s\S]*?)\]/);
    if (!pluginsMatch) {
      return viteConfigContent; // No plugins array found
    }

    const pluginsContent = pluginsMatch[1];
    const pluginCallRegex = new RegExp(pluginCall.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

    if (pluginCallRegex.test(pluginsContent)) {
      return viteConfigContent; // Plugin already exists
    }

    const trimmedContent = pluginsContent.trim();
    let newPluginsContent;

    if (trimmedContent === '') {
      newPluginsContent = `\n    ${pluginCall},\n  `;
    } else {
      if (trimmedContent.endsWith(',')) {
        newPluginsContent = `${pluginsContent}    ${pluginCall},\n  `;
      } else {
        newPluginsContent = `${pluginsContent},\n    ${pluginCall},\n  `;
      }
    }

    return viteConfigContent.replace(
      /plugins:\s*\[([\s\S]*?)\]/,
      `plugins: [${newPluginsContent}]`
    );
  }

  async addPackageJsonScript(name: string, command: string): Promise<void> {
    const packageJsonContent = await this.vft.readFile('package.json');
    const packageJson = JSON.parse(packageJsonContent);

    if (!packageJson.scripts) {
      packageJson.scripts = {};
    }
    packageJson.scripts[name] = command;

    await this.vft.modifyFile('package.json', JSON.stringify(packageJson, null, 2));
  }

  async copyTemplateFile(pathOrConfig: string | CopyTemplateFileConfig): Promise<void> {
    if (typeof pathOrConfig === 'string') {
      return this.copyTemplateFile({
        templatePath: pathOrConfig,
        targetPath: pathOrConfig,
      });
    }

    const { templatePath, targetPath, templateVars } = pathOrConfig;
    if (!this.currentPluginName) {
      throw new Error('Plugin name not set. Cannot resolve template path.');
    }

    const fullTemplatePath = join(
      __dirname,
      `${this.currentPluginName}-plugin`,
      'templates',
      templatePath
    );
    let content = await fs.readFile(fullTemplatePath, 'utf-8');

    if (templateVars) {
      for (const [key, value] of Object.entries(templateVars)) {
        content = content.replace(new RegExp(`{{${key}}}`, 'g'), value);
      }
    }

    return this.vft.createFile(targetPath, content);
  }

  async copyTemplateDirectory(pathOrConfig: string | CopyTemplateDirectoryConfig): Promise<void> {
    if (typeof pathOrConfig === 'string') {
      return this.copyTemplateDirectory({
        templatePath: pathOrConfig,
        targetPath: pathOrConfig,
      });
    }

    const { templatePath, targetPath, templateVars } = pathOrConfig;
    if (!this.currentPluginName) {
      throw new Error('Plugin name not set. Cannot resolve template path.');
    }

    const fullTemplatePath = join(
      __dirname,
      `${this.currentPluginName}-plugin`,
      'templates',
      templatePath
    );

    const copyDir = async (sourcePath: string, targetBasePath: string): Promise<void> => {
      const entries = await fs.readdir(sourcePath);

      for (const entry of entries) {
        const sourceItemPath = join(sourcePath, entry);
        const targetItemPath = join(targetBasePath, entry);
        const stats = await fs.stat(sourceItemPath);

        if (stats.isDirectory()) {
          await copyDir(sourceItemPath, targetItemPath);
        } else {
          let content = await fs.readFile(sourceItemPath, 'utf-8');

          if (templateVars) {
            for (const [key, value] of Object.entries(templateVars)) {
              content = content.replace(new RegExp(`{{${key}}}`, 'g'), value);
            }
          }

          await this.vft.createFile(targetItemPath, content);
        }
      }
    };

    return copyDir(fullTemplatePath, targetPath);
  }

  async createFile(filePath: string, content: string): Promise<void> {
    await this.vft.createFile(filePath, content);
  }

  async modifyFile(filePath: string, content: string): Promise<void> {
    await this.vft.modifyFile(filePath, content);
  }

  async readFile(filePath: string): Promise<string> {
    return this.vft.readFile(filePath);
  }

  async fileExists(filePath: string): Promise<boolean> {
    return this.vft.fileExists(filePath);
  }

  async commit(): Promise<void> {
    await this.vft.commit();
  }

  async rollback(): Promise<void> {
    await this.vft.rollback();
  }

  private _findViteConfig(): string | null {
    const possibleConfigs = ['vite.config.ts', 'vite.config.js', 'vite.config.mts'];
    for (const config of possibleConfigs) {
      if (this.vft.fileExists(config)) {
        return config;
      }
    }
    return null;
  }
}

export async function loadPlugin(pluginPath: string): Promise<PluginFunction> {
  if (isGitHubUrl(pluginPath)) {
    return loadExternalPlugin(pluginPath);
  }

  try {
    const pluginModule = await import(pluginPath);

    const plugin =
      pluginModule.default ||
      Object.values(pluginModule).find((exp: any) => typeof exp === 'function' && exp.metadata);

    if (!plugin || typeof plugin !== 'function') {
      throw new Error(`Invalid plugin at ${pluginPath}: no valid plugin function found`);
    }

    return plugin as PluginFunction;
  } catch (error) {
    throw new Error(`Failed to load plugin from ${pluginPath}: ${error}`);
  }
}

function isGitHubUrl(url: string): boolean {
  return url.startsWith('https://github.com/') || url.startsWith('github:');
}

async function showSecurityWarning(pluginUrl: string): Promise<boolean> {
  const { isCancel, confirm, note } = await import('@clack/prompts');
  const { yellow, red, bold } = await import('kleur/colors');

  const warningMessage = `${red('⚠️  SECURITY WARNING ⚠️')}

${yellow('You are about to install an external plugin from:')}
${bold(pluginUrl)}

${red('POTENTIAL RISKS:')}
• This plugin could execute arbitrary code on your system
• It may access, modify, or delete files in your project
• It could make network requests or install dependencies
• Code execution happens with your user permissions

${yellow('SAFETY RECOMMENDATIONS:')}
• Only install plugins from trusted sources
• Review the plugin code before installation
• Use version control to track changes
• Consider running in a sandboxed environment`;

  note(warningMessage, 'External Plugin Security Warning');

  const confirmed = await confirm({
    message: 'Do you understand the risks and want to proceed?',
    initialValue: false,
  });

  if (isCancel(confirmed)) {
    throw new Error('Plugin installation cancelled by user');
  }

  return confirmed as boolean;
}

async function loadExternalPlugin(pluginUrl: string): Promise<PluginFunction> {
  const confirmed = await showSecurityWarning(pluginUrl);

  if (!confirmed) {
    throw new Error('Plugin installation cancelled due to security concerns');
  }

  const { note, spinner } = await import('@clack/prompts');

  note('Fetching external plugin...', 'This may take a moment');

  const s = spinner();
  s.start('Downloading plugin from GitHub...');

  try {
    const pluginCode = await fetchGitHubPlugin(pluginUrl);
    const tempPluginPath = await createTempPlugin(pluginCode);

    s.stop('Plugin downloaded successfully ✅');

    const pluginModule = await import(tempPluginPath);

    const plugin =
      pluginModule.default ||
      Object.values(pluginModule).find((exp: any) => typeof exp === 'function' && exp.metadata);

    if (!plugin || typeof plugin !== 'function') {
      throw new Error(`Invalid external plugin: no valid plugin function found`);
    }

    return plugin as PluginFunction;
  } catch (error) {
    s.stop('Failed to load external plugin ❌');
    throw new Error(`Failed to load external plugin from ${pluginUrl}: ${error}`);
  }
}

async function fetchGitHubPlugin(pluginUrl: string): Promise<string> {
  const rawUrl = convertToRawGitHubUrl(pluginUrl);

  try {
    const response = await fetch(rawUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch plugin: ${response.status} ${response.statusText}`);
    }

    return await response.text();
  } catch (error) {
    throw new Error(`Network error while fetching plugin: ${error}`);
  }
}

function convertToRawGitHubUrl(url: string): string {
  if (url.startsWith('github:')) {
    const parts = url.replace('github:', '').split('/');
    const owner = parts[0];
    const repo = parts[1];
    const path = parts.slice(2).join('/') || 'plugin.ts';
    return `https://raw.githubusercontent.com/${owner}/${repo}/main/${path}`;
  }

  if (url.includes('github.com') && url.includes('/blob/')) {
    return url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
  }

  return url.replace('github.com', 'raw.githubusercontent.com') + '/main/plugin.ts';
}

async function createTempPlugin(pluginCode: string): Promise<string> {
  const tempDir = await fs.mkdtemp(join(tmpdir(), 'qwik-plugin-'));
  const tempFilePath = join(tempDir, `plugin-${Date.now()}.mjs`);

  await fs.writeFile(tempFilePath, pluginCode, 'utf-8');

  return tempFilePath;
}

export async function runPlugin(
  pluginOrPath: PluginFunction | string,
  projectRootOrContext: string | PluginContext,
  pluginName?: string
): Promise<PluginContext> {
  let plugin: PluginFunction;
  let ctx: PluginContext;

  if (typeof pluginOrPath === 'string') {
    plugin = await loadPlugin(pluginOrPath);
    ctx = projectRootOrContext as PluginContext;
  } else {
    plugin = pluginOrPath;
    ctx = new PluginContext(projectRootOrContext as string);
  }

  if (pluginName) {
    ctx._setCurrentPluginName(pluginName);
  }

  try {
    await plugin(ctx);
    if (typeof pluginOrPath === 'function') {
      await ctx.commit();
    }
    return ctx;
  } catch (error) {
    await ctx.rollback();
    throw error;
  }
}
