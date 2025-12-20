# Karl Daemon Mode

> "The best serve is the one you don't have to wait for." - Unix proverb (probably)

## Overview

Karl daemon mode transforms Karl from a one-shot ace into a persistent background service, ready to volley instantly. Think `ssh-agent`, `gpg-agent`, or your favorite language server - always warm, always ready, zero cold-start penalty.

The daemon maintains hot context, watches your filesystem, and responds to commands via Unix domain sockets. It's the difference between a 2-second startup and a 20ms response.

## Use Cases

### Instant Responses
```bash
# Cold start: 2+ seconds
time karl "explain this function" < utils.ts

# With daemon: ~20ms
time karlctl query "explain this function" < utils.ts
```

### Background Intelligence
The daemon runs skills automatically based on triggers:
- **Test on save**: Run test suite when files change
- **Lint on write**: Auto-fix style violations
- **Context refresh**: Keep project understanding current
- **Continuous review**: Flag issues as you code

### Editor Integration
```bash
# From vim, send visual selection to Karl
:'<,'>w !karlctl query "refactor this"

# From emacs
(shell-command-on-region (region-beginning) (region-end) 
                         "karlctl query 'add error handling'")
```

### Project Awareness
Daemon maintains warm context about your project:
- Parsed file tree
- Recent changes
- Active skills
- Common patterns
- Dependencies graph

## Architecture

### Process Model

```
┌─────────────────────────────────────────┐
│  karld (daemon)                         │
│  ├─ Context Manager                     │
│  ├─ File Watcher (chokidar/fs.watch)   │
│  ├─ Socket Server (Unix domain)        │
│  ├─ Skill Engine                        │
│  └─ Model Pool (warm connections)      │
└─────────────────────────────────────────┘
           ▲
           │ Unix socket
           │ ~/.karl/daemon.sock
           │
    ┌──────┴──────┬──────────┬──────────┐
    │             │          │          │
┌───┴───┐   ┌─────┴────┐  ┌─┴──┐   ┌───┴────┐
│ karl  │   │ karlctl  │  │ vim│   │ watch  │
│  CLI  │   │  (ctl)   │  │ LSP│   │  jobs  │
└───────┘   └──────────┘  └────┘   └────────┘
```

### Communication Protocol

Unix domain sockets with JSON-RPC-ish messages:

```bash
# Socket at: ~/.karl/daemon.sock (or $KARL_SOCKET)

# Message format:
{
  "id": "uuid-v4",
  "method": "query|watch|skill|status|reload",
  "params": {
    "input": "...",
    "skill": "...",
    "files": [...]
  },
  "stream": true  // Enable streaming responses
}

# Response format:
{
  "id": "uuid-v4",
  "result": "...",
  "error": null,
  "stats": {
    "duration_ms": 23,
    "tokens": 150,
    "cache_hit": true
  }
}
```

### File Watching

```yaml
# .karl/daemon.yaml
watch:
  patterns:
    - "src/**/*.ts"
    - "tests/**/*.test.ts"
    - "!node_modules/**"
  
  triggers:
    - match: "tests/**/*.test.ts"
      on: [write]
      skill: test-runner
      debounce: 500ms
    
    - match: "src/**/*.ts"
      on: [write, create]
      skill: type-check
      debounce: 1000ms
    
    - match: "**/*.{ts,js}"
      on: [write]
      action: invalidate-context
      files: "${match}"

  ignore:
    - ".git/**"
    - "**/node_modules/**"
    - "**/*.log"
```

## Implementation with Bun

### Daemon Process

