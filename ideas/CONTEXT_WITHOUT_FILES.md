# Context Without Files: A Unix-Philosophy Approach

## The Problem with Temp Files

### Current Issues

1. **Filesystem Pollution**
   - Orphaned temp files after crashes
   - Race conditions in cleanup
   - Disk I/O overhead for ephemeral data
   - `/tmp` filling up on long sessions

2. **Security Concerns**
   - Temp files readable by other processes (umask issues)
   - Predictable paths = attack vectors
   - Sensitive context persisted to disk unnecessarily
   - Forensic trail of what should be ephemeral

3. **Performance Bottlenecks**
   - Disk write latency vs memory
   - Page cache thrashing on large contexts
   - File descriptor exhaustion
   - Unnecessary serialization/deserialization cycles

4. **Operational Complexity**
   - Cleanup logic in error paths
   - Signal handling for graceful exit
   - Atomic writes for consistency
   - Cross-platform temp dir variations

### The Unix Philosophy Gap

Temp files violate "everything is a stream":
```bash
# This is Unix-native:
cat file.txt | grep pattern | wc -l

# This is not:
generate_context > /tmp/ctx.txt
karl --context /tmp/ctx.txt "analyze this"
rm /tmp/ctx.txt
```

We should aim for **context as a flow**, not context as a file.

---

## In-Memory Context: Environment Variables

### Approach: Environment Passing

```bash
# Simple context injection
KARL_CONTEXT="$(cat important.txt)" karl "summarize this: $KARL_CONTEXT"

# Multi-line with heredoc
KARL_CONTEXT=$(cat <<'EOF'
Bug: User login fails
Steps: 1. Navigate to /login
       2. Enter credentials
       3. Submit form
Error: 500 Internal Server Error
EOF
) karl "debug this"
```

### Implementation Sketch

```typescript
// context/env.ts
export interface EnvContextSource {
  getContext(): string | null;
  getMultipartContext(): Record<string, string>;
}

export class EnvironmentContext implements EnvContextSource {
  private readonly envPrefix = 'KARL_CONTEXT';
  
  getContext(): string | null {
    // Single monolithic context
    return Bun.env[this.envPrefix] || null;
  }
  
  getMultipartContext(): Record<string, string> {
    // Multiple named contexts via KARL_CONTEXT_LOGS, KARL_CONTEXT_CODE, etc.
    const contexts: Record<string, string> = {};
    
    for (const [key, value] of Object.entries(Bun.env)) {
      if (key.startsWith(`${this.envPrefix}_`)) {
        const name = key.slice(this.envPrefix.length + 1).toLowerCase();
        contexts[name] = value;
      }
    }
    
    return contexts;
  }
  
  // Auto-merge with priority
  getMergedContext(): string {
    const single = this.getContext();
    const multi = this.getMultipartContext();
    
    if (single && Object.keys(multi).length === 0) {
      return single;
    }
    
    // Multi-part takes precedence, formatted
    const parts = Object.entries(multi).map(([name, content]) => {
      return `=== ${name.toUpperCase()} ===\n${content}`;
    });
    
    return [single, ...parts].filter(Boolean).join('\n\n');
  }
}
```

### Pros & Cons

**Pros:**
- Zero filesystem interaction
- Survives across process boundaries
- Works with `env -i` for isolation
- Easy to debug with `env | grep KARL`

**Cons:**
- Size limits (typically 128KB - 2MB per var)
- Not streaming-friendly
- Shell escaping complexity
- Environment leaks to child processes

---

## Streaming Context: Named Pipes (FIFOs)

### Approach: Unix Named Pipes

Named pipes are **filesystem entries** but not files—they're IPC channels.

```bash
# Producer writes, consumer reads simultaneously
mkfifo /tmp/karl-context-$$

# Background: Generate context slowly
(
  echo "=== LOG STREAM ==="
  tail -f /var/log/app.log
) > /tmp/karl-context-$$ &

# Foreground: Karl consumes as it arrives
karl --context-pipe /tmp/karl-context-$$ "monitor for errors"

# Cleanup
rm /tmp/karl-context-$$
```

### Implementation Sketch

```typescript
// context/fifo.ts
import { open, stat } from 'node:fs/promises';
import { constants } from 'node:fs';

export class FIFOContext {
  constructor(private path: string) {}
  
  async validate(): Promise<boolean> {
    try {
      const stats = await stat(this.path);
      return stats.isFIFO();
    } catch {
      return false;
    }
  }
  
  async *stream(): AsyncGenerator<string, void, unknown> {
    if (!await this.validate()) {
      throw new Error(`Not a FIFO: ${this.path}`);
    }
    
    // Non-blocking read
    const fd = await open(this.path, constants.O_RDONLY | constants.O_NONBLOCK);
    
    try {
      const decoder = new TextDecoder();
      const buffer = new Uint8Array(64 * 1024); // 64KB chunks
      
      while (true) {
        const { bytesRead } = await fd.read(buffer, 0, buffer.length);
        
        if (bytesRead === 0) break; // EOF
        
        yield decoder.decode(buffer.slice(0, bytesRead), { stream: true });
      }
    } finally {
      await fd.close();
    }
  }
  
  // Helper: Create FIFO programmatically
  static async create(path: string): Promise<FIFOContext> {
    const { mkfifo } = await import('node:child_process');
    
    await new Promise<void>((resolve, reject) => {
      mkfifo(path, 0o600, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    return new FIFOContext(path);
  }
}

// Usage
const fifo = new FIFOContext('/tmp/karl-stream');
for await (const chunk of fifo.stream()) {
  processContextChunk(chunk);
}
```

