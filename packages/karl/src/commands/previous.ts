import { loadConfig } from '../config.js';
import { createHistoryStore } from '../history.js';

export async function handlePreviousCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const store = createHistoryStore(config.history, cwd);
  if (!store) {
    console.error('History is disabled.');
    process.exitCode = 1;
    return;
  }

  const json = args.includes('--json') || args.includes('-j');
  const idOnly = args.includes('--id');

  const run = store.getLatestRun();
  if (!run) {
    console.error('No history entries found.');
    process.exitCode = 1;
    return;
  }

  if (idOnly) {
    console.log(run.id);
    return;
  }
  if (json) {
    console.log(JSON.stringify(run, null, 2));
    return;
  }
  console.log(run.response ?? '');
}
