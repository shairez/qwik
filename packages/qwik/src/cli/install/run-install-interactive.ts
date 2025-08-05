import { intro, isCancel, outro, select, spinner } from '@clack/prompts';
import { promises as fs } from 'fs';
import { bgBlue, bold, magenta } from 'kleur/colors';
import { join } from 'path';
import {
  loadPlugin,
  PluginContext,
  type PluginFunction,
  type PluginRegistryEntry,
} from '../plugin-sdk/plugin-context';
import type { AppCommand } from '../utils/app-command';
import { runInPkg } from '../utils/install-deps';
import { getPackageManager, note } from '../utils/utils';

/**
 * Plugin registry - supports both local paths and external GitHub URLs External plugins show
 * security warnings and require user confirmation
 */
const PLUGIN_REGISTRY: Record<string, PluginRegistryEntry> = {
  tailwind: {
    id: 'tailwind',
    name: 'Tailwind CSS v4+',
    description: 'Add Tailwind CSS v4+ with Vite integration and Prettier plugin',
    pluginPath: '../plugin-sdk/plugins/tailwind/tailwind-plugin',
  },
  partytown: {
    id: 'partytown',
    name: 'Partytown',
    description: 'Move third-party scripts into web workers to improve performance',
    pluginPath: '../plugin-sdk/plugins/partytown/partytown-plugin',
  },

  // Example external plugins (commented out for now)
  /*
  'external-example': {
    id: 'external-example',
    name: 'External Plugin Example',
    description: 'Example external plugin from GitHub',
    pluginPath: 'github:qwik-community/awesome-plugin/plugin.ts',
  },
  'community-theme': {
    id: 'community-theme',
    name: 'Community Theme Plugin',
    description: 'Beautiful theme plugin from the community',
    pluginPath: 'https://github.com/user/qwik-theme-plugin/blob/main/src/plugin.ts',
  },
  */
};

export async function runInstallInteractive(app: AppCommand, pluginName: string) {
  intro(`${bgBlue(' qwik install ')} ${bold(magenta(pluginName))}`);

  const pkgManager = getPackageManager();

  // Check if it's a trusted registry plugin
  if (PLUGIN_REGISTRY[pluginName]) {
    const pluginInfo = PLUGIN_REGISTRY[pluginName];

    // If has npm package, install it first
    if (pluginInfo.npmPackage) {
      const s = spinner();
      s.start(`Installing ${pluginInfo.npmPackage} via ${pkgManager}...`);
      try {
        await runInPkg(pkgManager, ['install', pluginInfo.npmPackage], app.rootDir);
        s.stop(`${pluginInfo.npmPackage} installed! 📦`);

        // Update plugin path to point to node_modules
        const pluginPath = `${pluginInfo.npmPackage}/${pluginInfo.pluginPath}`;
        await executePlugin(app, pluginInfo, pluginPath, pkgManager);
      } catch (error) {
        s.stop(`Failed to install ${pluginInfo.npmPackage} ❌`);
        throw error;
      }
    } else {
      // Local plugin (current behavior)
      await executePlugin(app, pluginInfo, pluginInfo.pluginPath, pkgManager);
    }
  } else {
    // Community plugin - not in trusted registry
    await handleCommunityPlugin(app, pluginName, pkgManager);
  }

  // Close the process
  process.exit(0);
}

async function executePlugin(
  app: AppCommand,
  pluginInfo: PluginRegistryEntry,
  pluginPath: string,
  pkgManager: string
) {
  // Load the plugin dynamically from its path
  const plugin = await loadPlugin(pluginPath);

  // Create the real plugin context and run the plugin for preview
  const pluginContext = new PluginContext(app.rootDir);
  pluginContext._setCurrentPluginName(pluginInfo.id);

  try {
    // Run the plugin to detect changes (without committing)
    await plugin(pluginContext);

    // Show preview with actual detected changes
    await logInstallPreview(pluginContext, plugin);

    // Check if plugin has dependencies that need to be installed
    const dependencies = plugin.metadata?.dependencies || [];
    const runInstall = dependencies.length > 0;

    // Execute the plugin - already ran above, just commit the changes
    const s = spinner();
    s.start(`Installing ${pluginInfo.name}...`);

    await pluginContext.commit();
    s.stop(`${pluginInfo.name} installed successfully! ✅`);

    // Install dependencies if needed
    if (runInstall) {
      const s2 = spinner();
      s2.start(`Installing dependencies with ${pkgManager}...`);
      await runInPkg(pkgManager, ['install'], app.rootDir);
      s2.stop('Dependencies installed successfully! 📦');
    }

    outro(`🎉 ${pluginInfo.name} has been successfully installed!`);

    // Show results with dynamic next steps
    await logInstallResult(pluginContext, plugin);
  } catch (error) {
    await pluginContext.rollback();
    throw error;
  }
}

