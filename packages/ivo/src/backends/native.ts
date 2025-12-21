/**
 * Native Backend - uses standard Unix tools
 *
 * - tree/fd for file trees
 * - ripgrep for search
 * - direct file I/O for content
 * - in-memory state for selection
 */

import { spawn } from 'child_process';
import { readFile, writeFile, stat, mkdir } from 'fs/promises';
import { join, relative, dirname } from 'path';
import { existsSync } from 'fs';
import type { IvoBackend } from './types.js';
import type {
  TreeOptions,
  SearchOptions,
  SearchResult,
  StructureOptions,
  StructureResult,
  SelectionResult,
  SelectionFile,
  ContextOptions,
  ContextResult,
  ContextFile,
  CodeMap,
} from '../types.js';
import { extractCodemap, detectLanguage } from '../codemap/index.js';

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function exec(cmd: string, args: string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (d) => (stdout += d.toString()));
    proc.stderr?.on('data', (d) => (stderr += d.toString()));

    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on('error', () => {
      resolve({ stdout: '', stderr: 'Command not found', exitCode: 127 });
    });
  });
}

/**
 * Simple token estimation (approx 4 chars per token for code)
 * TODO: Use tiktoken or similar for accurate counting
 */
function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

export class NativeBackend implements IvoBackend {
  readonly name = 'native';

