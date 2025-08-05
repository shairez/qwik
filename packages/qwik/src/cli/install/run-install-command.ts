import { red } from 'kleur/colors';
import type { AppCommand } from '../utils/app-command';
import { printInstallHelp } from './print-install-help';
import { runInstallInteractive } from './run-install-interactive';

export async function runInstallCommand(app: AppCommand) {
  try {
    const id = app.args[1];
    if (id === 'help') {
      await printInstallHelp(app);
    } else {
      await runInstallInteractive(app, id);
    }
  } catch (e) {
    console.error(`❌ ${red(String(e))}\n`);
    process.exit(1);
  }
}