```typescript
// src/daemon/karld.ts
import { watch } from 'fs/promises';
import { serve } from 'bun';

class KarlDaemon {
  private contextCache = new Map();
  private watchers = new Map();
  private connections = new Set();
  
  async start() {
    // Unix domain socket server
    const server = Bun.serve({
      unix: process.env.KARL_SOCKET || `${process.env.HOME}/.karl/daemon.sock`,
      
      async fetch(req, server) {
        // Upgrade to WebSocket for streaming
        if (server.upgrade(req)) {
          return; // Connection upgraded
        }
        
        // Or handle as HTTP for simple queries
        const msg = await req.json();
        const result = await this.handleMessage(msg);
        return Response.json(result);
      },
      
      websocket: {
        open(ws) {
          this.connections.add(ws);
        },
        
        async message(ws, message) {
          const msg = JSON.parse(message);
          const result = await this.handleMessage(msg);
          
          if (msg.stream) {
            // Stream response chunks
            for await (const chunk of result) {
              ws.send(JSON.stringify({ id: msg.id, chunk }));
            }
            ws.send(JSON.stringify({ id: msg.id, done: true }));
          } else {
            ws.send(JSON.stringify({ id: msg.id, result }));
          }
        },
        
        close(ws) {
          this.connections.delete(ws);
        }
      }
    });
    
    // Setup file watchers
    await this.setupWatchers();
    
    // Prewarm context
    await this.prewarmContext();
    
    console.log(`Karl daemon listening on ${server.unix}`);
  }
  
  async handleMessage(msg: Message) {
    switch (msg.method) {
      case 'query':
        return this.handleQuery(msg.params);
      case 'watch':
        return this.addWatch(msg.params);
      case 'skill':
        return this.runSkill(msg.params);
      case 'status':
        return this.getStatus();
      case 'reload':
        return this.reload();
      default:
        throw new Error(`Unknown method: ${msg.method}`);
    }
  }
  
  async setupWatchers() {
    const config = await loadConfig('.karl/daemon.yaml');
    
    for (const trigger of config.watch.triggers) {
      const watcher = watch(trigger.match, { recursive: true });
      
      for await (const event of watcher) {
        if (event.eventType === trigger.on) {
          await this.handleWatchTrigger(trigger, event.filename);
        }
      }
    }
  }
  
  async prewarmContext() {
    // Load common skills
    await this.skillEngine.loadAll();
    
    // Parse project structure
    await this.contextManager.buildProjectGraph();
    
    // Establish model connections
    await this.modelPool.connect();
  }
}

// Start daemon
const daemon = new KarlDaemon();
daemon.start();
```

### Control Client

```typescript
// src/daemon/karlctl.ts
class KarlClient {
  private socket: string;
  
  constructor() {
    this.socket = process.env.KARL_SOCKET || 
                  `${process.env.HOME}/.karl/daemon.sock`;
  }
  
  async query(input: string, opts = {}) {
    const response = await fetch(`unix://${this.socket}`, {
      method: 'POST',
      body: JSON.stringify({
        id: crypto.randomUUID(),
        method: 'query',
        params: { input, ...opts }
      })
    });
    
    return response.json();
  }
  
  async stream(input: string, opts = {}) {
    const ws = new WebSocket(`ws+unix://${this.socket}`);
    
    return new Promise((resolve, reject) => {
      const chunks = [];
      
      ws.on('open', () => {
        ws.send(JSON.stringify({
          id: crypto.randomUUID(),
          method: 'query',
          params: { input, ...opts },
          stream: true
        }));
      });
      
      ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.done) {
          ws.close();
          resolve(chunks.join(''));
        } else {
          chunks.push(msg.chunk);
          process.stdout.write(msg.chunk); // Stream to stdout
        }
      });
    });
  }
}
```

### Lifecycle Management

```bash
#!/bin/bash
# karlctl - Control script