### Advanced: Anonymous Pipes with Process Substitution

Bash/Zsh support **process substitution** for pipe-like FDs without naming:

```bash
# <() creates an anonymous FIFO
karl --context <(cat logs/*.log | grep ERROR) "analyze errors"

# Equivalent to:
# mkfifo /dev/fd/63
# cat logs/*.log | grep ERROR > /dev/fd/63 &
# karl --context /dev/fd/63
```

TypeScript can consume these via `/dev/fd/N`:

```typescript
// Detect process substitution
if (contextArg.startsWith('/dev/fd/')) {
  const fd = parseInt(contextArg.split('/').pop()!);
  const stream = Bun.file(`/dev/fd/${fd}`).stream();
  // Read as stream...
}
```

### Pros & Cons

**Pros:**
- True streaming—no size limits
- Bidirectional communication possible
- No temp file cleanup (kernel handles it)
- Backpressure handling

**Cons:**
- Still creates filesystem entries (even if ephemeral)
- Platform-dependent (`/dev/fd` on Unix only)
- Complexity in error handling (broken pipes)
- Requires reader/writer coordination

---

## LSP-Like Context Server

### Concept: Context as a Service

Language Server Protocol (LSP) separates language intelligence from editors. Apply this to context:

```
┌─────────────┐         ┌──────────────────┐
│   Karl CLI  │ ◄─────► │  Context Server  │
└─────────────┘  JSON   └──────────────────┘
                 RPC            │
                                ▼
                         In-memory cache
                         Deduplication
                         Smart chunking
```

### Protocol Design

```typescript
// context/protocol.ts

// JSON-RPC 2.0 style messages
interface ContextRequest {
  jsonrpc: '2.0';
  id: number;
  method: 'context/get' | 'context/set' | 'context/list' | 'context/delete';
  params: unknown;
}

interface ContextGetParams {
  ids: string[];  // Context IDs to retrieve
  expand?: boolean;  // Expand references
}

interface ContextSetParams {
  content: string;
  metadata?: {
    ttl?: number;  // Seconds until expiry
    tags?: string[];
    deduplicate?: boolean;
  };
}

interface ContextResponse {
  jsonrpc: '2.0';
  id: number;
  result?: {
    id: string;
    content: string;
    hash: string;
    size: number;
    created: number;  // Unix timestamp
  };
  error?: {
    code: number;
    message: string;
  };
}

// Server implementation
export class ContextServer {
  private contexts = new Map<string, ContextObject>();
  private hashIndex = new Map<string, string>(); // hash -> id
  
  constructor(private socket: string) {}
  
  async start() {
    const server = Bun.serve({
      unix: this.socket,
      
      async fetch(req) {
        const body = await req.json() as ContextRequest;
        
        switch (body.method) {
          case 'context/set':
            return this.handleSet(body.params as ContextSetParams);
          case 'context/get':
            return this.handleGet(body.params as ContextGetParams);
          // ... other methods
        }
      }
    });
    
    console.log(`Context server listening on ${this.socket}`);
  }
  
  private async handleSet(params: ContextSetParams): Promise<ContextResponse> {
    const hash = this.hash(params.content);
    
    // Deduplication
    if (params.metadata?.deduplicate && this.hashIndex.has(hash)) {
      const existingId = this.hashIndex.get(hash)!;
      return { id: existingId, deduplicated: true };
    }
    
    const id = this.generateId();
    const ctx: ContextObject = {
      id,
      content: params.content,
      hash,
      size: params.content.length,
      created: Date.now(),
      ttl: params.metadata?.ttl,
      tags: params.metadata?.tags || [],
    };
    
    this.contexts.set(id, ctx);
    this.hashIndex.set(hash, id);
    
    // Auto-cleanup
    if (ctx.ttl) {
      setTimeout(() => this.contexts.delete(id), ctx.ttl * 1000);
    }
    
    return { id, hash, size: ctx.size };
  }
  
  private hash(content: string): string {
    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update(content);
    return hasher.digest('hex');
  }
  
  private generateId(): string {
    return `ctx_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}

// Client
export class ContextClient {
  constructor(private socket: string) {}
  
  async set(content: string, opts?: ContextSetParams['metadata']): Promise<string> {
    const response = await this.call('context/set', { content, metadata: opts });
    return response.result.id;
  }
  
  async get(id: string): Promise<string> {
    const response = await this.call('context/get', { ids: [id] });
    return response.result.content;
  }
  
