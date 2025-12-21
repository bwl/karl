/**
 * RepoPrompt Backend - wraps rp-cli for context intelligence
 */

import { spawn } from 'child_process';
import type { IvoBackend } from './types.js';
import type {
  TreeOptions,
  SearchOptions,
  SearchResult,
  StructureOptions,
  StructureResult,
  SelectionResult,
  ContextOptions,
  ContextResult,
  ContextFile,
  RepoPromptNotRunningError,
  IvoError,
} from '../types.js';

const RP_CLI = 'rp-cli';
const RP_NOT_RUNNING_EXIT_CODE = 73;

interface RpCliResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number;
}

export class RepoPromptBackend implements IvoBackend {
  readonly name = 'repoprompt';

  /**
   * Execute an rp-cli command
   */
  private async exec(command: string): Promise<RpCliResult> {
    return new Promise((resolve) => {
      const proc = spawn(RP_CLI, ['-e', command], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        resolve({
          success: code === 0,
          output: stdout.trim(),
          error: stderr.trim() || undefined,
          exitCode: code ?? 1,
        });
      });

      proc.on('error', (err) => {
        resolve({
          success: false,
          output: '',
          error: err.message,
          exitCode: 1,
        });
      });
    });
  }

  /**
   * Execute and parse JSON output
   */
  private async execJson<T>(command: string): Promise<T> {
    const result = await this.exec(command);

    if (result.exitCode === RP_NOT_RUNNING_EXIT_CODE) {
      throw new (class extends Error {
        name = 'RepoPromptNotRunningError';
        code = 'BACKEND_NOT_AVAILABLE';
        constructor() {
          super(
            'RepoPrompt is not running. Please launch RepoPrompt.app and ensure MCP Server is enabled in Settings > MCP.'
          );
        }
      })();
    }

    if (!result.success) {
      throw new (class extends Error {
        name = 'IvoError';
        code = 'RP_CLI_ERROR';
        constructor() {
          super(`rp-cli error: ${result.error || result.output}`);
        }
      })();
    }

    try {
      return JSON.parse(result.output) as T;
    } catch {
      // Some commands return plain text, not JSON
      return result.output as unknown as T;
    }
  }

  /**
   * Execute and return raw output
   */
  private async execRaw(command: string): Promise<string> {
    const result = await this.exec(command);

    if (result.exitCode === RP_NOT_RUNNING_EXIT_CODE) {
      throw new (class extends Error {
        name = 'RepoPromptNotRunningError';
        code = 'BACKEND_NOT_AVAILABLE';
        constructor() {
          super(
            'RepoPrompt is not running. Please launch RepoPrompt.app and ensure MCP Server is enabled in Settings > MCP.'
          );
        }
      })();
    }

    if (!result.success) {
      throw new (class extends Error {
        name = 'IvoError';
        code = 'RP_CLI_ERROR';
        constructor() {
          super(`rp-cli error: ${result.error || result.output}`);
        }
      })();
    }

    return result.output;
  }

  // =========================================================================
  // IvoBackend Implementation
  // =========================================================================

  async isAvailable(): Promise<boolean> {
    try {
      const result = await this.exec('workspace list');
      return result.exitCode !== RP_NOT_RUNNING_EXIT_CODE;
    } catch {
      return false;
    }
  }

  async getTree(opts?: TreeOptions): Promise<string> {
    let cmd = 'tree';

    if (opts?.mode === 'folders') {
      cmd += ' --folders';
    } else if (opts?.mode === 'selected') {
      cmd += ' --mode selected';
    }

    if (opts?.path) {
      cmd += ` "${opts.path}"`;
    }

    if (opts?.maxDepth !== undefined) {
      cmd += ` --max-depth ${opts.maxDepth}`;
    }

    return this.execRaw(cmd);
  }

  async search(pattern: string, opts?: SearchOptions): Promise<SearchResult> {
    let cmd = `search "${pattern.replace(/"/g, '\\"')}"`;

    if (opts?.mode && opts.mode !== 'auto') {
      cmd += ` --mode ${opts.mode}`;
    }

    if (opts?.extensions?.length) {
      cmd += ` --extensions ${opts.extensions.join(',')}`;
    }

    if (opts?.contextLines !== undefined) {
      cmd += ` --context-lines ${opts.contextLines}`;
    }

    if (opts?.maxResults !== undefined) {
      cmd += ` --max-results ${opts.maxResults}`;
    }

    if (opts?.regex === false) {
      cmd += ' --regex false';
    }

    const output = await this.execRaw(cmd);

    // Parse markdown output
    // Format: "**Total matches**: X across Y files"
    // File lines: "📄 `path` — N matches"
    // Match lines: "   12 │ ▶ content"
    const matches: SearchResult['matches'] = [];
    let totalMatches = 0;
    let truncated = false;

    // Extract total matches
    const totalMatch = output.match(/\*\*Total matches\*\*:\s*(\d+)/);
    if (totalMatch) {
      totalMatches = parseInt(totalMatch[1], 10);
    }

    // Check for truncation
    if (output.includes('limit reached') || output.includes('truncated')) {
      truncated = true;
    }

    // Extract matches from content sections
    // Pattern: file header followed by match lines
    let currentFile = '';
    const lines = output.split('\n');

    for (const line of lines) {
      // File header: "#### 📄 `path` — N matches"
      const fileMatch = line.match(/^#{1,4}\s*📄\s*`([^`]+)`/);
      if (fileMatch) {
        currentFile = fileMatch[1];
        continue;
      }

      // Match line: "   12 │ ▶ content" or "   12 │ content"
      const matchLine = line.match(/^\s*(\d+)\s*│\s*▶?\s*(.*)$/);
      if (matchLine && currentFile) {
        matches.push({
          path: currentFile,
          line: parseInt(matchLine[1], 10),
          content: matchLine[2].trim(),
        });
      }
    }

    return {
      pattern,
      matches,
      totalMatches,
      truncated,
    };
  }

  async getStructure(paths: string[], opts?: StructureOptions): Promise<StructureResult> {
    let cmd = 'structure';

    if (opts?.scope === 'selected') {
      cmd += ' --scope selected';
    } else if (paths.length > 0) {
      cmd += ' ' + paths.map((p) => `"${p}"`).join(' ');
    }

    if (opts?.maxResults !== undefined) {
      cmd += ` --max-results ${opts.maxResults}`;
    }

    // rp-cli returns markdown, but structure parsing is complex
    // For now, return empty codemaps but store raw output for display
    const output = await this.execRaw(cmd);

    // Parse file paths from the markdown output
    // Format: "📄 `path` — language" or similar
    const codemaps: StructureResult['codemaps'] = [];
    const fileMatches = output.matchAll(/📄\s*`([^`]+)`\s*—\s*(\w+)/g);

    for (const match of fileMatches) {
      codemaps.push({
        path: match[1],
        language: match[2] || 'unknown',
        exports: [],
        classes: [],
        functions: [],
        types: [],
        dependencies: [],
      });
    }

    return {
      codemaps,
      filesWithoutCodemap: [],
    };
  }

  /**
   * Get raw structure output (for display)
   */
  async getStructureRaw(paths: string[], opts?: StructureOptions): Promise<string> {
    let cmd = 'structure';

    if (opts?.scope === 'selected') {
      cmd += ' --scope selected';
    } else if (paths.length > 0) {
      cmd += ' ' + paths.map((p) => `"${p}"`).join(' ');
    }

    return this.execRaw(cmd);
  }

  async getSelection(): Promise<SelectionResult> {
    // rp-cli outputs markdown, so we need to parse it
    const output = await this.execRaw('select get');

    // Parse the markdown output
    // Format: "**X total tokens**" and file lines like "└── file.ts — 123 tokens (full)"
    const files: SelectionResult['files'] = [];
    let totalTokens = 0;

    // Extract total tokens from "**X total tokens**" or "**X,XXX total tokens**"
    const totalMatch = output.match(/\*\*([0-9,]+)\s+total tokens\*\*/);
    if (totalMatch) {
      totalTokens = parseInt(totalMatch[1].replace(/,/g, ''), 10);
    }

    // Extract files from lines like:
    // └── cli.ts — 506 tokens (full)
    // ├── types.ts — 200 tokens (codemap)
    const fileRegex = /[└├─│\s]+([^\s—]+)\s+—\s+([0-9,]+)\s+tokens\s+\((\w+)\)/g;
    let match;
    while ((match = fileRegex.exec(output)) !== null) {
      const [, filename, tokens, mode] = match;
      files.push({
        path: filename,
        tokens: parseInt(tokens.replace(/,/g, ''), 10),
        mode: mode as 'full' | 'codemap' | 'slice',
      });
    }

    return {
      files,
      totalTokens,
    };
  }

  async setSelection(paths: string[]): Promise<void> {
    if (paths.length === 0) {
      await this.clearSelection();
      return;
    }
    const pathArgs = paths.map((p) => `"${p}"`).join(' ');
    await this.execRaw(`select set ${pathArgs}`);
  }

  async addToSelection(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const pathArgs = paths.map((p) => `"${p}"`).join(' ');
    await this.execRaw(`select add ${pathArgs}`);
  }

  async removeFromSelection(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const pathArgs = paths.map((p) => `"${p}"`).join(' ');
    await this.execRaw(`select remove ${pathArgs}`);
  }

  async clearSelection(): Promise<void> {
    await this.execRaw('select clear');
  }

  async buildContext(task: string, opts?: ContextOptions): Promise<ContextResult> {
    // Step 1: Use the builder to explore and select files
    let builderCmd = `builder "${task.replace(/"/g, '\\"')}"`;

    if (opts?.includePlan || opts?.responseType === 'plan') {
      builderCmd += ' --response-type plan';
    } else if (opts?.responseType === 'question') {
      builderCmd += ' --response-type question';
    }

    // Builder returns markdown with status, selection, and possibly a response
    const builderOutput = await this.execRaw(builderCmd);

    // Extract plan/response if present (after "## Response" or "## Plan" header)
    let plan: string | undefined;
    const responseMatch = builderOutput.match(/##\s*(Response|Plan|Answer)\s*\n([\s\S]*?)(?=\n##|\n---|\n\*\*|$)/i);
    if (responseMatch) {
      plan = responseMatch[2].trim();
    }

    // Extract chat_id if present
    let chatId: string | undefined;
    const chatIdMatch = builderOutput.match(/chat[_-]?id[:\s]+([a-f0-9-]+)/i);
    if (chatIdMatch) {
      chatId = chatIdMatch[1];
    }

    // Step 2: Get the full context
    const contextResult = await this.getWorkspaceContext(opts);

    return {
      task,
      files: contextResult.files,
      totalTokens: contextResult.totalTokens,
      budget: opts?.budget,
      plan,
      prompt: contextResult.prompt,
      tree: contextResult.tree,
      chatId,
    };
  }

  async getWorkspaceContext(opts?: ContextOptions): Promise<ContextResult> {
    // Get context with files included
    const cmd = 'context --include prompt,selection,code,files,tokens';
    const output = await this.execRaw(cmd);

    // Parse the markdown output
    const files: ContextFile[] = [];
    let totalTokens = 0;
    let prompt: string | undefined;

    // Extract total tokens from "**X,XXX total tokens**"
    const tokensMatch = output.match(/\*\*([0-9,]+)\s+total tokens\*\*/i);
    if (tokensMatch) {
      totalTokens = parseInt(tokensMatch[1].replace(/,/g, ''), 10);
    }

    // Extract files from tree-style listing under "### Selected Files"
    // Format: "└── file.ts — 506 tokens (full)"
    const fileRegex = /[└├─│\s]+([^\s—]+)\s+—\s+([0-9,]+)\s+tokens\s+\((\w+)\)/g;
    let match;
    while ((match = fileRegex.exec(output)) !== null) {
      const [, filename, tokens, mode] = match;
      files.push({
        path: filename,
        tokens: parseInt(tokens.replace(/,/g, ''), 10),
        mode: mode as 'full' | 'codemap' | 'slice',
      });
    }

    // Extract codemaps content from "### Code Maps" section
    // Format: "File: path\nImports:\n  - ...\nClasses:\n  - ..."
    const codemapsSection = output.match(/###\s*Code\s*Maps[\s\S]*?```text\n([\s\S]*?)```/i);
    if (codemapsSection) {
      const codemapContent = codemapsSection[1];
      // Find matching files and add codemap content
      const fileBlocks = codemapContent.split(/^File:\s*/m);
      for (let i = 1; i < fileBlocks.length; i++) {
        const block = fileBlocks[i];
        const pathMatch = block.match(/^([^\n]+)/);
        if (pathMatch) {
          const path = pathMatch[1].trim();
          const file = files.find((f) => path.endsWith(f.path) || f.path.endsWith(path.split('/').pop() || ''));
          if (file) {
            file.codemap = 'File: ' + block.trim();
          }
        }
      }
    }

    return {
      task: '',
      files,
      totalTokens: totalTokens || files.reduce((sum, f) => sum + f.tokens, 0),
      prompt,
    };
  }
}

// Register this backend
import { registerBackend } from './types.js';
registerBackend('repoprompt', () => new RepoPromptBackend());
