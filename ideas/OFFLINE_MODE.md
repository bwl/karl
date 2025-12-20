# Offline Mode

Karl works seamlessly offline with local models. No internet? No problem. Just like Karlović's serve - fast, local, and reliable.

## Philosophy

**Cloud-first, offline-ready.** Karl auto-detects network conditions and falls back gracefully to local models. The CLI works the same way whether you're on a plane, in a bunker, or behind a corporate firewall.

## Supported Local Model Backends

### Ollama (Recommended)

**Best for:** Simplicity, Apple Silicon, everyday use

```bash
# Install
curl -fsSL https://ollama.com/install.sh | sh

# Pull models
ollama pull codellama:13b
ollama pull deepseek-coder:6.7b
ollama pull mistral:7b

# Karl auto-detects Ollama at http://localhost:11434
karl "explain this function" --stack ollama-codellama
```

**Pros:**
- Zero configuration
- Automatic model management
- GPU acceleration (CUDA, Metal, ROCm)
- Fastest startup time

**Cons:**
- Less control over sampling parameters
- Limited to Ollama's model library

### vLLM

**Best for:** High throughput, batch processing, production deployments

```bash
# Install
pip install vllm

# Start server
python -m vllm.entrypoints.openai.api_server \
  --model deepseek-ai/deepseek-coder-6.7b-instruct \
  --port 8000 \
  --dtype auto

# Configure Karl
karl config set stacks.vllm-deepseek.model "deepseek-coder-6.7b"
karl config set stacks.vllm-deepseek.endpoint "http://localhost:8000/v1"
```

**Pros:**
- Highest throughput (PagedAttention)
- OpenAI-compatible API
- Excellent batching
- Continuous batching for low latency

**Cons:**
- Higher memory requirements
- Longer startup time
- More complex configuration

### llama.cpp

**Best for:** CPU-only machines, low memory, edge devices

```bash
# Build
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp && make

# Download GGUF model
wget https://huggingface.co/TheBloke/deepseek-coder-6.7B-instruct-GGUF/resolve/main/deepseek-coder-6.7b-instruct.Q4_K_M.gguf

# Start server
./server -m deepseek-coder-6.7b-instruct.Q4_K_M.gguf \
  -c 4096 \
  --port 8080 \
  --threads 8

# Configure Karl
karl config set stacks.llama-local.model "deepseek-coder-6.7b"
karl config set stacks.llama-local.endpoint "http://localhost:8080/v1"
```

**Pros:**
- Runs on CPU only
- Low memory footprint (quantized models)
- Wide model format support (GGUF)
- Works on embedded devices

**Cons:**
- Slower inference
- Limited context window on low-RAM machines

### LM Studio

**Best for:** GUI users, Windows, experimentation

Download from https://lmstudio.ai, load a model, start local server. Karl auto-detects at `http://localhost:1234/v1`.

## Automatic Fallback

Karl detects network and falls back automatically:

```typescript
// .karl/config.toml
[stacks.auto]
model = "claude-3-5-sonnet-20241022"
fallback = "ollama:codellama:13b"
offline_mode = "auto"  # auto | always | never

[stacks.offline-first]
model = "ollama:deepseek-coder:6.7b"
# No fallback - always use local
```

**Fallback behavior:**

1. **Auto-detect** - Ping Anthropic API (timeout: 2s)
2. **Network down?** - Check local endpoints (Ollama, vLLM, llama.cpp)
3. **Local available?** - Use local model
4. **No local?** - Error with helpful message

```bash
# Force offline mode
karl "refactor this" --offline

# Disable offline fallback
karl "needs opus" --no-fallback

# Check what model would be used
karl --dry-run "test prompt"
# → Would use: ollama:codellama:13b (offline fallback)
```

## Model Capability Detection

Karl auto-detects model capabilities:

