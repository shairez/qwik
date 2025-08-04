import type { PluginFunction } from './plugin-context';
import { PluginContext } from './plugin-context';

/**
 * 🎯 CLEAN TAILWIND PLUGIN: Using our discovered minimal API
 *
 * Compare this to the 100+ line discovery version - this is the power of building the API based on
 * real needs!
 */
export const tailwindPlugin: PluginFunction = async (ctx: PluginContext): Promise<void> => {
  // Add dependencies - 1 line each instead of 7+ lines of boilerplate!
  await ctx.addDependency('tailwindcss', '^4.0.0', 'devDependencies');
  await ctx.addDependency('@tailwindcss/vite', '^4.0.0', 'devDependencies');
  await ctx.addDependency('prettier-plugin-tailwindcss', '^0.6.11', 'devDependencies');

  // Add Vite plugin - now with clear, self-documenting config object!
  await ctx.addVitePlugin({
    importPath: '@tailwindcss/vite',
    defaultImport: 'tailwindcss',
    pluginCall: 'tailwindcss()',
  });

  // Create CSS file - works perfectly with Virtual File Tree
  await ctx.createFile('src/global.css', '@import "tailwindcss";\n');

  // Create prettier config - also straightforward
  const prettierConfig = `export default {\n  plugins: ['prettier-plugin-tailwindcss'],\n}\n`;
  await ctx.createFile('.prettierrc.js', prettierConfig);

  // No need to call commit() - the runPlugin() framework handles it!
};

/**
 * 📊 COMPARISON:
 *
 * 📉 BEFORE (Discovery version):
 *
 * - 100+ lines of complex, brittle code
 * - Manual JSON parsing/stringifying
 * - Fragile string manipulation for vite config
 * - Complex error handling
 *
 * 📈 AFTER (With minimal API):
 *
 * - 15 lines of clean, simple code
 * - No boilerplate
 * - Safe, tested operations
 * - Automatic error handling and rollback
 * - Self-documenting config objects
 *
 * 🎯 RESULT: 85% reduction in code complexity + improved clarity!
 */
