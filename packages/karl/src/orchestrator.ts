/**
 * Karl Orchestrator
 *
 * Interactive agent that orchestrates work through karl CLI calls.
 * Inspired by pi-agent patterns but focused on karl orchestration.
 */

import { spawn } from 'child_process';
import { agentLoop, type AgentLoopConfig, type ToolDefinition, type Message } from './agent-loop.js';
import type { KarlConfig } from './types.js';
import { resolveAgentModel } from './config.js';
import { getProviderOAuthToken } from './oauth.js';

// ============================================================================
// Types
// ============================================================================

export interface OrchestratorState {
  messages: Message[];
  model: string;
  provider: string;
  isStreaming: boolean;
}

export type OrchestratorEvent =
  | { type: 'thinking'; text: string }
  | { type: 'karl_start'; command: string; task: string }
  | { type: 'karl_output'; chunk: string }
  | { type: 'karl_end'; result: string; success: boolean; durationMs: number }
  | { type: 'response'; text: string }
  | { type: 'error'; error: Error }
  | { type: 'done' };

type Listener = (event: OrchestratorEvent) => void;

// ============================================================================
// System Prompt
// ============================================================================

const ORCHESTRATOR_SYSTEM_PROMPT = `You are an orchestrator that accomplishes tasks by running karl commands.

## Your Tool

You have one tool: \`karl\` - which runs karl CLI commands.

Examples:
- karl(command: "run", task: "build a login form")
- karl(command: "think", task: "design architecture for X")
- karl(command: "debug", task: "fix the test failures")
- karl(command: "continue", task: "now add tests") - chains from previous run

## Available Karl Commands

- \`run\` - Execute a task (default stack)
- \`think\` - Reason through a problem (if stack exists)
- \`debug\` - Investigate and fix issues (if stack exists)
- \`continue\` - Chain from the previous karl run
- \`<stack>\` - Use any named stack (review, build, etc.)

## Flags

Common flags you can pass:
- \`--verbose\` or \`-v\` - Stream thoughts and tool calls
- \`--timeout 10m\` - Set timeout (default 2 minutes)
- \`--continue\` or \`-c\` - Chain from last run (alternative to continue command)

## Strategy

1. Break complex requests into manageable steps
2. Use karl to accomplish each step
3. Chain results using "continue" command when building on previous work
4. Ask karl to verify/test when appropriate

## Important Notes

- Karl tasks can take several minutes - be patient
- Each karl call is stateless unless you use continue/--continue
- You cannot read or write files directly - delegate everything to karl
- Focus on high-level coordination, let karl handle the details`;

// ============================================================================
// Karl Tool
// ============================================================================

function createKarlTool(emit: (event: OrchestratorEvent) => void, signal?: AbortSignal): ToolDefinition {
  return {
    name: 'karl',
    description: 'Run a karl command to accomplish a task. Karl is a coding agent with access to bash, read, write, and edit tools.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The karl command: "run", "continue", or a stack name like "think", "debug", "review"'
        },
        task: {
          type: 'string',
          description: 'The task description or prompt for karl'
        },
        flags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional flags like ["--verbose", "--timeout", "5m"]'
        }
      },
      required: ['command', 'task']
    },
    execute: async (_toolCallId, params) => {
      const { command, task, flags = [] } = params as { command: string; task: string; flags?: string[] };
      const startTime = Date.now();

      emit({ type: 'karl_start', command, task });

      return new Promise((resolve) => {
        const args = [command, task, ...flags];
        const child = spawn('karl', args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, FORCE_COLOR: '0' }
        });

        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (data: Buffer) => {
          const chunk = data.toString();
          stdout += chunk;
          emit({ type: 'karl_output', chunk });
        });

        child.stderr?.on('data', (data: Buffer) => {
          const chunk = data.toString();
          stderr += chunk;
          emit({ type: 'karl_output', chunk });
        });

        // Handle abort
        const abortHandler = () => {
          child.kill('SIGTERM');
        };
        signal?.addEventListener('abort', abortHandler);

        child.on('close', (code) => {
          signal?.removeEventListener('abort', abortHandler);
          const success = code === 0;
          const result = stdout || stderr || `(no output, exit code: ${code})`;
          const durationMs = Date.now() - startTime;

          emit({ type: 'karl_end', result, success, durationMs });

          resolve({
            content: [{ type: 'text', text: result }],
            isError: !success
          });
        });

        child.on('error', (error) => {
          signal?.removeEventListener('abort', abortHandler);
          const durationMs = Date.now() - startTime;
          emit({ type: 'karl_end', result: error.message, success: false, durationMs });

          resolve({
            content: [{ type: 'text', text: `Error spawning karl: ${error.message}` }],
            isError: true
          });
        });
      });
    }
  };
}