| Capability | Claude Opus | Claude Sonnet | DeepSeek Coder 6.7B | CodeLlama 13B |
|------------|-------------|---------------|---------------------|---------------|
| Code generation | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| Code review | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| Creative writing | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐ |
| Tool calling | ✅ Native | ✅ Native | ⚠️ Simulated | ⚠️ Simulated |
| Context window | 200K | 200K | 16K | 16K |
| Speed (tok/s) | ~50 | ~100 | 30-80 | 20-50 |
| Cost | $$$ | $$ | Free | Free |

**Auto-detection in action:**

```bash
# Karl checks model capabilities
karl "complex refactoring" --skill complex-codebase

# If local model doesn't support required features:
# ⚠️  Warning: ollama:codellama doesn't support native tool calling
# ℹ️  Using simulated tool calls (may be less reliable)
# Continue? [Y/n]
```

## Skill Compatibility with Local Models

### Fully Compatible

These skills work great with local models:

- **code-review** - DeepSeek Coder excels here
- **explain-code** - Any 7B+ model works
- **refactor** - CodeLlama, DeepSeek, Mistral
- **debug** - Good results with 13B+ models
- **documentation** - Even small models handle this

### Partially Compatible

Need workarounds or larger models:

- **architect** - Works but less creative (recommend 13B+)
- **security-audit** - Requires fine-tuned models or 30B+
- **test-generation** - Good with DeepSeek, okay with others
- **performance-optimization** - Hit or miss, depends on language

### Cloud-Only

These skills require cloud models:

- **multi-language** - Local models often specialize
- **vision** - Requires multimodal (future: llava, bakllava)
- **web-scraping** - Needs internet anyway
- **api-integration** - Often needs real-time data

**Override skill requirements:**

```bash
# Skill says "requires Opus", but force local
karl --skill architect --force-local "design a distributed cache"

# Will warn but proceed with local model
```

## Performance Expectations

### Hardware Recommendations

**Minimum (CPU only):**
- 16GB RAM
- 8-core CPU
- 20-30 tokens/sec with 7B quantized models

**Recommended (GPU):**
- 24GB VRAM (RTX 3090, 4090)
- 32GB RAM
- 60-100 tokens/sec with 13B models

**Optimal (Multi-GPU):**
- 2x RTX 4090 or A100
- 64GB RAM
- 100-200 tokens/sec with 30B+ models

### Real-World Benchmarks

**Task: Generate 500-token function (DeepSeek Coder 6.7B)**

| Setup | Tokens/sec | Time | Quality |
|-------|-----------|------|---------|
| llama.cpp CPU (Q4) | 12 | 42s | ⭐⭐⭐ |
| llama.cpp GPU (Q4) | 45 | 11s | ⭐⭐⭐ |
| Ollama Mac M2 | 35 | 14s | ⭐⭐⭐⭐ |
| vLLM RTX 4090 | 85 | 6s | ⭐⭐⭐⭐ |
| Claude Sonnet API | 100 | 5s | ⭐⭐⭐⭐⭐ |

**Task: Code review (1000 lines)**

| Model | Time | Accuracy | Useful? |
|-------|------|----------|---------|
| CodeLlama 7B | 45s | 70% | ⭐⭐⭐ |
| DeepSeek 6.7B | 35s | 85% | ⭐⭐⭐⭐ |
| Mistral 7B | 30s | 75% | ⭐⭐⭐ |
| Claude Sonnet | 18s | 95% | ⭐⭐⭐⭐⭐ |

## Setup Guides

### Quick Start: Ollama on MacOS

```bash
# 1. Install Ollama
brew install ollama

# 2. Start service
brew services start ollama

# 3. Pull recommended model
ollama pull deepseek-coder:6.7b

# 4. Configure Karl
cat >> ~/.karl/config.toml <<EOF
[stacks.local]
model = "ollama:deepseek-coder:6.7b"
temperature = 0.2
max_tokens = 4096

[stacks.sonnet]
model = "claude-3-5-sonnet-20241022"
fallback = "ollama:deepseek-coder:6.7b"
offline_mode = "auto"
EOF

# 5. Test
karl "write a fibonacci function" --stack local

# 6. Set as default
karl config set default_stack local
```