  private async call(method: string, params: unknown): Promise<ContextResponse> {
    const req: ContextRequest = {
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    };
    
    const conn = await Bun.connect({
      unix: this.socket,
      socket: {
        data(socket, data) {
          socket.end();
        }
      }
    });
    
    conn.write(JSON.stringify(req));
    // ... handle response
  }
}
```

### Usage Pattern

```bash
# Terminal 1: Start context server
karl context-server --socket ~/.karl/context.sock

# Terminal 2: Store context, get ID
CONTEXT_ID=$(echo "Large log file..." | karl context set --dedupe)

# Terminal 3: Use context by reference
karl --context-id $CONTEXT_ID "analyze this"

# Terminal 4: Reuse same context (deduplicated)
karl --context-id $CONTEXT_ID "different question"
```

### Pros & Cons

**Pros:**
- Single source of truth
- Automatic deduplication
- Persistent across invocations (if desired)
- Can serve multiple clients
- Smart caching and chunking

**Cons:**
- Added complexity (daemon management)
- Another process to monitor
- Serialization overhead for small contexts
- Overkill for single-use contexts

---

## Context as First-Class Objects with IDs

### Approach: Content-Addressed Storage

Treat context like Git treats blobs—**immutable, content-addressed objects**.

```typescript
// context/store.ts
export interface ContextObject {
  id: string;        // Content hash (SHA-256)
  content: string;   // Actual text
  size: number;      // Byte count
  created: number;   // Timestamp
  refs: string[];    // Child context IDs (for composition)
}

export class ContextStore {
  private store = new Map<string, ContextObject>();
  
  // Add context, return content-addressed ID
  add(content: string, refs: string[] = []): string {
    const id = this.hashContent(content);
    
    // Idempotent: same content = same ID
    if (this.store.has(id)) {
      return id;
    }
    
    const obj: ContextObject = {
      id,
      content,
      size: content.length,
      created: Date.now(),
      refs,
    };
    
    this.store.set(id, obj);
    return id;
  }
  
  // Retrieve by ID
  get(id: string): ContextObject | null {
    return this.store.get(id) || null;
  }
  
  // Compose multiple contexts
  compose(ids: string[]): string {
    const parts = ids
      .map(id => this.get(id)?.content)
      .filter(Boolean);
    
    return parts.join('\n\n---\n\n');
  }
  
  // Expand references recursively
  expand(id: string, visited = new Set<string>()): string {
    if (visited.has(id)) return ''; // Cycle detection
    visited.add(id);
    
    const obj = this.get(id);
    if (!obj) return '';
    
    const childContent = obj.refs
      .map(refId => this.expand(refId, visited))
      .filter(Boolean)
      .join('\n\n');
    
    return childContent ? `${obj.content}\n\n${childContent}` : obj.content;
  }
  
  private hashContent(content: string): string {
    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update(content);
    return hasher.digest('hex').slice(0, 16); // Short hash
  }
  
  // Garbage collection: remove unreferenced contexts
  gc(rootIds: string[]): number {
    const reachable = new Set<string>();
    
    const mark = (id: string) => {
      if (reachable.has(id)) return;
      reachable.add(id);
      
      const obj = this.get(id);
      obj?.refs.forEach(mark);
    };
    
    rootIds.forEach(mark);
    
    let collected = 0;
    for (const id of this.store.keys()) {
      if (!reachable.has(id)) {
        this.store.delete(id);
        collected++;
      }
    }
    
    return collected;
  }
  
  // Serialize to JSON (for persistence if needed)
  toJSON(): string {
    return JSON.stringify(Array.from(this.store.entries()));
  }
  
  static fromJSON(json: string): ContextStore {
    const store = new ContextStore();
    const entries = JSON.parse(json) as [string, ContextObject][];
    store.store = new Map(entries);
    return store;
  }
}
```

### CLI Integration

```bash
# Add context, print ID
$ echo "Bug report..." | karl context add
ctx:a3f2e9d1c4b8

# Use by ID
$ karl --ctx ctx:a3f2e9d1c4b8 "summarize"

# Compose multiple contexts
$ karl --ctx ctx:abc,ctx:def,ctx:ghi "compare these"

# Add with reference (hierarchical context)
$ karl context add --ref ctx:parent < child-details.txt
ctx:child123

# Expand recursively
$ karl --ctx ctx:child123 --expand "full picture"
```

### Pros & Cons

**Pros:**
- Deduplication by design
- Immutable = cacheable
- Composable contexts
- Garbage collection possible
- Works with in-memory or persistent stores

**Cons:**
- Hash collisions (mitigated by good hash function)
- Memory growth without GC
- Complexity in reference management
- Need to track "root" contexts for GC

---

## Virtual Filesystem Concepts

### Approach: In-Memory FS (like `/dev/shm`)

Use Bun's runtime capabilities to create a virtual filesystem layer:

```typescript
// context/vfs.ts
export class VirtualFileSystem {
  private files = new Map<string, Uint8Array>();
  
  // Write to virtual path
  write(path: string, content: string | Uint8Array): void {
    const bytes = typeof content === 'string' 
      ? new TextEncoder().encode(content)
      : content;
    
    this.files.set(path, bytes);
  }
  
  // Read from virtual path
  read(path: string): Uint8Array | null {
    return this.files.get(path) || null;
  }
  
