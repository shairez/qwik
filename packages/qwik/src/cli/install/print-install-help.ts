import { confirm, intro, isCancel, select } from '@clack/prompts';
import { dim, magenta } from 'kleur/colors';
import type { AppCommand } from '../utils/app-command';
import { bye, note, pmRunCmd } from '../utils/utils';

/** Available plugins in our new plugin system TODO: This will eventually be loaded from a registry */
const AVAILABLE_PLUGINS = [
  {
    id: 'tailwind',
    name: 'Tailwind CSS v4+',
    description: 'Add Tailwind CSS v4+ with Vite integration and Prettier plugin',
  },
  {
    id: 'partytown',
    name: 'Partytown (3rd-party scripts)',
    description: 'Run third-party scripts in web workers for better performance',
  },
  {
    id: 'cypress',
    name: 'Cypress (component testing)',
    description: 'Add Cypress component testing with Qwik integration',
  },
];

const SPACE_TO_HINT = 25;
const MAX_HINT_LENGTH = 50;

function renderPlugins(plugins: typeof AVAILABLE_PLUGINS) {
  return plugins
    .map((plugin) => {
      const hint =
        plugin.description.length > MAX_HINT_LENGTH
          ? plugin.description.slice(0, MAX_HINT_LENGTH - 3) + '...'
          : plugin.description;
      return plugin.id + ' '.repeat(Math.max(SPACE_TO_HINT - plugin.id.length, 2)) + dim(hint);
    })
    .join('\n');
}

export async function printInstallHelp(app: AppCommand) {
  const pmRun = pmRunCmd();

  intro(`${pmRun} qwik ${magenta(`install`)} [plugin]`);

  note(renderPlugins(AVAILABLE_PLUGINS), 'Available Plugins');

  const proceed = await confirm({
    message: 'Do you want to install a plugin?',
    initialValue: true,
  });

  if (isCancel(proceed) || !proceed) {
    bye();
  }

  const command = await select({
    message: 'Select a plugin to install',
    options: AVAILABLE_PLUGINS.map((plugin) => ({
      value: plugin.id,
      label: plugin.name,
      hint: plugin.description,
    })),
  });

  if (isCancel(command)) {
    bye();
  }

  // Instead of circular import, we'll let the main command handle this
  note(`Selected plugin: ${command}\nRun: ${pmRun} qwik install ${command}`, 'Next Steps');
}
