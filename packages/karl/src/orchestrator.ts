/**
 * Karl Orchestrator
 *
 * Interactive agent that orchestrates work through karl CLI calls.
 * Inspired by pi-agent patterns but focused on karl orchestration.
 */

import { spawn } from 'child_process';
import { join } from 'path';
import { agentLoop, type AgentLoopConfig, type ToolDefinition, type Message } from './agent-loop.js';
import type { KarlConfig } from './types.js';
import { resolveAgentModel } from './config.js';
import { getProviderOAuthToken } from './oauth.js';

// ============================================================================
// Types
// ============================================================================

export interface OrchestratorState {
  messages: Message[];
  model: string;      // The raw model ID
  modelAlias: string; // The user-configured alias
  provider: string;
  isStreaming: boolean;
}

export type OrchestratorEvent =
  | { type: 'thinking'; text: string }
  | { type: 'ivo_start'; task: string }
  | { type: 'ivo_end'; contextId: string; files: number; tokens: number; budget: number }
  | { type: 'karl_start'; command: string; task: string }
  | { type: 'karl_output'; chunk: string }
  | { type: 'karl_end'; result: string; success: boolean; durationMs: number }
  | { type: 'response'; text: string }
  | { type: 'usage'; tokens: { input?: number; output?: number; total?: number } }
  | { type: 'error'; error: Error }
  | { type: 'done' };

type Listener = (event: OrchestratorEvent) => void;

// ============================================================================
// System Prompt
// ============================================================================

const ORCHESTRATOR_SYSTEM_PROMPT = `You are a strategic coordinator. You accomplish goals by delegating work to Karl, a capable coding agent.

## How This Works

You think about WHAT needs to happen. Karl figures out HOW to do it.

When you want something done, use the karl() tool and describe what you want in plain English. Karl has access to the filesystem, git, shell commands, and code editing - you don't need to specify the exact commands.

## Examples of Good Delegation

User: "Review changes and commit them in logical chunks"
You think: This is a multi-step task - review what changed, group related changes, commit with good messages
You call: karl("run", "Review all uncommitted changes, group them by logical unit, and create separate commits for each group with descriptive messages")

User: "Fix the authentication bug"
You think: Karl needs to find the bug, understand the auth system, then fix it
You call: karl("run", "Investigate and fix the authentication bug - look at recent changes and error logs to identify the issue")

User: "Add dark mode support"
You think: This is a feature request - Karl should figure out the implementation
You call: karl("run", "Add dark mode support to the application - determine the best approach for this codebase and implement it")

## Your Tools

**karl(command, task)** - Delegate complex work to Karl
- command: Usually "run" for most tasks. Also: "think" (analysis only), "review" (code review)
- task: Describe what you want done in natural language. Be clear about the goal, not the steps.

**karl_cli(args)** - Manage karl configuration and coordination
- Use for: stacks, models, skills, providers, and other meta-operations
- Examples: "stacks list", "stacks create review", "models list", "skills list", "info"
- NOT for actual work - use karl() to delegate grep, read, bash, code changes, etc.

**ivo_context(keywords)** - Pre-load codebase context (optional)
- Use when Karl needs broad context across many files
- Pass comma-separated keywords/synonyms
- Returns a context_id to pass to karl()

## Key Principles

1. **Delegate outcomes, not procedures** - Say "fix the login bug" not "run grep for login, then read the file, then edit line 42"

2. **Trust Karl's judgment** - Karl knows how to use git, read files, and write code. You focus on the goal.

3. **Think in tasks, not commands** - One karl() call can accomplish a lot. Don't micromanage.

4. **Be specific about WHAT, vague about HOW** - "Commit changes in logical groups" is good. "Run git add then git commit" is micromanaging.

5. **Don't gather context yourself** - If Karl needs codebase context, use ivo_context() to prepare it. Don't try to read files and pass their contents manually. Let the tools handle context gathering.`;


// ============================================================================
// Ivo Context Tool
// ============================================================================

type Emitter = (event: OrchestratorEvent) => void;

interface IvoResult {
  contextId: string;
  files: number;
  tokens: number;
  budget: number;
}

/**
 * Get path to ivo context file.
 */
function getIvoContextPath(contextId: string): string {
  return join(process.cwd(), '.ivo', 'contexts', `${contextId}.xml`);
}

/**
 * Call ivo context and parse the output.
 * ivo saves context to .ivo/contexts/{id}.xml and outputs:
 * "a7b2c3d  45 files  28.5k tokens  (89% of 32k)"
 */
async function runIvoContext(keywords: string, budget: number): Promise<IvoResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('ivo', ['context', keywords, '--budget', String(budget)], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' }
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `ivo exited with code ${code}`));
        return;
      }

      // Parse output: "a7b2c3d  45 files  28.5k tokens  (89% of 32k)"
      const idMatch = stdout.match(/^([a-f0-9]{7})/);
      const filesMatch = stdout.match(/(\d+)\s+files/);
      const tokensMatch = stdout.match(/([\d.]+)k?\s+tokens/);

      if (!idMatch) {
        reject(new Error('Failed to parse context ID from ivo output'));
        return;
      }

      const contextId = idMatch[1];
      const files = filesMatch ? parseInt(filesMatch[1], 10) : 0;
      let tokens = 0;
      if (tokensMatch) {
        const val = parseFloat(tokensMatch[1]);
        tokens = tokensMatch[0].includes('k') ? Math.round(val * 1000) : Math.round(val);
      }

      resolve({ contextId, files, tokens, budget });
    });

    child.on('error', (error) => {
      reject(new Error(`Error spawning ivo: ${error.message}`));
    });
  });
}