  // Create Bun.file-like interface
  getFile(path: string): BunFile | null {
    const bytes = this.read(path);
    if (!bytes) return null;
    
    // Bun.file() from Buffer
    return Bun.file(new Blob([bytes]));
  }
  
  // Intercept file operations
  intercept(originalPath: string, virtualPath: string): void {
    const originalFile = Bun.file(originalPath);
    
    // Read original into memory
    originalFile.arrayBuffer().then(buffer => {
      this.files.set(virtualPath, new Uint8Array(buffer));
    });
  }
  
  // Mount point: redirect paths
  mount(prefix: string, handler: (subpath: string) => Uint8Array | null): void {
    // Custom logic for /virtual/context/* paths
    // Would integrate with Bun's module resolution if possible
  }
}

// Usage
const vfs = new VirtualFileSystem();

vfs.write('/virtual/context/logs.txt', 'Error: Connection refused\n...');
vfs.write('/virtual/context/code.ts', 'export function broken() {...}');

// Pass to Karl
const contextFile = vfs.getFile('/virtual/context/logs.txt');
processContext(await contextFile.text());
```

### FUSE-like User-Space FS (Advanced)

For true filesystem integration (Linux-specific):

```typescript
// Pseudo-code - would need FUSE bindings
import { Fuse, FuseOptions } from 'hypothetical-fuse-binding';

class ContextFS extends Fuse {
  constructor(private store: ContextStore) {
    super();
  }
  
  readdir(path: string): string[] {
    if (path === '/') {
      return Array.from(this.store.getAllIds());
    }
    return [];
  }
  
  read(path: string): Buffer {
    const id = path.slice(1); // Remove leading /
    const obj = this.store.get(id);
    
    if (!obj) throw new Error('ENOENT');
    
    return Buffer.from(obj.content);
  }
  
  getattr(path: string): Stats {
    if (path === '/') {
      return { mode: 0o755 | S_IFDIR, size: 0 };
    }
    
    const id = path.slice(1);
    const obj = this.store.get(id);
    
    if (!obj) throw new Error('ENOENT');
    
    return {
      mode: 0o444 | S_IFREG,  // Read-only file
      size: obj.size,
      mtime: new Date(obj.created),
    };
  }
}

// Mount
const fs = new ContextFS(contextStore);
fs.mount('~/.karl/ctx');

// Now access contexts as files!
// $ cat ~/.karl/ctx/a3f2e9d1c4b8
// Bug report...
```

### Pros & Cons

**Pros:**
- Familiar filesystem interface
- No actual disk I/O
- Can integrate with existing tools (`cat`, `grep`, etc.)
- FUSE approach is truly portable

**Cons:**
- VFS is process-local only
- FUSE adds kernel overhead
- Complex to implement correctly
- May confuse users (is it a real file?)

---

## Heredocs and Process Substitution

### Heredoc Patterns

Classic Unix approach for inline context:

```bash
# Immediate heredoc
karl "analyze this" <<EOF
Error logs from production:
[2024-01-15 10:23:45] ERROR: Database connection failed
[2024-01-15 10:23:46] ERROR: Retry attempt 1/3
EOF

# Heredoc to variable (no temp file)
read -r -d '' CONTEXT <<'EOF'
Multi-line context
can span many lines
without touching disk
EOF

karl "summarize: $CONTEXT"
```

### TypeScript Heredoc Handler

```typescript
// context/heredoc.ts
export class HeredocContext {
  // Read from stdin if available
  static async fromStdin(): Promise<string | null> {
    if (Bun.stdin.isTTY) return null;
    
    const chunks: Uint8Array[] = [];
    
    for await (const chunk of Bun.stdin.stream()) {
      chunks.push(chunk);
    }
    
    if (chunks.length === 0) return null;
    
    const blob = new Blob(chunks);
    return await blob.text();
  }
  
  // Detect if stdin has data (non-blocking)
  static hasStdin(): boolean {
    return !Bun.stdin.isTTY;
  }
}

// CLI integration
const stdinContext = await HeredocContext.fromStdin();
if (stdinContext) {
  // Merge with other context sources
  contextBuilder.addSource('stdin', stdinContext);
}
```

### Process Substitution (Advanced)

```bash
# Multiple inputs without temp files
karl "compare these logs" \
  --context-a <(kubectl logs pod-1) \
  --context-b <(kubectl logs pod-2)

# Combine with heredoc
karl <<PROMPT <(git diff HEAD~1) <(git log -1)
What changed in the last commit and why?
PROMPT=$(cat)
DIFF=$(cat <(git diff HEAD~1))
LOG=$(cat <(git log -1))