// ============================================================================
// Orchestrator Class
// ============================================================================

export class Orchestrator {
  private state: OrchestratorState;
  private listeners = new Set<Listener>();
  private abortController: AbortController | null = null;
  private config: KarlConfig;

  constructor(config: KarlConfig) {
    this.config = config;

    const resolved = resolveAgentModel(config);
    this.state = {
      messages: [],
      model: resolved.model,
      provider: resolved.providerKey,
      isStreaming: false
    };
  }

  /**
   * Get current state (read-only snapshot)
   */
  get snapshot(): Readonly<OrchestratorState> {
    return { ...this.state };
  }

  /**
   * Subscribe to events
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: OrchestratorEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Send a prompt and stream responses
   */
  async prompt(userMessage: string): Promise<void> {
    if (this.state.isStreaming) {
      throw new Error('Already streaming - call abort() first');
    }

    this.state.isStreaming = true;
    this.abortController = new AbortController();

    // Add user message to history
    this.state.messages.push({ role: 'user', content: userMessage });

    try {
      const resolved = resolveAgentModel(this.config);

      // Resolve API key based on auth type
      let apiKey: string | null | undefined;
      if (resolved.providerConfig.authType === 'oauth') {
        apiKey = await getProviderOAuthToken(resolved.providerKey);
      } else {
        apiKey = resolved.providerConfig.apiKey;
      }

      if (!apiKey || apiKey.includes('${')) {
        throw new Error(`No credentials found for provider: ${resolved.providerKey}`);
      }

      if (!resolved.providerConfig.baseUrl) {
        throw new Error(`No baseUrl for provider: ${resolved.providerKey}`);
      }

      const loopConfig: AgentLoopConfig = {
        model: resolved.model,
        baseUrl: resolved.providerConfig.baseUrl,
        apiKey,
        maxToolRounds: 20,
        signal: this.abortController.signal
      };

      const karlTool = createKarlTool(
        (event) => this.emit(event),
        this.abortController.signal
      );

      // Build full message history for agent loop
      // Note: agentLoop takes systemPrompt + userMessage, but we need multi-turn
      // We'll concatenate previous messages into the user message for now
      const historyContext = this.buildHistoryContext();
      const fullPrompt = historyContext
        ? `${historyContext}\n\nUser: ${userMessage}`
        : userMessage;

      const loop = agentLoop(
        ORCHESTRATOR_SYSTEM_PROMPT,
        fullPrompt,
        [karlTool],
        loopConfig
      );

      let responseText = '';

      while (true) {
        const { value, done } = await loop.next();

        if (done) {
          // Generator returned
          break;
        }

        const event = value;

        switch (event.type) {
          case 'text_delta':
            responseText += event.delta;
            this.emit({ type: 'thinking', text: event.delta });
            break;

          case 'text_end':
            responseText = event.text;
            break;

          case 'turn_end':
            // Add assistant response to history
            if (event.message.content) {
              this.state.messages.push({
                role: 'assistant',
                content: event.message.content
              });
              this.emit({ type: 'response', text: event.message.content });
            }
            break;

          case 'error':
            throw event.error;
        }
      }

      this.emit({ type: 'done' });
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        this.emit({ type: 'error', error: error as Error });
      }
      throw error;
    } finally {
      this.state.isStreaming = false;
      this.abortController = null;
    }
  }

  /**
   * Abort current streaming operation
   */
  abort(): void {
    this.abortController?.abort();
  }

  /**
   * Reset conversation history
   */
  reset(): void {
    this.state.messages = [];
    this.abort();
  }

  /**
   * Build context from previous messages for multi-turn
   */
  private buildHistoryContext(): string {
    if (this.state.messages.length <= 1) {
      return '';
    }

    // Skip the last message (it's the current user message we're about to send)
    const history = this.state.messages.slice(0, -1);
    if (history.length === 0) {
      return '';
    }

    return history
      .map((msg) => {
        const role = msg.role === 'user' ? 'User' : 'Assistant';
        return `${role}: ${msg.content}`;
      })
      .join('\n\n');
  }
}
