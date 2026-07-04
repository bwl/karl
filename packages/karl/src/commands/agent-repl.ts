import * as readline from 'readline';
import path from 'path';
import { promises as fs } from 'fs';
import { execSync } from 'child_process';
import {
  Orchestrator,
  discoverAgentContextFiles,
  resolveKarlInvocation,
  type OrchestratorEvent
} from '../orchestrator.js';
import type { KarlConfig } from '../types.js';
import pc from 'picocolors';
import { getSpinnerFrame, highlight, detectVisuals } from '../utils/visuals.js';
import { formatDuration, resolveHomePath } from '../utils.js';

const AGENT_ORIENTATION_VERSION = 1;
const AGENT_ORIENTATION_STATE = path.join('.karl', 'agent-state.json');

// Format token count with K/M suffixes
function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

// Get git branch and dirty status
function getGitBranch(): string | null {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 500,
    }).trim();
    const status = execSync('git status --porcelain 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 500,
    }).trim();
    return branch + (status.length > 0 ? '*' : '');
  } catch {
    return null;
  }
}

// Get project name from cwd
function getProjectName(): string {
  return path.basename(process.cwd());
}

function formatTaskTitle(task: string, maxLength = 96): string {
  const singleLine = task.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, maxLength - 3)}...`;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readContextTitle(file: string): Promise<string> {
  try {
    const content = await fs.readFile(path.join(process.cwd(), file), 'utf8');
    const title = content.split(/\r?\n/).find((line) => /^#\s+/.test(line.trim()));
    if (title) return title.replace(/^#\s+/, '').trim();

    const status = content.split(/\r?\n/).find((line) => /^status:/i.test(line.trim()));
    if (status) return status.trim();
  } catch {
    // A missing title should not block startup.
  }
  return 'project guidance';
}

function askOrientation(question: string): Promise<string> {
  const prompt = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
  });

  return new Promise((resolve) => {
    prompt.question(question, (answer) => {
      prompt.close();
      resolve(answer.trim());
    });
  });
}

async function writeOrientationState(contextFiles: string[]): Promise<void> {
  const statePath = path.join(process.cwd(), AGENT_ORIENTATION_STATE);
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify({
    version: AGENT_ORIENTATION_VERSION,
    confirmedAt: new Date().toISOString(),
    contextFiles,
  }, null, 2) + '\n');
}

async function maybeRunAgentOrientation(contextFiles: string[]): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;

  const statePath = path.join(process.cwd(), AGENT_ORIENTATION_STATE);
  if (await pathExists(statePath)) return;

  const project = getProjectName();
  console.log('');
  console.log(pc.bold(`First time with Karl Agent in ${project}`));
  console.log(pc.dim('Ok, here is the situation as I understand it:'));

  if (contextFiles.length === 0) {
    console.log(`  ${pc.yellow('!')} I did not find project-level agent guidance.`);
    console.log(`  ${pc.dim('Add .karl/agent.md, AGENTS.md, WORKFLOW.md, or MAINTENANCE.md if this project has an operating contract.')}`);
  } else {
    console.log(`  ${pc.green('✓')} I will load these project guidance files before each turn:`);
    for (const file of contextFiles) {
      const title = await readContextTitle(file);
      console.log(`    - ${file}${pc.dim(` — ${title}`)}`);
    }
  }

  console.log(`  ${pc.green('✓')} I will use cheap read-only tools for orientation, then delegate real work to Karl.`);
  console.log(`  ${pc.green('✓')} I will treat .karl/agent.md as the strongest project-specific coordinator note if you add one.`);
  console.log('');

  const answer = (await askOrientation('Does this look good? [Y/n] ')).toLowerCase();
  if (answer === '' || answer === 'y' || answer === 'yes') {
    try {
      await writeOrientationState(contextFiles);
      console.log(pc.dim(`Saved orientation approval to ${AGENT_ORIENTATION_STATE}`));
    } catch (error) {
      console.log(pc.dim(`Could not save orientation approval: ${(error as Error).message}`));
    }
    console.log('');
    return;
  }

  console.log(pc.dim('No problem. I will continue without saving approval.'));
  console.log(pc.dim('Add or edit .karl/agent.md to teach Karl Agent the project-specific coordinator brief.'));
  console.log('');
}

interface AgentOptions {
  plain?: boolean;
  visuals?: string;
}

export function printAgentHelp(): void {
  console.log(`Karl Agent

