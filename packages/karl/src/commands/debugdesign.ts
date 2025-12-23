/**
 * Debug Design Mode - UI simulation for design work
 *
 * Simulates multi-tool agent sessions using live UI components
 * without making actual LLM calls.
 */

import { Spinner } from '../spinner.js';
import { StatusWriter } from '../status.js';
import type { SchedulerEvent } from '../types.js';

interface SimulatedEvent {
  delay: number;  // ms to wait before firing
  event: SchedulerEvent;
}

type Scenario = 'realistic' | 'stress' | 'errors' | 'all';
type Speed = 'slow' | 'normal' | 'fast' | 'instant';

const SPEED_MULTIPLIERS: Record<Speed, number> = {
  slow: 2.0,
  normal: 1.0,
  fast: 0.5,
  instant: 0
};

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

function now(): number {
  return Date.now();
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

function getRealisticScenario(): SimulatedEvent[] {
  const t = now();
  return [
    // Initial thinking
    { delay: 500, event: { type: 'thinking', taskIndex: 0, text: 'Let me find the form component...', time: t } },

    // Search for files
    { delay: 200, event: { type: 'tool_start', taskIndex: 0, tool: 'search', detail: '**/form*.tsx', time: t } },
    { delay: 800, event: { type: 'tool_end', taskIndex: 0, tool: 'search', success: true, time: t } },

    // Read the form file
    { delay: 100, event: { type: 'tool_start', taskIndex: 0, tool: 'read', detail: 'src/components/UserForm.tsx', time: t } },
    { delay: 400, event: { type: 'tool_end', taskIndex: 0, tool: 'read', success: true, time: t } },

    // Think about the solution
    { delay: 300, event: { type: 'thinking', taskIndex: 0, text: 'I see the form lacks validation. Let me add a schema using zod...', time: t } },

    // Read validation utils
    { delay: 150, event: { type: 'tool_start', taskIndex: 0, tool: 'read', detail: 'src/utils/validation.ts', time: t } },
    { delay: 300, event: { type: 'tool_end', taskIndex: 0, tool: 'read', success: true, time: t } },

    // Edit validation file
    { delay: 200, event: { type: 'tool_start', taskIndex: 0, tool: 'edit', detail: 'src/utils/validation.ts', time: t } },
    { delay: 600, event: { type: 'tool_end', taskIndex: 0, tool: 'edit', success: true, time: t } },

    // Edit form component
    { delay: 150, event: { type: 'tool_start', taskIndex: 0, tool: 'edit', detail: 'src/components/UserForm.tsx', time: t } },
    { delay: 700, event: { type: 'tool_end', taskIndex: 0, tool: 'edit', success: true, time: t } },

    // Run tests
    { delay: 200, event: { type: 'thinking', taskIndex: 0, text: 'Let me run the tests to make sure everything works...', time: t } },
    { delay: 100, event: { type: 'tool_start', taskIndex: 0, tool: 'bash', detail: 'bun test', time: t } },
    { delay: 2000, event: { type: 'tool_end', taskIndex: 0, tool: 'bash', success: true, time: t } },

    // Run linter
    { delay: 100, event: { type: 'tool_start', taskIndex: 0, tool: 'bash', detail: 'bun lint', time: t } },
    { delay: 1500, event: { type: 'tool_end', taskIndex: 0, tool: 'bash', success: true, time: t } },

    // Final thinking
    { delay: 200, event: { type: 'thinking', taskIndex: 0, text: 'All tests pass and linting is clean. The validation is complete.', time: t } },
  ];
}

function getStressScenario(): SimulatedEvent[] {
  const t = now();
  const events: SimulatedEvent[] = [];
  const tools = ['read', 'edit', 'bash', 'search', 'list'];
  const files = [
    'src/index.ts', 'src/app.tsx', 'src/utils.ts', 'src/api/client.ts',
    'src/hooks/useAuth.ts', 'src/components/Button.tsx', 'src/styles/main.css',
    'package.json', 'tsconfig.json', 'README.md'
  ];

  // Generate 50 rapid events (25 tool pairs)
  for (let i = 0; i < 25; i++) {
    const tool = tools[i % tools.length];
    const file = files[i % files.length];

    // Quick thinking every 5 tools
    if (i % 5 === 0) {
      events.push({
        delay: 50,
        event: { type: 'thinking', taskIndex: 0, text: `Processing batch ${Math.floor(i / 5) + 1}...`, time: t }
      });
    }

    // Tool start
    events.push({
      delay: 50 + Math.random() * 100,
      event: { type: 'tool_start', taskIndex: 0, tool, detail: file, time: t }
    });

    // Tool end
    events.push({
      delay: 100 + Math.random() * 150,
      event: { type: 'tool_end', taskIndex: 0, tool, success: true, time: t }
    });
  }

  return events;
}

function getErrorsScenario(): SimulatedEvent[] {
  const t = now();
  return [
    // Start with thinking
    { delay: 300, event: { type: 'thinking', taskIndex: 0, text: 'Let me read the config file...', time: t } },

    // File not found error
    { delay: 200, event: { type: 'tool_start', taskIndex: 0, tool: 'read', detail: 'src/config/missing.ts', time: t } },
    { delay: 300, event: { type: 'tool_end', taskIndex: 0, tool: 'read', success: false, error: 'ENOENT: no such file', time: t } },

    // Recovery - try different file
    { delay: 400, event: { type: 'thinking', taskIndex: 0, text: 'File not found. Let me check if it exists elsewhere...', time: t } },
    { delay: 200, event: { type: 'tool_start', taskIndex: 0, tool: 'search', detail: '**/config*.ts', time: t } },
    { delay: 500, event: { type: 'tool_end', taskIndex: 0, tool: 'search', success: true, time: t } },

    // Read the correct file
    { delay: 100, event: { type: 'tool_start', taskIndex: 0, tool: 'read', detail: 'src/config.ts', time: t } },
    { delay: 200, event: { type: 'tool_end', taskIndex: 0, tool: 'read', success: true, time: t } },

    // Bash command fails
    { delay: 300, event: { type: 'thinking', taskIndex: 0, text: 'Let me run the build to check for issues...', time: t } },
    { delay: 150, event: { type: 'tool_start', taskIndex: 0, tool: 'bash', detail: 'bun build', time: t } },
    { delay: 1500, event: { type: 'tool_end', taskIndex: 0, tool: 'bash', success: false, error: 'exit code 1', time: t } },

    // Fix the error
    { delay: 400, event: { type: 'thinking', taskIndex: 0, text: 'Build failed due to type error. Let me fix the type mismatch...', time: t } },
    { delay: 200, event: { type: 'tool_start', taskIndex: 0, tool: 'edit', detail: 'src/api/client.ts', time: t } },
    { delay: 500, event: { type: 'tool_end', taskIndex: 0, tool: 'edit', success: true, time: t } },

    // Retry build - success
    { delay: 150, event: { type: 'tool_start', taskIndex: 0, tool: 'bash', detail: 'bun build', time: t } },
    { delay: 1200, event: { type: 'tool_end', taskIndex: 0, tool: 'bash', success: true, time: t } },

    // Final success
    { delay: 200, event: { type: 'thinking', taskIndex: 0, text: 'Build succeeded after fixing the type error.', time: t } },
  ];
}

function getScenarioEvents(scenario: Scenario): SimulatedEvent[] {
  switch (scenario) {
    case 'realistic':
      return getRealisticScenario();
    case 'stress':
      return getStressScenario();
    case 'errors':
      return getErrorsScenario();
    default:
      return getRealisticScenario();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────────────────────

export async function handleDebugDesign(args: string[]): Promise<void> {
  // Parse arguments
  const helpIdx = args.indexOf('--help');
  if (helpIdx >= 0 || args.includes('-h')) {
    printHelp();
    return;
  }

  // Filter out flags to get scenario
  const scenario = (args.find(a => !a.startsWith('-')) || 'realistic') as Scenario;

  const speedIdx = args.indexOf('--speed');
  const speed = (speedIdx >= 0 && args[speedIdx + 1] ? args[speedIdx + 1] : 'normal') as Speed;

  const verbose = args.includes('--verbose') || args.includes('-v');
  const plain = args.includes('--plain');

  if (!['realistic', 'stress', 'errors', 'all'].includes(scenario)) {
    console.error(`Unknown scenario: ${scenario}`);
    console.error('Valid scenarios: realistic, stress, errors, all');
    process.exitCode = 1;
    return;
  }

  if (!['slow', 'normal', 'fast', 'instant'].includes(speed)) {
    console.error(`Unknown speed: ${speed}`);
    console.error('Valid speeds: slow, normal, fast, instant');
    process.exitCode = 1;
    return;
  }

  await runSimulation(scenario, speed, verbose, plain);
}

async function runSimulation(scenario: Scenario, speed: Speed, verbose: boolean, plain: boolean): Promise<void> {
  const multiplier = SPEED_MULTIPLIERS[speed];
  const visualsOverride = plain ? 'plain' : undefined;

  const scenarios = scenario === 'all'
    ? ['realistic', 'stress', 'errors'] as Scenario[]
    : [scenario];

  for (const sc of scenarios) {
    console.log(`\n  Debug Design Mode: ${sc}`);
    console.log(`  Speed: ${speed}${multiplier !== 1 ? ` (${multiplier}x)` : ''}\n`);

    const spinner = new Spinner(true, verbose, visualsOverride);
    const statusWriter = new StatusWriter(process.cwd(), `Debug: ${sc}`, `debug-${sc}`);
    const events = getScenarioEvents(sc);

    spinner.start(`Simulating ${sc} session...`);

    let toolCount = 0;
    let errorCount = 0;

    for (const { delay, event } of events) {
      await sleep(delay * multiplier);

      if (event.type === 'thinking') {
        spinner.setThinking(event.text);
        statusWriter.onThinking(event.text);
      } else if (event.type === 'tool_start') {
        spinner.toolStart(event.tool, event.detail);
        statusWriter.onToolStart(event.tool, event.detail);
      } else if (event.type === 'tool_end') {
        spinner.toolEnd(event.tool, event.success);
        statusWriter.onToolEnd(event.tool, event.success);
        toolCount++;
        if (!event.success) errorCount++;
      }
    }

    spinner.stop();

    // Summary
    const successCount = toolCount - errorCount;
    console.log(`\n  Simulation complete:`);
    console.log(`    ${toolCount} tool calls (${successCount} success, ${errorCount} errors)`);
    console.log('');
  }
}

function printHelp(): void {
  const help = `karl debugdesign [scenario] [options]

Simulate multi-tool agent sessions for UI design work.

Scenarios:
  realistic     Coding session simulation (default)
  stress        Rapid-fire 50+ tool calls
  errors        Error and recovery patterns
  all           Run all scenarios sequentially

Options:
  --speed <s>   Playback speed: slow, normal, fast, instant
  --verbose     Stream output mode (shows each tool call)
  --plain       ASCII-only output (no unicode)
  --help, -h    Show this help

Examples:
  karl debugdesign                     # Run realistic scenario
  karl debugdesign stress --speed fast # Fast stress test
  karl debugdesign errors --verbose    # Errors with streamed output
  karl dd all --speed instant          # All scenarios, no delays
`;
  console.log(help);
}
