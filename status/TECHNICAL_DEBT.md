# Technical Debt

Known issues, open questions, and refactoring opportunities.

---

## Type Safety Issues

### Provider Type Mismatches

**Location:** `runner.ts:123,127`

```typescript
// Current workaround:
setApiKey(piAiProvider as any, params.apiKey);
const baseModel = getModel(piAiProvider as any, params.model);
```

**Problem:** Karl's flexible provider names don't match pi-ai's strict `KnownProvider` union.

**Fix:** Create type guard or validate against whitelist.

### Heterogeneous Tool Return Types

**Location:** `tools.ts:312-344`

**Problem:** `read` tool returns different shapes:
- Image: `{ path, encoding: 'base64', mime }`
- Binary: `{ path, encoding: 'base64', bytes }`
- Text: `{ path, encoding: 'utf8', bytes }`

**Fix:** Define discriminated union or split tools.

### Tool Array Type Erasure

**Location:** `tools.ts:399-400`

```typescript
return [bash, read, write, edit] as AgentTool<any, any>[];
```

**Fix:** Define explicit return type with base interface.

---

## Testing & Quality

### Zero Test Coverage

**Impact:** High regression risk, no automated validation.

**Suggested priorities:**
1. `scheduler.ts` - Retry logic
2. `config.ts` - Merging, resolution
3. `utils.ts` - Parsing utilities
4. `skills.ts` - Validation

### No Input Validation

**Locations:**
- `cli.ts:95-102` - Model input
- `skills.ts:287` - Path validation only
- `utils.ts:74-95` - Duration parsing

**Fix:** Add runtime validation (TypeBox/Zod).

---

## Code Smells

### Excessive Console Usage

**200+ console.log/error/warn calls**

**Locations:**
- `commands/models.ts` - 50+
- `commands/providers.ts` - 50+
- Various other files

**Fix:** Create centralized logger abstraction.

### Heavy process.exit Usage

**45+ process.exit(1) calls**

**Locations:**
- Command files (models, providers, stacks, skills)

**Fix:** Throw exceptions, catch at top level.

### Mixed Async/Sync File I/O

**72 synchronous file operations**

**Locations:**
- `skills.ts` - readFileSync, existsSync
- `stacks.ts` - readFileSync, readdirSync
- `oauth.ts` - readFileSync, writeFileSync

**Fix:** Standardize on async operations.

### Large Command Files

| File | Lines |
|------|-------|
| `cli.ts` | 796 |
| `commands/models.ts` | 588 |
| `commands/providers.ts` | 543 |

**Fix:** Extract wizards, split handlers.

---

## Architecture

### Global State Management

**Location:** `stacks.ts:262-268`

```typescript
let defaultManager: StackManager | null = null;
```

**Problem:** Singleton pattern, config changes not reflected.

**Fix:** Remove singleton, use dependency injection.

### Error Handling Inconsistencies

**Three patterns in use:**
1. `throw new Error()` - utils, config, skills
2. `console.error() + process.exit(1)` - commands
3. `try/catch with console.warn` - skills, hooks

**Fix:** Establish consistent pattern.

### Tight Coupling to pi-ai

**Problem:** Core runner.ts tightly coupled with type workarounds.

**Fix:** Create abstraction layer.

---

## Security Concerns

### Path Traversal Risk

**Current protection:**
- `assertWithinCwd()` for write/edit tools

**Gaps:**
- `read` tool doesn't validate paths
- Custom tool paths not validated
- `--context-file` not validated

### Command Injection

**Location:** `tools.ts:153-167`

**Current:** No sanitization (by design - it's a bash tool).

**Fix:** Document security implications clearly.

### Credentials in Environment

**Problem:** Env vars passed to tools.

```typescript
env: { ...process.env, ...env }
```

**Fix:** Filter sensitive vars before passing.

---

## Missing Features

### Skill YAML Parser

**Location:** `skills.ts:112-162`

**Problem:** Simple line-by-line parser, doesn't handle:
- Nested structures
- Arrays
- Edge cases

**Fix:** Use proper YAML library (js-yaml).

### OAuth Error Recovery

**Location:** `oauth.ts:190-209`

**Problem:** Refresh failure returns null silently.

**Fix:** Throw specific error with guidance.

### Stack Inheritance Validation

**Problem:** Validates cycles but not schema correctness.

**Fix:** Validate merged stack schema.

---

## Open Questions

1. **Plugin discovery?** Should Karl auto-discover plugins?
2. **Multi-provider routing?** Fallback, load balancing?
3. **Caching strategy?** Cache LLM responses?

---

## Priority Matrix

### Critical (Before v1.0)

- [ ] Add input validation
- [ ] Write tests for core logic
- [ ] Document security model
- [ ] Fix path traversal gaps

### High Priority (v1.x)

- [ ] Replace console with logger
- [ ] Convert exits to exceptions
- [ ] Add JSDoc to public APIs
- [ ] Fix TypeScript any casts

### Long Term (v2.0)

- [ ] Abstract pi-ai dependency
- [ ] Dependency injection
- [ ] Plugin system design
- [ ] Full async file operations

---

## Summary

| Category | Items |
|----------|-------|
| Type safety | 3 |
| Testing | 2 |
| Code smells | 4 |
| Architecture | 3 |
| Security | 3 |
| Missing features | 3 |
| **Total** | **18+** |

**Most urgent:** Testing and validation infrastructure before v1.0.