Usage:
  karl agent [--plain] [--visuals MODE]

Interactive coordinator for longer Karl sessions.

Agent-side tools:
  list_files     Quick read-only directory listings
  read_file      Bounded read-only text file slices
  search_files   Read-only ripgrep search
  ivo_context    Broad context packs for large codebase questions
  karl           Delegate implementation, shell work, tests, git, and edits
  karl_cli       Manage Karl config, stacks, models, providers, and skills

Project context:
  Loads .karl/agent.md, WORKFLOW.md, AGENTS.md/CLAUDE.md, MAINTENANCE.md, and .karl/context.md when present.
  On first interactive run in a project, asks you to confirm the discovered operating context.

Session commands:
  /reset         Clear conversation history
  /calls         List nested Karl calls
  raw N          Show raw output for nested Karl call N
  /help          Show in-session help
  /exit          Quit

Environment:
  KARL_AGENT_COMMAND='bun /path/to/cli.ts' karl agent
`);
}

export async function handleAgentRepl(config: KarlConfig, options: AgentOptions = {}): Promise<void> {
  // Session auto-save setup
  const sessionDir = resolveHomePath('~/.config/karl/agent');
  const sessionId = `agent-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}`;
  let sessionFile: string | null = path.join(sessionDir, `${sessionId}.md`);
  try {
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(sessionFile, `# Karl Agent Session ${sessionId}\n\n`);
    console.log(pc.gray(`📝 Session: ${path.basename(sessionFile)} (full log: ${sessionFile})`));
  } catch (error) {
    sessionFile = null;
    console.log(pc.gray(`Session log disabled: ${(error as Error).message}`));
  }

  const karlInvocation = resolveKarlInvocation();
  const orchestrator = new Orchestrator(config, { karlInvocation });
  const state = orchestrator.snapshot;

  const override = options.plain ? 'plain' : options.visuals || 'auto';
  const visualsMode = detectVisuals(override);

  console.log(`${pc.bold('Karl Agent')} ${pc.dim(`(${state.model} via ${state.provider})`)}`);
  console.log(pc.dim(`Karl command: ${karlInvocation.display}`));
  const contextFiles = discoverAgentContextFiles();
  if (contextFiles.length > 0) {
    console.log(pc.dim(`Project context: ${contextFiles.join(', ')}`));
  }
  await maybeRunAgentOrientation(contextFiles);
  console.log(pc.dim('Commands: /reset, /exit, /calls, /help, raw N, Ctrl+C'));
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
  let totalTokens = 0;
  let streamedAssistantText = '';
  let assistantLineOpen = false;

  const resetAssistantStream = () => {
    streamedAssistantText = '';
    assistantLineOpen = false;
  };

  const writeAssistantDelta = (text: string) => {
    process.stdout.write(text);
    streamedAssistantText += text;
    assistantLineOpen = !text.endsWith('\n');
  };

  const closeAssistantLine = () => {
    if (assistantLineOpen) {
      process.stdout.write('\n');
      assistantLineOpen = false;
    }
  };

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
        writeAssistantDelta(event.text);
        break;

      case 'ivo_start': {
        closeAssistantLine();
        // Status bar separator for ivo
        const termWidth = process.stdout.columns || 80;
        const project = getProjectName();
        const branch = getGitBranch();
        const tokensStr = formatTokens(totalTokens);

        const parts: string[] = ['ivo'];
        if (branch) parts.push(branch);
        if (project !== 'ivo') parts.push(project);
        parts.push(`${tokensStr} tokens`);

        const info = parts.join(' ');
        const padding = Math.max(0, termWidth - info.length - 8);
        const leftPad = Math.floor(padding / 2);
        const rightPad = padding - leftPad;
        const statusLine = pc.dim('─'.repeat(leftPad) + ' ') + pc.magenta(info) + pc.dim(' ' + '─'.repeat(rightPad));

        console.log('\n' + statusLine);
        console.log(`${pc.magenta('▸')} ${pc.magenta('ivo')} ${pc.dim(`"${event.task}"`)}`);
        break;
      }

      case 'ivo_end': {
        if (event.contextId) {
          const budgetUsage = event.budget > 0 ? ` (${((event.tokens / event.budget) * 100).toFixed(0)}%)` : '';
          console.log(`${pc.green('✓')} Context: ${pc.cyan(event.contextId)} ${pc.dim(`${event.files} files, ${formatTokens(event.tokens)} tokens${budgetUsage}`)}`);
        } else {
          console.log(`${pc.red('✗')} Context preparation failed`);
        }
        break;
      }

      case 'agent_tool_start':
        closeAssistantLine();
        console.log(`${pc.blue('▸')} ${pc.blue(event.tool)} ${pc.dim(event.detail)}`);
        break;

      case 'agent_tool_end': {
        const statusIcon = event.success ? pc.green('✓') : pc.red('✗');
        console.log(`${statusIcon} ${pc.dim(event.tool)} ${pc.dim(event.summary)} ${pc.dim(`[${formatDuration(event.durationMs)}]`)}`);
        break;
      }

      case 'karl_start': {
        closeAssistantLine();
        currentBuffer = '';
        const taskTitle = formatTaskTitle(event.task);
        currentCallInfo = `${event.command} "${taskTitle}"`;
        callStartTime = Date.now();
        callNum++;

        // Status bar separator: ─── karl master* 12.5K tokens ───
        const termWidth = process.stdout.columns || 80;
        const project = getProjectName();
        const branch = getGitBranch();
        const tokensStr = formatTokens(totalTokens);

        const parts: string[] = ['karl'];
        if (branch) parts.push(branch);
        if (project !== 'karl') parts.push(project);
        parts.push(`${tokensStr} tokens`);

        const info = parts.join(' ');
        const padding = Math.max(0, termWidth - info.length - 8);
        const leftPad = Math.floor(padding / 2);
        const rightPad = padding - leftPad;
        const statusLine = pc.dim('─'.repeat(leftPad) + ' ') + pc.cyan(info) + pc.dim(' ' + '─'.repeat(rightPad));

        console.log('\n' + statusLine);

        // Header: ▸ karl run "task"
        const header = `${pc.cyan('▸')} ${pc.cyan('karl')} ${event.command} ${pc.dim(`"${taskTitle}"`)}`;
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
      }

      case 'karl_output':
        currentBuffer += event.chunk;
        break;

      case 'karl_end': {
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

        callHistory.push({ num: callNum, info: currentCallInfo, raw: currentBuffer, durationMs: durMs });

        // Append to session MD with embedded raw
        const mdKarl = `\n### Karl Call ${callNum}: ${currentCallInfo}\n\`\`\`\n${currentBuffer.trim()}\n\`\`\`\n\n`;
        if (sessionFile) {
          fs.appendFile(sessionFile, mdKarl).catch(console.error);
        }
        break;
      }

      case 'response':
        if (event.text.trim() && !streamedAssistantText.includes(event.text.trim())) {
          closeAssistantLine();
          console.log(`\n${event.text}`);
        } else {
          closeAssistantLine();
        }
        // Append response to MD
        const mdResp = `\n## Agent\n\n${event.text}\n\n---\n\n`;
        if (sessionFile) {
          fs.appendFile(sessionFile, mdResp).catch(console.error);
        }
        break;

      case 'usage':
        totalTokens += event.tokens.total ?? 0;
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
        if (sessionFile) {
          await fs.appendFile(sessionFile, `\n--- Session ended ---\n`);
        }
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
        printAgentHelp();
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
    resetAssistantStream();
    if (sessionFile) {
      await fs.appendFile(sessionFile, `\n## User\n\n${trimmed}\n\n`).catch(console.error);
    }

    try {
      await orchestrator.prompt(trimmed);
    } catch (error) {
      // The orchestrator emits user-facing errors; avoid printing the same
      // thrown provider/tool error a second time here.
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