### Advanced: vLLM with Multiple GPUs

```bash
# 1. Install vLLM
pip install vllm ray

# 2. Start with tensor parallelism
python -m vllm.entrypoints.openai.api_server \
  --model deepseek-ai/deepseek-coder-33b-instruct \
  --tensor-parallel-size 2 \
  --dtype float16 \
  --port 8000 \
  --max-model-len 8192

# 3. Configure Karl
cat >> ~/.karl/config.toml <<EOF
[stacks.vllm-33b]
model = "deepseek-coder-33b"
endpoint = "http://localhost:8000/v1"
api_type = "openai"
temperature = 0.1
max_tokens = 8192
EOF

# 4. Benchmark
time karl "implement a B-tree" --stack vllm-33b
```

### Air-Gapped: llama.cpp on Linux Server

```bash
# 1. Build llama.cpp with CUDA
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
make LLAMA_CUBLAS=1

# 2. Download model (on internet-connected machine)
wget https://huggingface.co/TheBloke/CodeLlama-13B-Instruct-GGUF/resolve/main/codellama-13b-instruct.Q5_K_M.gguf

# 3. Transfer to air-gapped machine via USB/sneakernet

# 4. Start server
./server \
  -m codellama-13b-instruct.Q5_K_M.gguf \
  -c 8192 \
  --port 8080 \
  --threads 16 \
  -ngl 35  # GPU layers

# 5. Configure Karl
export KARL_STACK=airgap
cat >> ~/.karl/config.toml <<EOF
[stacks.airgap]
model = "codellama-13b"
endpoint = "http://localhost:8080/v1"
offline_mode = "always"
EOF

# 6. Verify no network calls
karl "hello world" --stack airgap 2>&1 | grep -i "http"
# Should be empty (except localhost)
```

## Caching Strategies for Offline Work

### Prompt Cache

Karl caches prompts to avoid re-generation:

```bash
# Enable prompt caching
karl config set cache.prompts true
karl config set cache.ttl 86400  # 24 hours

# Cache location
~/.karl/cache/prompts/
  ├── sha256-abc123.json  # Prompt + response
  ├── sha256-def456.json
  └── index.json
```

**How it works:**

1. Hash prompt + model + temperature + skill
2. Check cache (hit = instant response)
3. Miss = generate + cache result
4. Offline = only use cache (fail if missing)

```bash
# Pre-populate cache before going offline
karl-cache warm --skill code-review --samples 100

# Use cache-only mode (perfect for demos)
karl "refactor" --cache-only --stack local
```

### Model Cache

Ollama and vLLM cache model weights automatically. For llama.cpp:

```bash
# Keep models in ~/.karl/models/
mkdir -p ~/.karl/models
cd ~/.karl/models

# Download models
wget https://huggingface.co/.../model.gguf

# Point llama.cpp server at this directory
./server -m ~/.karl/models/codellama-13b.gguf
```

### Context Cache

Cache frequently-used context (skills, project files):

```bash
# .karl/config.toml
[cache]
context = true
context_dir = "/home/user/.karl/context-cache/"

# Pre-load common contexts
karl context add common ~/.karl/skills/*.md
karl context add project ./**/*.ts --cache
```

### Response Cache

Cache responses for deterministic prompts:

```bash
# Enable response caching (temperature=0 only)
karl config set cache.responses true

# Now deterministic prompts are instant
karl "format this code" < input.js  # First run: 5s
karl "format this code" < input.js  # Cached: 0.1s
```

## Syncing When Back Online

### Automatic Sync

Karl syncs cache and logs when network returns:

```bash
# .karl/config.toml
[sync]
enabled = true
endpoint = "https://karl-sync.example.com"
api_key = "${KARL_SYNC_KEY}"
sync_cache = false  # Don't sync cache (too large)
sync_logs = true    # Sync logs for analytics
sync_config = true  # Sync config changes
```

**Sync behavior:**