  private cwd: string;
  private selection: Map<string, SelectionFile> = new Map();
  private stateFile: string;
  private stateLoaded = false;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
    this.stateFile = join(cwd, '.ivo', 'selection.json');
  }

  private async loadState(): Promise<void> {
    if (this.stateLoaded) return;
    this.stateLoaded = true;

    try {
      if (existsSync(this.stateFile)) {
        const data = await readFile(this.stateFile, 'utf-8');
        const state = JSON.parse(data) as { files: SelectionFile[] };
        this.selection.clear();
        for (const file of state.files || []) {
          this.selection.set(file.path, file);
        }
      }
    } catch {
      // Ignore errors, start with empty selection
    }
  }

  private async saveState(): Promise<void> {
    try {
      const dir = dirname(this.stateFile);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
      const state = { files: Array.from(this.selection.values()) };
      await writeFile(this.stateFile, JSON.stringify(state, null, 2));
    } catch {
      // Ignore save errors
    }
  }

  async isAvailable(): Promise<boolean> {
    // Check if basic tools are available
    const result = await exec('which', ['tree']);
    return result.exitCode === 0;
  }

  // ===========================================================================
  // File Tree
  // ===========================================================================

  async getTree(opts?: TreeOptions): Promise<string> {
    const args: string[] = [];

    // Respect .gitignore
    args.push('--gitignore');

    if (opts?.mode === 'folders') {
      args.push('-d'); // directories only
    }

    if (opts?.maxDepth !== undefined) {
      args.push('-L', String(opts.maxDepth));
    }

    // Add path
    args.push(opts?.path || this.cwd);

    const result = await exec('tree', args);

    if (result.exitCode !== 0) {
      // Fallback to find + simple formatting
      return this.getTreeFallback(opts);
    }

    return result.stdout;
  }

  private async getTreeFallback(opts?: TreeOptions): Promise<string> {
    const args = [opts?.path || this.cwd, '-type', opts?.mode === 'folders' ? 'd' : 'f'];

    if (opts?.maxDepth !== undefined) {
      args.push('-maxdepth', String(opts.maxDepth));
    }

    const result = await exec('find', args);
    return result.stdout;
  }

  // ===========================================================================
  // Search
  // ===========================================================================

  async search(pattern: string, opts?: SearchOptions): Promise<SearchResult> {
    const args: string[] = [];

    // Basic options
    args.push('--json'); // JSON output for easy parsing
    args.push('--line-number');

    if (opts?.caseInsensitive) {
      args.push('-i');
    }

    if (opts?.maxResults) {
      args.push('-m', String(opts.maxResults));
    }

    if (opts?.contextLines) {
      args.push('-C', String(opts.contextLines));
    }

    // File type filters
    if (opts?.extensions?.length) {
      for (const ext of opts.extensions) {
        args.push('-g', `*${ext.startsWith('.') ? ext : '.' + ext}`);
      }
    }

    // Mode
    if (opts?.mode === 'path') {
      args.push('--files');
    }

    // Pattern and path
    args.push(pattern);
    args.push(this.cwd);

    const result = await exec('rg', args);

    if (result.exitCode !== 0 && result.exitCode !== 1) {
      // 1 = no matches, which is fine
      return { pattern, matches: [], totalMatches: 0, truncated: false };
    }

    // Parse ripgrep JSON output
    const matches: SearchResult['matches'] = [];
    const lines = result.stdout.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const data = JSON.parse(line);
        if (data.type === 'match') {
          const match = data.data;
          matches.push({
            path: relative(this.cwd, match.path.text),
            line: match.line_number,
            content: match.lines.text.trim(),
          });
        }
      } catch {
        // Skip malformed lines
      }
    }

    return {
      pattern,
      matches,
      totalMatches: matches.length,
      truncated: opts?.maxResults ? matches.length >= opts.maxResults : false,
    };
  }

  // ===========================================================================
  // Structure (Codemaps)
  // ===========================================================================

  async getStructure(paths: string[], opts?: StructureOptions): Promise<StructureResult> {
    const codemaps: CodeMap[] = [];
    const filesWithoutCodemap: string[] = [];

    // Determine which paths to process
    let filesToProcess: string[] = [];

    if (opts?.scope === 'selected') {
      // Get files from current selection
      await this.loadState();
      filesToProcess = Array.from(this.selection.keys());
    } else if (paths.length > 0) {
      // Process specified paths (expand directories)
      for (const p of paths) {
        const fullPath = join(this.cwd, p);
        try {
          const stats = await stat(fullPath);
          if (stats.isFile()) {
            filesToProcess.push(p);
          } else if (stats.isDirectory()) {
            // Get files from directory
            const result = await exec('find', [
              fullPath,
              '-type',
              'f',
              '-not',
              '-path',
              '*/.git/*',
              '-not',
              '-path',
              '*/node_modules/*',
            ]);
            const files = result.stdout
              .trim()
              .split('\n')
              .filter(Boolean)
              .map((f) => relative(this.cwd, f));
            filesToProcess.push(...files);
          }
        } catch {
          // Path doesn't exist
        }
      }
    }

    // Apply maxResults limit
    if (opts?.maxResults && filesToProcess.length > opts.maxResults) {
      filesToProcess = filesToProcess.slice(0, opts.maxResults);
    }

    // Extract codemaps for each file
    for (const filePath of filesToProcess) {
      const fullPath = join(this.cwd, filePath);

      // Check if the language is supported
      const lang = detectLanguage(filePath);
      if (!lang) {
        filesWithoutCodemap.push(filePath);
        continue;
      }

      try {
        const codemap = await extractCodemap(fullPath);
        if (codemap) {
          // Use relative path in the codemap
          codemap.path = filePath;
          codemaps.push(codemap);
        } else {
          filesWithoutCodemap.push(filePath);
        }
      } catch (error) {
        // Extraction failed - add to unsupported list
        filesWithoutCodemap.push(filePath);
      }
    }

    return { codemaps, filesWithoutCodemap };
  }

  // ===========================================================================
  // Selection
  // ===========================================================================

  async getSelection(): Promise<SelectionResult> {
    await this.loadState();
    const files = Array.from(this.selection.values());
    const totalTokens = files.reduce((sum, f) => sum + f.tokens, 0);

    return { files, totalTokens };
  }

  async setSelection(paths: string[]): Promise<void> {
    await this.loadState();
    this.selection.clear();
    await this.addToSelection(paths);
  }

  async addToSelection(paths: string[]): Promise<void> {
    await this.loadState();

    for (const p of paths) {
      const fullPath = join(this.cwd, p);

      try {
        const stats = await stat(fullPath);

        if (stats.isFile()) {
          const content = await readFile(fullPath, 'utf-8');
          const tokens = estimateTokens(content);

          this.selection.set(p, {
            path: p,
            tokens,
            mode: 'full',
          });
        } else if (stats.isDirectory()) {
          // Recursively add files from directory using find
          const result = await exec('find', [fullPath, '-type', 'f', '-not', '-path', '*/.git/*']);
          const files = result.stdout.trim().split('\n').filter(Boolean);

          for (const file of files) {
            try {
              const relPath = relative(this.cwd, file);
              const content = await readFile(file, 'utf-8');
              const tokens = estimateTokens(content);

              this.selection.set(relPath, {
                path: relPath,
                tokens,
                mode: 'full',
              });
            } catch {
              // Skip files that can't be read (binary, etc.)
            }
          }
        }
      } catch {
        // File doesn't exist or can't be read
      }
    }

    await this.saveState();
  }

  async removeFromSelection(paths: string[]): Promise<void> {
    await this.loadState();
    for (const p of paths) {
      this.selection.delete(p);
    }
    await this.saveState();
  }

  async clearSelection(): Promise<void> {
    this.selection.clear();
    await this.saveState();
  }

  // ===========================================================================
  // Context Building
  // ===========================================================================

  async buildContext(task: string, opts?: ContextOptions): Promise<ContextResult> {
    // For native backend, just get current selection
    // TODO: Implement AI-powered relevance scoring
    return this.getWorkspaceContext({ ...opts, task } as ContextOptions & { task: string });
  }

  async getWorkspaceContext(opts?: ContextOptions): Promise<ContextResult> {
    await this.loadState();
    const files: ContextFile[] = [];
    let totalTokens = 0;

    for (const [path, selFile] of this.selection) {
      const fullPath = join(this.cwd, path);

      try {
        const content = await readFile(fullPath, 'utf-8');
        const tokens = estimateTokens(content);
        totalTokens += tokens;

        files.push({
          path,
          tokens,
          mode: selFile.mode,
          content,
        });
      } catch {
        // Skip files that can't be read
      }
    }

    return {
      task: (opts as { task?: string })?.task || '',
      files,
      totalTokens,
      budget: opts?.budget,
    };
  }
}

// Register this backend
import { registerBackend } from './types.js';
registerBackend('native', () => new NativeBackend());