async function handleCommunityPlugin(app: AppCommand, packageName: string, pkgManager: string) {
  // Show security warning
  const warningMessage = [
    '⚠️  COMMUNITY PLUGIN WARNING ⚠️',
    '',
    `You are about to install: ${bold(packageName)}`,
    '',
    '🔴 SECURITY RISKS:',
    '   • This is an unverified community plugin',
    '   • It could execute arbitrary code on your system',
    '   • It may access, modify, or delete files in your project',
    '   • Code execution happens with your user permissions',
    '',
    '✅ SAFETY RECOMMENDATIONS:',
    '   • Only install plugins from trusted sources',
    '   • Review the plugin code before installation',
    '   • Use version control to track changes',
    '',
    '🤔 Continue at your own risk?',
  ].join('\n');

  const shouldContinue = await select({
    message: warningMessage,
    options: [
      { value: false, label: 'No - Cancel installation' },
      { value: true, label: 'Yes - I understand the risks and want to proceed' },
    ],
  });

  if (isCancel(shouldContinue) || !shouldContinue) {
    outro('Installation cancelled for your safety.');
    process.exit(0);
  }

  // Install the community package
  const s = spinner();
  s.start(`Installing ${packageName} via ${pkgManager}...`);

  await runInPkg(pkgManager, ['install', packageName], app.rootDir);
  s.stop(`${packageName} installed! 📦`);

  // Try to find and execute the plugin
  const pluginPath = await findPluginInPackage(packageName);

  const pluginInfo: PluginRegistryEntry = {
    id: packageName,
    name: packageName,
    description: `Community plugin: ${packageName}`,
    pluginPath: `${packageName}/${pluginPath}`,
  };

  await executePlugin(app, pluginInfo, pluginInfo.pluginPath, pkgManager);
}

async function findPluginInPackage(packageName: string): Promise<string> {
  const packageJsonPath = join(process.cwd(), 'node_modules', packageName, 'package.json');

  try {
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));

    // Look for qwik plugin entry points in order of preference
    const candidates = [
      packageJson.qwik?.plugin, // "qwik": { "plugin": "dist/plugin.js" }
      packageJson.main, // Standard main entry
      'dist/plugin.js', // Convention
      'plugin.js', // Simple convention
      'index.js', // Fallback
    ].filter(Boolean);

    for (const candidate of candidates) {
      const fullPath = join(process.cwd(), 'node_modules', packageName, candidate);
      try {
        await fs.access(fullPath);
        return candidate;
      } catch {
        // Continue to next candidate
      }
    }

    throw new Error(`Could not find plugin entry point in ${packageName}`);
  } catch (error) {
    throw new Error(`Failed to read package.json for ${packageName}: ${error}`);
  }
}

async function logInstallPreview(pluginContext: PluginContext, plugin: PluginFunction) {
  // Get dependencies from plugin metadata
  const dependencies = plugin.metadata?.dependencies || [];

  // Get the actual files that will be changed
  const changedFiles = pluginContext._getChangedFiles();

  const changes = [];

  if (dependencies.length > 0) {
    changes.push('📦 Dependencies to be added:');
    changes.push(...dependencies.map((dep: string) => `   ${dep}`));
    changes.push('');
  }

  if (changedFiles.length > 0) {
    changes.push('📁 Files to be created/modified:');
    changes.push(...changedFiles.map((file) => `   ${file}`));
  }

  if (changes.length > 0) {
    note(changes.join('\n'), 'The following changes will be made');
  }
}

async function logInstallResult(pluginContext: PluginContext, plugin: PluginFunction) {
  // Use dynamic next steps from plugin context
  const nextSteps = pluginContext._getNextSteps();

  if (nextSteps && nextSteps.length > 0) {
    const formattedSteps = [
      '📋 Next steps:',
      ...nextSteps.map((step: string, index: number) => {
        if (step === '') {
          return '';
        }
        return step.startsWith('   ') ? step : `   ${index + 1}. ${step}`;
      }),
    ];

    note(formattedSteps.join('\n'), '');
  }

  // Use customization note from plugin metadata if available
  const customizationNote = plugin.metadata?.customizationNote;
  if (customizationNote) {
    note(`🔧 ${customizationNote}`, '');
  }
}