1. Network detected
2. Push logs: `~/.karl/logs/*.jsonl`
3. Pull config updates
4. Merge conflicts (local wins)

### Manual Sync

```bash
# Force sync now
karl sync

# Sync specific data
karl sync --logs
karl sync --config

# Check sync status
karl sync --status
# Last sync: 2 hours ago
# Pending: 150 log entries
# Conflicts: 0

# Resolve conflicts
karl sync --resolve interactive
```

### Sync-Free Mode

Completely disable sync for security:

```bash
# .karl/config.toml
[sync]
enabled = false

# Or via environment
export KARL_SYNC_DISABLED=1
```

## Air-Gapped Environment Support

### Complete Offline Install

**Step 1: Prepare on internet-connected machine**

```bash
# Create offline bundle
mkdir karl-offline-bundle
cd karl-offline-bundle

# Download Karl CLI
curl -O https://karl.sh/install/karl-linux-x64

# Download models
wget https://huggingface.co/TheBloke/deepseek-coder-6.7B-instruct-GGUF/resolve/main/deepseek-coder-6.7b-instruct.Q4_K_M.gguf
wget https://huggingface.co/TheBloke/CodeLlama-13B-Instruct-GGUF/resolve/main/codellama-13b-instruct.Q5_K_M.gguf

# Download llama.cpp
git clone --depth 1 https://github.com/ggerganov/llama.cpp
cd llama.cpp && make && cd ..

# Create bundle
tar czf karl-offline-bundle.tar.gz *
```

**Step 2: Transfer to air-gapped machine**

```bash
# Via USB, CD, or approved transfer method
# Copy karl-offline-bundle.tar.gz to target machine
```

**Step 3: Install on air-gapped machine**

```bash
# Extract bundle
tar xzf karl-offline-bundle.tar.gz
cd karl-offline-bundle

# Install Karl
chmod +x karl-linux-x64
sudo mv karl-linux-x64 /usr/local/bin/karl

# Setup llama.cpp server
cd llama.cpp
./server -m ../deepseek-coder-6.7b-instruct.Q4_K_M.gguf \
  --port 8080 \
  -c 4096 &

# Configure Karl for air-gapped use
mkdir -p ~/.karl
cat > ~/.karl/config.toml <<EOF
[global]
offline_mode = "always"
telemetry = false
check_updates = false

[stacks.default]
model = "deepseek-coder-6.7b"
endpoint = "http://localhost:8080/v1"
api_type = "openai"
EOF

# Verify
karl "test offline mode" --stack default
```

### Security Considerations

**Network verification:**

```bash
# Ensure Karl never phones home
strace karl "test" 2>&1 | grep connect
# Should only show localhost:8080

# Or use network namespace isolation
unshare -n karl "test"
# Should work (proves no network calls)
```

**Audit mode:**

```bash
# .karl/config.toml
[security]
audit_mode = true
audit_log = "/var/log/karl-audit.log"
block_network = true  # Hard fail on any network attempt

# Now all tool calls and responses are logged
tail -f /var/log/karl-audit.log
```

## Example Configurations

### Developer Laptop (Hybrid)

```toml
# ~/.karl/config.toml
[global]
default_stack = "auto"

[stacks.auto]
model = "claude-3-5-sonnet-20241022"
fallback = "ollama:deepseek-coder:6.7b"
offline_mode = "auto"

[stacks.local]
model = "ollama:deepseek-coder:6.7b"
temperature = 0.2

[stacks.opus]
model = "claude-3-opus-20240229"
# No fallback - must be online

[cache]
prompts = true
responses = true
ttl = 86400
```

**Usage:**
```bash
# Auto-selects based on network
karl "quick refactor" --skill refactor

# Force cloud (for hard problems)
karl "complex architecture" --stack opus

# Force local (on plane)
karl "code review" --stack local
```

### Build Server (Local-Only)

