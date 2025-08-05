import type { PluginFunction } from '../../plugin-context';
import { PluginContext } from '../../plugin-context';

export const tailwindPlugin: PluginFunction = async (ctx: PluginContext): Promise<void> => {
  await ctx.addDependency('tailwindcss', '^4.0.0', 'devDependencies');
  await ctx.addDependency('@tailwindcss/vite', '^4.0.0', 'devDependencies');
  await ctx.addDependency('prettier-plugin-tailwindcss', '^0.6.11', 'devDependencies');

  await ctx.modifyViteConfig([
    {
      imports: [
        {
          importPath: '@tailwindcss/vite',
          defaultImport: 'tailwindcss',
        },
      ],
      pluginCall: 'tailwindcss()',
    },
  ]);

  await ctx.copyTemplateFile({
    templatePath: 'global.css',
    targetPath: 'src/global.css',
  });

  await ctx.copyTemplateFile('.prettierrc.js');

  ctx.addNextSteps(`Import the CSS file in your root component:
   import "./global.css"

Start using Tailwind CSS classes in your components
Check the Tailwind CSS documentation for more features`);
};

tailwindPlugin.metadata = {
  dependencies: ['tailwindcss', '@tailwindcss/vite', 'prettier-plugin-tailwindcss'],
  customizationNote: 'To customize your setup, edit the generated configuration files.',
};