# karl receives both through different channels
```

### TypeScript Handler

```typescript
// Detect and read from /dev/fd/* or named pipes
export class ProcessSubstitution {
  static async read(path: string): Promise<string> {
    // Check if it's a /dev/fd/ path
    if (path.startsWith('/dev/fd/')) {
      const fd = parseInt(path.split('/').pop()!);
      
      // Read directly from file descriptor
      const file = Bun.file(path);
      return await file.text();
    }
    
    // Check if it's a FIFO
    const stats = await stat(path);
    if (stats.isFIFO()) {
      const fifo = new FIFOContext(path);
      const chunks: string[] = [];
      
      for await (const chunk of fifo.stream()) {
        chunks.push(chunk);
      }
      
      return chunks.join('');
    }
    
    // Regular file fallback
    return await Bun.file(path).text();
  }
}
```

### Pros & Cons

**Pros:**
- Zero temp files
- Shell-native, familiar syntax
- Works with all Unix tools
- Composes with pipes

**Cons:**
- Shell-specific (bash/zsh vs sh)
- Not cross-platform (Windows)
- Limited to text (binary requires encoding)
- Can't easily persist context

---

## Context Deduplication via Hashing

### Content-Addressed Storage

```typescript
// context/dedup.ts
export class DeduplicatedContextStore {
  private contentMap = new Map<string, string>();  // hash -> content
  private refCount = new Map<string, number>();     // hash -> ref count
  private metadata = new Map<string, ContextMetadata>();
  
  // Add content, return hash
  add(content: string, meta?: Partial<ContextMetadata>): string {
    const hash = this.computeHash(content);
    
    if (!this.contentMap.has(hash)) {
      this.contentMap.set(hash, content);
      this.refCount.set(hash, 0);
      this.metadata.set(hash, {
        size: content.length,
        created: Date.now(),
        lastAccessed: Date.now(),
        ...meta,
      });
    }
    
    // Increment reference count
    this.refCount.set(hash, this.refCount.get(hash)! + 1);
    
    return hash;
  }
  
  // Retrieve content by hash
  get(hash: string): string | null {
    const content = this.contentMap.get(hash);
    
    if (content) {
      // Update last accessed time
      const meta = this.metadata.get(hash)!;
      meta.lastAccessed = Date.now();
    }
    
    return content || null;
  }
  
  // Release reference
  release(hash: string): void {
    const count = this.refCount.get(hash) || 0;
    
    if (count <= 1) {
      // Last reference - can delete
      this.contentMap.delete(hash);
      this.refCount.delete(hash);
      this.metadata.delete(hash);
    } else {
      this.refCount.set(hash, count - 1);
    }
  }
  
  // Statistics
  stats(): DedupStats {
    const totalContent = Array.from(this.contentMap.values())
      .reduce((sum, content) => sum + content.length, 0);
    
    const totalRefs = Array.from(this.refCount.values())
      .reduce((sum, count) => sum + count, 0);
    
    const uniqueCount = this.contentMap.size;
    
    // Calculate savings
    const naiveSize = totalRefs * (totalContent / uniqueCount);
    const actualSize = totalContent;
    const saved = naiveSize - actualSize;
    const savedPct = (saved / naiveSize) * 100;
    
    return {
      uniqueObjects: uniqueCount,
      totalReferences: totalRefs,
      bytesStored: actualSize,
      bytesSaved: saved,
      deduplicationRatio: savedPct,
    };
  }
  
  private computeHash(content: string): string {
    const hasher = new Bun.CryptoHasher('blake2b256');
    hasher.update(content);
    return hasher.digest('hex');
  }
  
  // Eviction: LRU-based
  evictLRU(maxSize: number): number {
    const entries = Array.from(this.metadata.entries())
      .map(([hash, meta]) => ({ hash, meta }))
      .sort((a, b) => a.meta.lastAccessed - b.meta.lastAccessed);
    
    let currentSize = Array.from(this.contentMap.values())
      .reduce((sum, c) => sum + c.length, 0);
    
    let evicted = 0;
    
    for (const { hash, meta } of entries) {
      if (currentSize <= maxSize) break;
      
      // Only evict if refCount is 0
      if (this.refCount.get(hash) === 0) {
        currentSize -= meta.size;
        this.contentMap.delete(hash);
        this.metadata.delete(hash);
        this.refCount.delete(hash);
        evicted++;
      }
    }
    
    return evicted;
  }
}

interface ContextMetadata {
  size: number;
  created: number;
  lastAccessed: number;
}

interface DedupStats {
  uniqueObjects: number;
  totalReferences: number;
  bytesStored: number;
  bytesSaved: number;
  deduplicationRatio: number;
}
```

### Rolling Hash for Chunking (rsync-style)

For large contexts, deduplicate at chunk level:

```typescript
// context/chunking.ts
export class RollingHashChunker {
  private readonly windowSize = 64;
  private readonly avgChunkSize = 8192; // 8KB
  
  // Split content into chunks using Rabin fingerprinting
  chunk(content: string): string[] {
    const bytes = new TextEncoder().encode(content);
    const chunks: string[] = [];
    let start = 0;
    
    for (let i = this.windowSize; i < bytes.length; i++) {
      const hash = this.rollingHash(bytes.slice(i - this.windowSize, i));
      
      // Split when hash matches pattern (e.g., lower bits are 0)
      if ((hash & (this.avgChunkSize - 1)) === 0) {
        chunks.push(content.slice(start, i));
        start = i;
      }
    }
    
    // Final chunk
    if (start < content.length) {
      chunks.push(content.slice(start));
    }
    
    return chunks;
  }
  