```toml
# ~/.karl/config.toml on CI server
[global]
default_stack = "vllm"
offline_mode = "always"

[stacks.vllm]
model = "deepseek-coder-33b"
endpoint = "http://10.0.1.50:8000/v1"
temperature = 0.0  # Deterministic for CI
max_tokens = 8192

[cache]
prompts = true
responses = true
ttl = 604800  # 1 week

[security]
audit_mode = true
audit_log = "/var/log/karl-ci-audit.log"
block_network = true
```

**Usage in CI:**
```yaml
# .github/workflows/code-review.yml
- name: AI Code Review
  run: |
    karl --skill code-review \
      --stack vllm \
      --input <(git diff origin/main) \
      > review-comments.md
```

### Air-Gapped Workstation

```toml
# ~/.karl/config.toml (classified environment)
[global]
default_stack = "airgap"
offline_mode = "always"
telemetry = false
check_updates = false

[stacks.airgap]
model = "codellama-13b"
endpoint = "http://127.0.0.1:8080/v1"
temperature = 0.1

[cache]
prompts = true
responses = true
ttl = 2592000  # 30 days
context = true

[security]
audit_mode = true
audit_log = "/secure/logs/karl.log"
block_network = true
require_approval = true  # Confirm before each run

[sync]
enabled = false
```

**Usage:**
```bash
# Every prompt requires approval
karl "implement crypto function"
# → About to call model: codellama-13b
# → Estimated tokens: ~2000
# → No network calls will be made
# → Approve? [y/N]
```

### Mobile Developer (MacBook)

```toml
# ~/.karl/config.toml
[global]
default_stack = "m2"

[stacks.m2]
model = "ollama:deepseek-coder:6.7b"
# Ollama auto-uses Metal GPU on Mac

[stacks.cloud]
model = "claude-3-5-sonnet-20241022"

# Auto-switch based on battery
[power]
on_battery = "m2"
on_power = "cloud"
```

**Usage:**
```bash
# Automatically uses local when on battery
karl "optimize this loop"
# → Using local model (on battery power)

# Plug in = switches to cloud
karl "complex refactoring"
# → Using Claude Sonnet (plugged in)
```

## Troubleshooting

### Local Model Not Found

```bash
# Check what Karl sees
karl models list --local

# Expected output:
# ✓ ollama:deepseek-coder:6.7b (localhost:11434)
# ✓ vllm:codellama-33b (localhost:8000)
# ✗ llama.cpp (localhost:8080) - not responding

# Debug connection
curl http://localhost:8080/v1/models
```

### Slow Inference

```bash
# Check GPU usage
nvidia-smi  # Should show 80%+ GPU util during inference

# Enable more GPU layers (llama.cpp)
./server -m model.gguf -ngl 35  # Increase from default

# Check context size
karl config get stacks.local.max_tokens
# If too large, reduce: 4096 is good sweet spot
```

### Out of Memory

```bash
# Use smaller quantization
# Q4_K_M instead of Q5_K_M (llama.cpp)

# Reduce context window
karl config set stacks.local.max_tokens 2048

# Use smaller model
ollama pull codellama:7b  # Instead of :13b
```

### Tool Calls Not Working

```bash
# Local models don't support native tool calling
# Karl simulates it, but may fail

# Option 1: Use cloud for tool-heavy tasks
karl --skill complex-codebase --stack sonnet

# Option 2: Disable tools
karl --no-tools "just explain, don't edit"

# Option 3: Use DeepSeek (better at simulated tools)
ollama pull deepseek-coder:6.7b
```

## Best Practices

1. **Pre-warm cache** before going offline
2. **Test your offline setup** while still online
3. **Use appropriate models** - don't expect 7B to match Opus
4. **Quantize aggressively** for laptops (Q4 is fine)
5. **Keep context small** - local models struggle with large contexts
6. **Batch operations** when possible for better GPU utilization
7. **Monitor temperature** - thermal throttling kills performance
8. **Use deterministic settings** (temp=0) for consistent results

---

**Karl works offline because code doesn't stop when WiFi does.**

Just like Karlović's serve - you don't need the crowd, you just need power and precision. 🎾