case "$1" in
  start)
    if [ -S ~/.karl/daemon.sock ]; then
      echo "Karl daemon already running"
      exit 1
    fi
    
    # Start daemon in background
    karld --daemon &
    echo $! > ~/.karl/daemon.pid
    
    # Wait for socket
    for i in {1..30}; do
      [ -S ~/.karl/daemon.sock ] && break
      sleep 0.1
    done
    
    echo "Karl daemon started (PID $(cat ~/.karl/daemon.pid))"
    ;;
    
  stop)
    if [ -f ~/.karl/daemon.pid ]; then
      kill $(cat ~/.karl/daemon.pid)
      rm -f ~/.karl/daemon.pid ~/.karl/daemon.sock
      echo "Karl daemon stopped"
    fi
    ;;
    
  restart)
    $0 stop
    $0 start
    ;;
    
  status)
    if [ -S ~/.karl/daemon.sock ]; then
      echo "Karl daemon is running"
      karlctl rpc status
    else
      echo "Karl daemon is not running"
      exit 1
    fi
    ;;
    
  reload)
    # Hot reload config and skills
    karlctl rpc reload
    ;;
    
  *)
    # Forward to daemon as RPC
    karlctl rpc "$@"
    ;;
esac
```

## Context Management

### Prewarming Strategy

```typescript
class ContextManager {
  private cache = new LRUCache({ max: 100, ttl: 1000 * 60 * 30 });
  
  async prewarm(project: string) {
    // 1. Load project metadata
    const pkg = await this.loadPackageJson(project);
    const readme = await this.loadReadme(project);
    
    // 2. Build file tree (git-aware)
    const tree = await this.buildFileTree(project);
    
    // 3. Parse common patterns
    const patterns = await this.extractPatterns(tree);
    
    // 4. Cache in warm state
    this.cache.set(project, {
      pkg,
      readme,
      tree,
      patterns,
      timestamp: Date.now()
    });
  }
  
  async getContext(files: string[]) {
    // Hit cache for warm context
    const cached = this.cache.get('project');
    
    if (cached) {
      // Merge with specific file content
      return {
        ...cached,
        files: await Promise.all(files.map(f => this.loadFile(f)))
      };
    }
    
    // Cold path
    return this.buildContext(files);
  }
  
  invalidate(pattern: string) {
    // Selective cache invalidation
    for (const [key, value] of this.cache.entries()) {
      if (this.matchesPattern(key, pattern)) {
        this.cache.delete(key);
      }
    }
  }
}
```

### Memory Management

```typescript
class MemoryManager {
  private maxMemoryMB = 512;
  private checkInterval = 30000; // 30s
  
  async start() {
    setInterval(() => this.checkMemory(), this.checkInterval);
  }
  
  async checkMemory() {
    const usage = process.memoryUsage();
    const heapMB = usage.heapUsed / 1024 / 1024;
    
    if (heapMB > this.maxMemoryMB) {
      console.warn(`Memory high: ${heapMB.toFixed(0)}MB, cleaning...`);
      await this.cleanup();
    }
  }
  
  async cleanup() {
    // 1. Clear old cache entries
    this.contextCache.prune();
    
    // 2. Close idle model connections
    await this.modelPool.closeIdle();
    
    // 3. Force GC (Bun-specific)
    if (global.gc) {
      global.gc();
    }
    
    // 4. Log results
    const after = process.memoryUsage().heapUsed / 1024 / 1024;
    console.log(`Cleaned up, now at ${after.toFixed(0)}MB`);
  }
}
```

## Hot-Reloading

```typescript
class HotReloader {
  async reloadSkills() {
    const skillsDir = '.karl/skills';
    const watcher = watch(skillsDir);
    
    for await (const event of watcher) {
      if (event.filename.endsWith('.md') || event.filename.endsWith('.yaml')) {
        console.log(`Reloading skill: ${event.filename}`);
        
        // Unload old version
        this.skillEngine.unload(event.filename);
        
        // Load new version
        await this.skillEngine.load(event.filename);
        
        // Notify clients
        this.broadcast({
          type: 'skill-reloaded',
          skill: event.filename
        });
      }
    }
  }
  
  async reloadConfig() {
    const configPath = '.karl/daemon.yaml';
    const watcher = watch(configPath);
    
    for await (const event of watcher) {
      console.log('Config changed, reloading...');
      
      const newConfig = await loadConfig(configPath);
      
      // Hot-swap configuration
      this.config = newConfig;
      
      // Restart watchers with new patterns
      await this.restartWatchers();
    }
  }
}
```

## Editor Integration

### Vim Plugin

```vim
" ~/.vim/plugin/karl.vim

