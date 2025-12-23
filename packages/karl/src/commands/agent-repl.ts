import * as readline from 'readline';
import path from 'path';
import { promises as fs } from 'fs';
import { Orchestrator, type OrchestratorEvent } from '../orchestrator.js';
import type { KarlConfig } from '../types.js';
import pc from 'picocolors';
import { getSpinnerFrame, highlight, detectVisuals } from '../utils/visuals.js';
import { formatDuration, resolveHomePath } from '../utils.js';

interface AgentOptions {
  plain?: boolean;
  visuals?: string;
}

export async function handleAgentRepl(config: KarlConfig, options: AgentOptions = {}): Promise<void> {
  // Session auto-save setup
  const sessionDir = resolveHomePath('~/.config/karl/agent');
  await fs.mkdir(sessionDir, { recursive: true });
  const sessionId = `agent-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}`;
  const sessionFile = path.join(sessionDir, `${sessionId}.md`);
  console.log(pc.gray(`📝 Session: ${path.basename(sessionFile)} (full log: ${sessionFile})`));

  const orchestrator = new Orchestrator(config);
  const state = orchestrator.snapshot;

  const override = options.plain ? 'plain' : options.visuals || 'auto';
  const visualsMode = detectVisuals(override);

  console.log(`${pc.bold('Karl Agent')} ${pc.dim(`(${state.model} via ${state.provider})`)}`);
  console.log(pc.dim('Commands: /reset, /exit, /calls, raw N, Ctrl+C'));
  console.log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${pc.cyan('> ')}`,
    terminal: true
  });

  let isProcessing = false;
  let callHistory: Array<{num: number; info: string; raw: string; durationMs: number}> = [];
  let callNum = 0;
  let spinnerInterval: NodeJS.Timeout | null = null;
  let currentBuffer = '';
  let callStartTime = 0;
  let currentCallInfo = '';

  // Save session header
  await fs.writeFile(sessionFile, `# Karl Agent Session ${sessionId}\n\n`);

  rl.on('SIGINT', () => {
    if (spinnerInterval) {
      clearInterval(spinnerInterval);
      spinnerInterval = null;
      process.stdout.write('\r\x1b[2K\n');
    }
    if (isProcessing) {
      console.log(`\n${pc.yellow('Aborting...')}`);
      if (spinnerInterval) clearInterval(spinnerInterval);
      orchestrator.abort();
    } else {
      console.log(`\n${pc.dim('Use /exit to quit')}`);
      rl.prompt();
    }
  });

  orchestrator.subscribe((event: OrchestratorEvent) => {
    switch (event.type) {
      case 'thinking':
        process.stdout.write(pc.dim(event.text));
        break;

      case 'karl_start':
        process.stdout.write('\n');
        currentBuffer = '';
        currentCallInfo = `${event.command} "${event.task}"`;
        callStartTime = Date.now();
        callNum++;

        // Simple header: ▸ karl run "task"
        const header = `${pc.cyan('▸')} ${pc.cyan('karl')} ${event.command} ${pc.dim(`"${event.task}"`)}`;
        console.log(header);

        // Spinner on next line
        if (visualsMode.spinner !== 'none') {
          spinnerInterval = setInterval(() => {
            const elapsed = Date.now() - callStartTime;
            const frame = getSpinnerFrame(elapsed, visualsMode);
            process.stdout.write(`\r  ${pc.cyan(frame)} ${pc.dim(formatDuration(elapsed))}`);
          }, 120);
        }
        break;

      case 'karl_output':
        currentBuffer += event.chunk;
        break;

      case 'karl_end':
        if (spinnerInterval) {
          clearInterval(spinnerInterval);
          spinnerInterval = null;
          process.stdout.write('\r\x1b[2K');  // Clear spinner line
        }
        const durMs = Date.now() - callStartTime;
        const statusIcon = event.success ? pc.green('✓') : pc.red('✗');
        const durStr = pc.dim(`[${formatDuration(durMs)}]`);

        // Show output with highlighting (for diffs)
        const trimmedOutput = currentBuffer.trim();
        if (trimmedOutput) {
          const highlighted = highlight(trimmedOutput);
          console.log(highlighted);
        }

        // Status line
        console.log(`${statusIcon} ${pc.dim(currentCallInfo)} ${durStr}`);

        // Separator
        const termWidth = process.stdout.columns || 80;
        console.log(pc.dim('─'.repeat(Math.min(60, termWidth - 4))));

        callHistory.push({ num: callNum, info: currentCallInfo, raw: currentBuffer, durationMs: durMs });

        // Append to session MD with embedded raw
        const mdKarl = `\n### Karl Call ${callNum}: ${currentCallInfo}\n\`\`\`\n${currentBuffer.trim()}\n\`\`\`\n\n`;
        fs.appendFile(sessionFile, mdKarl).catch(console.error);
        break;

      case 'response':
        console.log(`\n${event.text}`);
        // Append response to MD
        const mdResp = `\n## Agent\n\n${event.text}\n\n---\n\n`;
        fs.appendFile(sessionFile, mdResp).catch(console.error);
        break;

      case 'error':
        console.log(`\n${pc.red(`Error: ${event.error.message}`)}`);
        break;

      case 'done':
        console.log('');
        break;
    }
  });

  const processInput = async (input: string): Promise<void> => {
    const trimmed = input.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }

    // Special commands
    if (trimmed.startsWith('/')) {
      const cmdArgs = trimmed.slice(1).toLowerCase().split(/\s+/);
      const cmd = cmdArgs[0];

      if (['exit', 'quit', 'q'].includes(cmd)) {
        await fs.appendFile(sessionFile, `\n--- Session ended ---\n`);
        console.log(`${pc.dim('Goodbye')}`);
        rl.close();
        process.exit(0);
        return;
      }

      if (['reset', 'clear'].includes(cmd)) {
        callHistory = [];
        callNum = 0;
        orchestrator.reset();
        console.log(`${pc.dim('Cleared')}`);
        rl.prompt();
        return;
      }

      if (['calls', 'history', 'ls'].includes(cmd)) {
        if (callHistory.length === 0) {
          console.log(pc.dim('No calls'));
        } else {
          console.log(pc.dim('Calls:'));
          callHistory.slice(-8).forEach((c) => {
            console.log(`  ${pc.cyan(`${c.num}`.padStart(2, '0'))}: ${pc.dim(c.info)} ${pc.green(formatDuration(c.durationMs))}`);
          });
        }
        rl.prompt();
        return;
      }

      if (cmd === 'help' || cmd === '?') {
        console.log(pc.dim(`
Commands:
/reset    Clear history
/exit    Quit
/calls   List calls
raw N    Raw output for call N
/help    This help

Nested: agent runs karl commands like "build login"
        `));
        rl.prompt();
        return;
      }

      console.log(pc.dim(`Unknown command: ${cmd}`));
      rl.prompt();
      return;
    }

    // raw N command
    const rawMatch = trimmed.match(/^raw\\s+(\\d+)/i);
    if (rawMatch) {
      const n = parseInt(rawMatch[1]);
      const call = callHistory.find((c) => c.num === n);
      if (!call) {
        console.log(pc.red(`Call ${n} not found (have 1-${callNum})`));
      } else {
        console.log(pc.gray(`--- Raw #${n} ---`));
        console.log(call.raw);
        console.log(pc.gray('--- end raw ---'));
      }
      rl.prompt();
      return;
    }

    // User prompt
    isProcessing = true;
    await fs.appendFile(sessionFile, `\n## User\n\n${trimmed}\n\n`).catch(console.error);

    try {
      await orchestrator.prompt(trimmed);
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error(pc.red((error as Error).message));
      }
    } finally {
      isProcessing = false;
      rl.prompt();
    }
  };

  rl.on('line', (input) => {
    if (!isProcessing) {
      processInput(input);
    }
  });

  rl.on('close', () => {
    process.exit(0);
  });

  rl.prompt();
}