  private rollingHash(window: Uint8Array): number {
    let hash = 0;
    
    for (let i = 0; i < window.length; i++) {
      hash = (hash * 31 + window[i]) & 0xFFFFFFFF;
    }
    
    return hash;
  }
}

// Usage: deduplicate large similar contexts
const chunker = new RollingHashChunker();
const store = new DeduplicatedContextStore();

const chunks1 = chunker.chunk(largeContext1);
const chunks2 = chunker.chunk(largeContext2);

// Many chunks will have same hash (shared content)
const hashes1 = chunks1.map(c => store.add(c));
const hashes2 = chunks2.map(c => store.add(c));

console.log(store.stats());
// -> deduplicationRatio: 87.3% (if contexts are similar)
```

### Pros & Cons

**Pros:**
- Massive space savings for similar contexts
- Fast hash-based lookups
- Works with any size content
- Automatic with content addressing

**Cons:**
- Hash computation overhead
- Hash collisions (vanishingly rare with SHA-256)
- Complexity in managing reference counts
- Memory usage for hash tables

---

## How Other Tools Solve This

### Git: Content-Addressed Blobs

```bash
# Git never uses temp files for content
echo "Hello" | git hash-object -w --stdin
# -> ce013625030ba8dba906f756967f9e9ca394464a

# Retrieve by hash (from .git/objects/)
git cat-file -p ce013625030ba8dba906f756967f9e9ca394464a
# -> Hello

# Key insight: immutable, deduplicated, compressed
```

**Lessons for Karl:**
- Content-addressed storage works at massive scale
- Compression layer (zlib) saves space
- Pack files for efficient bulk storage
- Ref-counting for garbage collection

### Docker: Layered Filesystem

```bash
# Docker images are layers, each content-addressed
docker pull ubuntu
# -> Each layer is a hash: sha256:abc123...

# Layers are cached and shared between images
docker history ubuntu
# -> Shows reusable layers

# Key insight: copy-on-write, layer sharing
```

**Lessons for Karl:**
- Layered contexts (base + delta)
- Share common context across invocations
- Lazy loading (only pull layers when needed)

### Nix: Functional Package Management

```bash
# Nix stores everything by hash of inputs
/nix/store/abc123-package-1.0/bin/program

# Same inputs = same hash = same path (caching)

# Key insight: reproducibility through hashing
```

**Lessons for Karl:**
- Hash inputs (context) to produce deterministic IDs
- Cache results by context hash
- Invalidate cache when context changes

### Rsync: Efficient Delta Transfer

```bash
# Rsync sends only chunks that differ
rsync -av --checksum source/ dest/

# Rolling hash to find matching blocks

# Key insight: chunk-level deduplication
```

**Lessons for Karl:**
- For large contexts, chunk and deduplicate
- Only send/store unique chunks
- Reconstruct full context from chunk IDs

### Database: Connection Pooling

```javascript
// Don't create new connection per query
const pool = createPool({ max: 10 });

// Reuse connections
await pool.query('SELECT ...');

// Key insight: reuse expensive resources
```

**Lessons for Karl:**
- Context server with connection pooling
- Reuse expensive parsing/indexing work
- Keep hot contexts in memory

---

## Implementation Sketches

### Complete In-Memory Context Manager

```typescript
// context/manager.ts
import { EnvironmentContext } from './env';
import { FIFOContext } from './fifo';
import { DeduplicatedContextStore } from './dedup';
import { HeredocContext } from './heredoc';

export interface ContextSource {
  name: string;
  content: string;
  hash: string;
}

export class ContextManager {
  private store = new DeduplicatedContextStore();
  private sources: ContextSource[] = [];
  
  // Add from environment
  async addFromEnv(): Promise<void> {
    const env = new EnvironmentContext();
    const content = env.getMergedContext();
    
    if (content) {
      const hash = this.store.add(content);
      this.sources.push({ name: 'env', content, hash });
    }
  }
  
  // Add from stdin/heredoc
  async addFromStdin(): Promise<void> {
    const content = await HeredocContext.fromStdin();
    
    if (content) {
      const hash = this.store.add(content);
      this.sources.push({ name: 'stdin', content, hash });
    }
  }
  
  // Add from FIFO
  async addFromFIFO(path: string): Promise<void> {
    const fifo = new FIFOContext(path);
    const chunks: string[] = [];
    
    for await (const chunk of fifo.stream()) {
      chunks.push(chunk);
    }
    
    const content = chunks.join('');
    const hash = this.store.add(content);
    this.sources.push({ name: `fifo:${path}`, content, hash });
  }
  
  // Add from file (as last resort)
  async addFromFile(path: string): Promise<void> {
    const content = await Bun.file(path).text();
    const hash = this.store.add(content);
    this.sources.push({ name: `file:${path}`, content, hash });
  }
  
  // Add raw content
  add(name: string, content: string): string {
    const hash = this.store.add(content);
    this.sources.push({ name, content, hash });
    return hash;
  }
  
  // Get all context merged
  getMerged(): string {
    return this.sources
      .map(s => `### ${s.name} ###\n${s.content}`)
      .join('\n\n');
  }
  