function! KarlQuery(prompt)
  let selection = join(getline("'<", "'>"), "\n")
  let result = system('karlctl query "' . a:prompt . '"', selection)
  
  " Replace selection with result
  execute "'<,'>d"
  call append(line("'<") - 1, split(result, "\n"))
endfunction

function! KarlExplain()
  let selection = join(getline("'<", "'>"), "\n")
  let result = system('karlctl query "explain this code"', selection)
  
  " Show in split
  new
  call setline(1, split(result, "\n"))
  setlocal buftype=nofile
endfunction

" Keybindings
vnoremap <leader>kr :call KarlQuery(input('Karl: '))<CR>
vnoremap <leader>ke :call KarlExplain()<CR>
vnoremap <leader>kt :call KarlQuery('add tests for this')<CR>
vnoremap <leader>kd :call KarlQuery('add documentation')<CR>

" Auto-format on save
autocmd BufWritePost *.ts,*.js silent !karlctl format % &
```

### Emacs Integration

```elisp
;; ~/.emacs.d/karl-mode.el

(defun karl-query (prompt)
  "Query Karl daemon with selected region."
  (interactive "sKarl: ")
  (let* ((selection (buffer-substring-no-properties (region-beginning) (region-end)))
         (result (shell-command-to-string 
                  (format "echo %s | karlctl query '%s'" 
                          (shell-quote-argument selection)
                          prompt))))
    (delete-region (region-beginning) (region-end))
    (insert result)))

(defun karl-explain ()
  "Explain selected code."
  (interactive)
  (let* ((selection (buffer-substring-no-properties (region-beginning) (region-end)))
         (result (shell-command-to-string 
                  (format "echo %s | karlctl query 'explain this code'" 
                          (shell-quote-argument selection)))))
    (with-output-to-temp-buffer "*Karl Explanation*"
      (princ result))))

;; Keybindings
(global-set-key (kbd "C-c k q") 'karl-query)
(global-set-key (kbd "C-c k e") 'karl-explain)
(global-set-key (kbd "C-c k t") 
                (lambda () (interactive) (karl-query "add tests for this")))
```

### VS Code Extension

```typescript
// karl-vscode/src/extension.ts
import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export function activate(context: vscode.ExtensionContext) {
  // Query command
  let query = vscode.commands.registerCommand('karl.query', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    
    const selection = editor.document.getText(editor.selection);
    const prompt = await vscode.window.showInputBox({ prompt: 'Karl:' });
    
    if (!prompt) return;
    
    const { stdout } = await execAsync(
      `echo ${JSON.stringify(selection)} | karlctl query "${prompt}"`
    );
    
    editor.edit(editBuilder => {
      editBuilder.replace(editor.selection, stdout.trim());
    });
  });
  
  // Watch current file
  let watch = vscode.commands.registerCommand('karl.watch', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    
    const filepath = editor.document.uri.fsPath;
    await execAsync(`karlctl watch add "${filepath}" --skill=type-check`);
    
    vscode.window.showInformationMessage(`Karl is watching ${filepath}`);
  });
  
  context.subscriptions.push(query, watch);
}
```

## Security Considerations

### Socket Permissions

```typescript
// Daemon sets restrictive permissions on socket
import { chmod } from 'fs/promises';

const sockPath = `${process.env.HOME}/.karl/daemon.sock`;

// Only user can read/write
await chmod(sockPath, 0o600);

// Verify ownership
const stats = await stat(sockPath);
if (stats.uid !== process.getuid()) {
  throw new Error('Socket ownership mismatch');
}
```

### Authentication

```typescript
class DaemonAuth {
  private tokens = new Map<string, TokenInfo>();
  
