import type { PluginFunction } from '../../plugin-context';
import { PluginContext } from '../../plugin-context';

export const partytownPlugin: PluginFunction = async (ctx: PluginContext): Promise<void> => {
  await ctx.addDependency('@qwik.dev/partytown', '^0.11.1', 'devDependencies');

  await ctx.modifyViteConfig([
    {
      imports: [
        {
          importPath: 'path',
          namedImports: ['join'],
        },
        {
          importPath: '@qwik.dev/partytown/utils',
          defaultImport: 'partytownVite',
        },
      ],
      pluginCall: "partytownVite({dest: join(__dirname, 'dist', '~partytown')})",
    },
  ]);

  await ctx.copyTemplateFile({
    templatePath: 'partytown.tsx',
    targetPath: 'src/components/partytown/partytown.tsx',
  });

  ctx.addNextSteps(`Add the <QwikPartytown/> component to your root.tsx file:
   import { QwikPartytown } from "./components/partytown/partytown";
   // Then in your component: <QwikPartytown />

Configure your third-party scripts to run in web workers
Check the Partytown documentation for advanced configuration:
   https://partytown.qwik.dev/configuration`);
};

partytownPlugin.metadata = {
  dependencies: ['@qwik.dev/partytown'],
  customizationNote:
    'Partytown helps improve performance by moving third-party scripts to web workers.',
};