  // Get by hash
  get(hash: string): string | null {
    return this.store.get(hash);
  }
  
  // Statistics
  stats() {
    return {
      sources: this.sources.length,
      dedup: this.store.stats(),
    };
  }
  
  // Clear all sources
  clear(): void {
    this.sources.forEach(s => this.store.release(s.hash));
    this.sources = [];
  }
}

// CLI integration
export async function buildContext(opts: CLIOptions): Promise<ContextManager> {
  const mgr = new ContextManager();
  
  // Priority order: stdin > env > files > default
  
  if (HeredocContext.hasStdin()) {
    await mgr.addFromStdin();
  }
  
  if (opts.contextEnv) {
    await mgr.addFromEnv();
  }
  
  if (opts.contextFifo) {
    await mgr.addFromFIFO(opts.contextFifo);
  }
  
  if (opts.contextFiles) {
    for (const file of opts.contextFiles) {
      await mgr.addFromFile(file);
    }
  }
  
  return mgr;
}
```

### Smart Context Selector

```typescript
// context/selector.ts
export class ContextSelector {
  // Auto-detect best source
  static async autoSelect(): Promise<ContextSource> {
    // 1. Check stdin first (highest priority)
    if (!Bun.stdin.isTTY) {
      return { type: 'stdin', path: null };
    }
    
    // 2. Check environment
    if (Bun.env.KARL_CONTEXT) {
      return { type: 'env', path: null };
    }
    
    // 3. Check for .karl/context file in cwd
    const localContext = '.karl/context';
    if (await Bun.file(localContext).exists()) {
      return { type: 'file', path: localContext };
    }
    
    // 4. Check for global context
    const globalContext = `${Bun.env.HOME}/.karl/default-context`;
    if (await Bun.file(globalContext).exists()) {
      return { type: 'file', path: globalContext };
    }
    
    // 5. Check for context server
    const serverSocket = `${Bun.env.HOME}/.karl/context.sock`;
    try {
      await Bun.connect({ unix: serverSocket });
      return { type: 'server', path: serverSocket };
    } catch {
      // Server not running
    }
    
    return { type: 'none', path: null };
  }
}

interface ContextSource {
  type: 'stdin' | 'env' | 'file' | 'server' | 'none';
  path: string | null;
}
```

### Streaming Context Processor

```typescript
// context/stream.ts
export class StreamingContextProcessor {
  private buffer = '';
  private chunkSize = 4096;
  
  async *process(source: AsyncIterable<string>): AsyncGenerator<ProcessedChunk> {
    for await (const chunk of source) {
      this.buffer += chunk;
      
      // Process complete units (e.g., lines, paragraphs)
      while (this.buffer.length >= this.chunkSize) {
        const processed = this.processChunk(this.buffer.slice(0, this.chunkSize));
        yield processed;
        
        this.buffer = this.buffer.slice(this.chunkSize);
      }
    }
    
    // Process remaining buffer
    if (this.buffer.length > 0) {
      yield this.processChunk(this.buffer);
    }
  }
  
  private processChunk(text: string): ProcessedChunk {
    return {
      text,
      hash: this.hash(text),
      tokens: this.estimateTokens(text),
    };
  }
  
  private hash(text: string): string {
    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update(text);
    return hasher.digest('hex').slice(0, 16);
  }
  
  private estimateTokens(text: string): number {
    // Rough estimate: 1 token ≈ 4 chars
    return Math.ceil(text.length / 4);
  }
}

interface ProcessedChunk {
  text: string;
  hash: string;
  tokens: number;
}
```

---

## Recommended Architecture

### Hybrid Approach (Best of All Worlds)

```
┌─────────────────────────────────────────────────────────┐
│                     Karl CLI                             │
└─────────────────────────────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
    ╔══════════╗     ╔══════════╗     ╔══════════╗
    ║  Stdin   ║     ║   Env    ║     ║  Args    ║
    ╚══════════╝     ╚══════════╝     ╚══════════╝
          │                │                │
          └────────────────┼────────────────┘
                           ▼
                   ┌───────────────┐
                   │ Context Manager│
                   │ (in-memory)   │
                   └───────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
    [Dedup Store]    [Hash Index]     [LRU Cache]
          │                │                │
          └────────────────┼────────────────┘
                           ▼
                    [ AI Request ]
```

**Rules:**
1. **Prefer stdin** for piped data (Unix-native)
2. **Use env vars** for programmatic context injection
3. **Use context IDs** for reusable/cached context
4. **Deduplicate** automatically in background
5. **No temp files** unless explicitly requested (`--persist`)

### Example CLI

```bash
# Stdin (highest priority)
cat logs.txt | karl "analyze errors"

# Environment variable
KARL_CONTEXT="$(git diff)" karl "review this"

# Multiple sources (merged)
KARL_CONTEXT_LOGS="$(tail -100 app.log)" \
KARL_CONTEXT_CODE="$(cat main.ts)" \
  karl "debug the issue"

# Named pipe for streaming
mkfifo /tmp/stream
tail -f app.log > /tmp/stream &
karl --context-stream /tmp/stream "monitor for warnings"