  async authenticate(msg: Message): Promise<boolean> {
    // 1. Check Unix socket peer credentials
    const creds = getPeerCredentials(socket);
    if (creds.uid !== process.getuid()) {
      return false; // Only same user
    }
    
    // 2. Optional: Token-based auth for remote access
    if (msg.token) {
      return this.validateToken(msg.token);
    }
    
    return true; // Local socket, same user = trusted
  }
  
  generateToken(scopes: string[]): string {
    const token = crypto.randomUUID();
    this.tokens.set(token, {
      scopes,
      created: Date.now(),
      expires: Date.now() + 3600000 // 1 hour
    });
    return token;
  }
}
```

### Resource Limits

```yaml
# .karl/daemon.yaml
limits:
  max_connections: 10
  max_concurrent_queries: 5
  max_memory_mb: 512
  max_context_size: 100000  # tokens
  rate_limit:
    queries_per_minute: 60
    
security:
  allowed_skills:
    - code-review
    - test-runner
    - type-check
  
  forbidden_paths:
    - "/etc/**"
    - "~/.ssh/**"
    - "**/.env"
    - "**/secrets/**"
  
  sandbox_skills: true  # Run in restricted env
```

### Sandboxing

```typescript
class SkillSandbox {
  async run(skill: Skill, context: Context) {
    // Run skill in restricted Bun subprocess
    const proc = Bun.spawn({
      cmd: ['bun', 'run', skill.path],
      env: {
        // Minimal environment
        PATH: '/usr/bin:/bin',
        HOME: '/tmp/karl-sandbox',
        KARL_CONTEXT: JSON.stringify(context)
      },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe'
    });
    
    // Timeout
    const timeout = setTimeout(() => proc.kill(), 30000);
    
    const output = await proc.exited;
    clearTimeout(timeout);
    
    return output;
  }
}
```

## Comparison to LSP

| Feature | Karl Daemon | LSP Server |
|---------|-------------|------------|
| **Purpose** | AI-powered code assistance | Language intelligence |
| **Protocol** | JSON over Unix socket | JSON-RPC over stdio/socket |
| **State** | Project context + AI models | AST + symbol tables |
| **Latency** | ~20-500ms (model-dependent) | ~1-10ms |
| **Use case** | Complex transformations | Autocomplete, goto-def |
| **Integration** | Editor agnostic | Editor-specific adapters |
| **Offline** | Partial (local models) | Full |

### Why Not Just LSP?

LSP is perfect for language-aware features (autocomplete, refactoring, navigation). Karl daemon complements it:

- **AI capabilities**: LSP doesn't do semantic understanding, generation, or complex transformations
- **Cross-language**: Karl works on any file type, LSP is language-specific
- **Context-aware**: Karl maintains project-level understanding, not just syntax
- **Async workflows**: File watching, background analysis, scheduled tasks

### Hybrid Approach

```typescript
// Karl can act as LSP server for AI features
class KarlLSP extends LSPServer {
  async handleCompletion(params: CompletionParams) {
    // Delegate to daemon for AI completions
    const context = await this.getContext(params.textDocument.uri);
    
    return karlClient.query('complete this code', {
      context,
      position: params.position
    });
  }
  
  async handleCodeAction(params: CodeActionParams) {
    // AI-powered quick fixes
    return karlClient.query('suggest fixes', {
      diagnostics: params.context.diagnostics
    });
  }
}
```

## Example Workflows

### Workflow 1: Continuous Testing

```bash
# Setup
karlctl start
karlctl watch add "src/**/*.ts" --skill=test-runner --on=write

# Now code normally
vim src/utils.ts
# ... make changes, :w
# Karl automatically runs tests in background

# Check results
karlctl status
# ✓ tests/utils.test.ts - 23 passed
# ✗ tests/integration.test.ts - 2 failed

# Get details
karlctl logs
```

### Workflow 2: Live Code Review

```yaml
# .karl/daemon.yaml
watch:
  triggers:
    - match: "src/**/*.ts"
      on: [write]
      skill: code-review
      notify: true
      
skills:
  code-review:
    stack: sonnet
    context:
      - CONVENTIONS.md
      - .eslintrc.js