function createIvoContextTool(emit: Emitter): ToolDefinition {
  return {
    name: 'ivo_context',
    description: 'Pre-load codebase context for complex multi-file tasks. Returns a context_id to pass to karl(). Only use when Karl needs broad context across many files.',
    parameters: {
      type: 'object',
      properties: {
        keywords: {
          type: 'string',
          description: 'Comma-separated keywords to search for. Include synonyms for better coverage.'
        },
        budget: {
          type: 'number',
          description: 'Token budget limit (default: 32000)'
        }
      },
      required: ['keywords']
    },
    execute: async (_toolCallId, params) => {
      const { keywords, budget = 32000 } = params as { keywords: string; budget?: number };

      emit({ type: 'ivo_start', task: keywords });

      try {
        const result = await runIvoContext(keywords, budget);

        emit({
          type: 'ivo_end',
          contextId: result.contextId,
          files: result.files,
          tokens: result.tokens,
          budget
        });

        const budgetUsage = budget > 0 ? `${((result.tokens / budget) * 100).toFixed(0)}%` : 'N/A';
        return {
          content: [{
            type: 'text',
            text: `Context ready: ${result.contextId}\nFiles: ${result.files} | Tokens: ${result.tokens}/${budget} (${budgetUsage})`
          }]
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emit({ type: 'ivo_end', contextId: '', files: 0, tokens: 0, budget });
        return {
          content: [{ type: 'text', text: `Error gathering context: ${message}` }],
          isError: true
        };
      }
    }
  };
}

// ============================================================================
// Karl Tool
// ============================================================================

function createKarlTool(emit: Emitter, signal?: AbortSignal): ToolDefinition {
  return {
    name: 'karl',
    description: 'Delegate a task to Karl, a capable coding agent. Describe what you want done in natural language - Karl handles the details. Karl can read/write files, run shell commands, use git, and edit code.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Usually "run". Use "think" for analysis without changes, "review" for code review.'
        },
        task: {
          type: 'string',
          description: 'What you want Karl to accomplish, in natural language. Focus on the goal, not the steps.'
        },
        context_id: {
          type: 'string',
          description: 'Optional context ID from ivo_context() for complex multi-file tasks.'
        },
        flags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional flags (rarely needed)'
        }
      },
      required: ['command', 'task']
    },
    execute: async (_toolCallId, params) => {
      const { command, task, context_id, flags = [] } = params as {
        command: string;
        task: string;
        context_id?: string;
        flags?: string[];
      };
      const startTime = Date.now();

      emit({ type: 'karl_start', command, task });

      return new Promise((resolve) => {
        const args = [command, task, ...flags];

        // Add context file if context_id provided (loads from .ivo/contexts/)
        if (context_id) {
          const contextPath = getIvoContextPath(context_id);
          args.push('--context-file', contextPath);
        }

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
// Karl CLI Tool (configuration and coordination)
// ============================================================================

function createKarlCliTool(emit: Emitter, signal?: AbortSignal): ToolDefinition {
  return {
    name: 'karl_cli',
    description: 'Manage karl configuration and coordination. Use for stacks, models, skills, providers, and meta-operations. NOT for actual work - use karl() to delegate grep, read, bash, code changes.',
    parameters: {
      type: 'object',
      properties: {
        args: {
          type: 'string',
          description: 'Karl CLI command. Examples: "stacks list", "stacks create review", "models list", "skills list", "providers list", "info"'
        }
      },
      required: ['args']
    },
    execute: async (_toolCallId, params) => {
      const { args } = params as { args: string };
      const startTime = Date.now();

      // Parse args string into array (simple split, handles quoted strings later if needed)
      const argList = args.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
      const command = argList[0] || 'help';

      emit({ type: 'karl_start', command, task: args });

      return new Promise((resolve) => {
        const child = spawn('karl', argList, {
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
      modelAlias: resolved.modelKey,
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

      // Determine provider type and base URL
      const providerType = resolved.providerConfig.type === 'anthropic' ? 'anthropic' : 'openai';
      let baseUrl = resolved.providerConfig.baseUrl;

      // Default baseUrl for Anthropic providers
      if (!baseUrl && providerType === 'anthropic') {
        baseUrl = 'https://api.anthropic.com';
      }

      if (!baseUrl) {
        throw new Error(`No baseUrl for provider: ${resolved.providerKey}`);
      }

      const loopConfig: AgentLoopConfig = {
        model: resolved.model,
        baseUrl,
        apiKey,
        providerType,
        maxToolRounds: 100,  // High limit since orchestrator uses karl tool calls for everything
        signal: this.abortController.signal,
        // Enable extended thinking for orchestrator (benefits from deep reasoning)
        // max_tokens must be > thinking.budgetTokens per Anthropic API requirements
        thinking: providerType === 'anthropic' ? { type: 'enabled', budgetTokens: 8192 } : undefined,
        maxTokens: providerType === 'anthropic' ? 16384 : undefined,
        // Enable prompt caching for cost savings
        cacheControl: providerType === 'anthropic'
      };

      // Tools: ivo_context, karl (agent), and karl_cli (utility)
      const emit = (event: OrchestratorEvent) => this.emit(event);
      const signal = this.abortController.signal;

      const tools = [
        createIvoContextTool(emit),
        createKarlTool(emit, signal),
        createKarlCliTool(emit, signal)
      ];

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
        tools,
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
            // Emit usage if available
            if (event.usage) {
              this.emit({ type: 'usage', tokens: event.usage });
            }
            // Add assistant response to history
            if (event.message.content) {
              this.state.messages.push({
                role: 'assistant',
                content: event.message.content
              });
              this.emit({ type: 'response', text: event.message.content });
            }
            break;

          case 'message_end':
            // Emit usage for each message (intermediate turns)
            if (event.usage) {
              this.emit({ type: 'usage', tokens: event.usage });
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