# Context ID (reusable)
CONTEXT_ID=$(cat bigfile.txt | karl context add)
karl --ctx $CONTEXT_ID "question 1"
karl --ctx $CONTEXT_ID "question 2"  # reused, deduplicated

# Process substitution (no temp files)
karl --ctx-diff <(git show HEAD~1) <(git show HEAD) "compare"

# Heredoc
karl "explain this" <<EOF
function broken() {
  return undefined?.missing?.property;
}
EOF
```

---

## Performance Considerations

### Benchmark: Temp Files vs In-Memory

```typescript
// benchmark/context.bench.ts
import { bench, run } from 'mitata';

const largeContext = 'x'.repeat(1_000_000); // 1MB

// Temp file approach
bench('temp file write+read', async () => {
  const path = `/tmp/bench-${Math.random()}.txt`;
  await Bun.write(path, largeContext);
  const content = await Bun.file(path).text();
  await Bun.spawn(['rm', path]);
});

// In-memory approach
bench('in-memory store', () => {
  const store = new Map();
  store.set('ctx', largeContext);
  const content = store.get('ctx');
});

// Environment variable (limited size)
bench('env variable', () => {
  process.env.BENCH_CTX = largeContext;
  const content = process.env.BENCH_CTX;
  delete process.env.BENCH_CTX;
});

await run();

/*
Results (estimated):
  temp file write+read:  ~5-10ms
  in-memory store:       ~0.01ms  (500-1000x faster)
  env variable:          ~0.1ms   (50-100x faster)
*/
```

### Memory vs Disk Trade-offs

| Approach | Speed | Memory | Persistence | Sharing |
|----------|-------|--------|-------------|---------|
| Temp files | ⭐⭐ | ⭐⭐⭐⭐⭐ | ✅ | ✅ |
| In-memory | ⭐⭐⭐⭐⭐ | ⭐⭐ | ❌ | ❌ |
| Env vars | ⭐⭐⭐⭐ | ⭐⭐⭐ | ❌ | ⚠️ |
| Named pipes | ⭐⭐⭐ | ⭐⭐⭐⭐ | ❌ | ✅ |
| Context server | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⚠️ | ✅ |

**Recommendation:** Use **in-memory by default**, with **optional persistence** via context server.

---

## Migration Path

### Phase 1: Add In-Memory Support (No Breaking Changes)

```typescript
// Keep existing --context flag, add detection
if (opts.context) {
  if (opts.context.startsWith('/dev/fd/')) {
    // Process substitution
    contextManager.addFromFD(opts.context);
  } else if (isFIFO(opts.context)) {
    // Named pipe
    contextManager.addFromFIFO(opts.context);
  } else {
    // Regular file (existing behavior)
    contextManager.addFromFile(opts.context);
  }
}

// Add new flags
if (opts.contextStdin || HeredocContext.hasStdin()) {
  await contextManager.addFromStdin();
}

if (opts.contextEnv) {
  await contextManager.addFromEnv();
}
```

### Phase 2: Deprecate Temp File Creation

```typescript
// Instead of:
const tmpFile = `/tmp/karl-${Date.now()}.txt`;
await Bun.write(tmpFile, context);
// ... use context
await Bun.spawn(['rm', tmpFile]);

// Use:
const contextId = contextManager.add('generated', context);
// ... use context
// Automatic cleanup on process exit
```

### Phase 3: Add Context Server (Optional)

```bash
# Start server (optional, for advanced users)
karl serve --socket ~/.karl/context.sock

# CLI auto-detects and uses if available
karl "analyze this" < large-file.txt
# -> Automatically deduplicated if seen before
```

---

## Conclusion

### The Unix Way

**Avoid temp files by using:**
1. **Stdin/stdout** for streaming data
2. **Environment variables** for small-to-medium context
3. **Named pipes (FIFOs)** for process communication
4. **Process substitution** for parallel inputs
5. **In-memory stores** for deduplication and caching

### Recommended Implementation Priority

1. ✅ **Stdin support** (heredoc, pipes) — easiest, most Unix-native
2. ✅ **Environment variables** — simple, cross-platform
3. ✅ **In-memory context manager** — performance win, no cleanup issues
4. ⚠️ **Named pipes** — advanced, for streaming use cases
5. 🔮 **Context server** — overkill for v1, plan for later
6. 🔮 **Virtual filesystem** — research project, not critical

### Code Changes Needed

```typescript
// 1. Add context/manager.ts (new)
// 2. Update cli/commands/*.ts to use ContextManager
// 3. Add --context-env, --context-stdin flags
// 4. Deprecate manual temp file creation
// 5. Add deduplication stats to verbose output
```

### User-Facing Benefits

- **Faster execution** (no disk I/O)
- **No cleanup hassles** (no orphaned temp files)
- **More composable** (works with pipes, heredocs)
- **Automatic deduplication** (saves memory and API costs)
- **Familiar patterns** (stdin, env vars, etc.)

**The tennis metaphor:** Context should be passed like a tennis ball—fast, in-flight, not dropped on the court (temp files). Karl serves it, the AI returns it, all in memory. ⚡🎾