```

```bash
# Start daemon with live review
karlctl start

# Code away...
vim src/api/users.ts
# ... add new endpoint, :w

# Notification appears:
# Karl: Code review complete - 2 suggestions
# - Consider adding input validation
# - Missing error handling for DB calls

# View full review
karlctl last-review
```

### Workflow 3: Editor-Integrated Refactoring

```bash
# In vim, select function
# Press <leader>kr (Karl Refactor)
# Enter: "extract error handling to middleware"

# Karl daemon responds instantly (prewarmed):
# - Analyzes function
# - Generates middleware
# - Updates imports
# - Replaces selection

# All in ~50ms because context was warm
```

### Workflow 4: Project Onboarding

```bash
# New team member clones repo
cd my-project

# Start Karl daemon
karlctl start

# Let Karl learn the project
karlctl prewarm --full

# Now ask questions
karlctl query "what does this project do?"
karlctl query "how do I add a new API endpoint?"
karlctl query "explain the auth flow"

# All answers instant, context-aware
```

### Workflow 5: Background Analysis

```yaml
# .karl/daemon.yaml
schedule:
  - cron: "0 * * * *"  # Every hour
    skill: dependency-audit
    notify: slack
  
  - cron: "0 9 * * 1"  # Monday 9am
    skill: weekly-summary
    output: WEEKLY.md
```

```bash
# Daemon runs background jobs
karlctl status
# Next job: dependency-audit in 23 minutes
# Last job: weekly-summary (exit 0) 2 days ago

# Check outputs
cat WEEKLY.md
# Weekly Summary - Week 48
# - 127 commits
# - 15 PRs merged
# - Top contributor: alice (42 commits)
# - Hot spots: src/api/* (high churn)
```

## Performance Tuning

### Benchmarks

```bash
# Cold start (no daemon)
$ time karl "explain this" < utils.ts
real    0m2.341s  # Startup + model load + inference

# With daemon (prewarmed)
$ time karlctl query "explain this" < utils.ts
real    0m0.023s  # Just inference

# Speedup: ~100x for simple queries
```

### Optimization Tips

1. **Prewarm aggressively**: Load common skills at startup
2. **Cache context**: Rebuild only on changes
3. **Pool model connections**: Keep HTTP/2 connections alive
4. **Debounce file watches**: Don't trigger on every keystroke
5. **Lazy load skills**: Only load when first used
6. **Compress context**: Use skill-specific context, not full project
7. **Stream responses**: Start processing before full response

### Memory Profile

```
Typical daemon footprint:
- Base process: ~50MB
- Context cache: ~100MB (LRU, pruned)
- Model connections: ~20MB
- File watchers: ~10MB
- Total: ~200MB idle, ~500MB active

Comparable to:
- TypeScript LSP: ~300MB
- Rust Analyzer: ~500MB
- VS Code: ~400MB base
```

## Future Ideas

- **Multi-project support**: One daemon, multiple repos
- **Remote daemon**: Connect to daemon on dev server
- **Daemon mesh**: Coordinate multiple daemons
- **Smart prewarming**: ML-based context prediction
- **Incremental context**: Only send diffs, not full context
- **Skill marketplace**: Auto-download skills on first use
- **Health monitoring**: Prometheus metrics, status dashboard
- **Replay mode**: Record/replay interactions for debugging

## Getting Started

```bash
# Install daemon components
bun install -g karl-daemon

# Start daemon
karlctl start

# Verify it's running
karlctl status

# Set up watches
karlctl watch add "src/**/*.ts" --skill=type-check

# Query from command line
echo "const x = 1" | karlctl query "explain this"

# Or integrate with editor
# (see vim/emacs/vscode sections above)

# Stop daemon
karlctl stop
```

---

**The daemon is Karl's power serve** - always ready, always warm, zero hesitation. Your code gets instant feedback, your editor gets superpowers, and you stay in flow.

Just like Karlović's serve: one shot, no rally, ace. 🎾
