# Technical Debt Report

TypeScript type issues that were patched with `any` casts. These need proper fixes.

## 1. runner.ts - Provider Type Mismatch

**Location:** `src/runner.ts:120,123`

**Problem:** The `pi-ai` library uses a strict `KnownProvider` union type, but karl's provider system allows arbitrary provider names from config.

```typescript
// Current workaround:
setApiKey(piAiProvider as any, params.apiKey);
const model = getModel(piAiProvider as any, params.model);
```

**Root cause:** `mapToPiAiProvider()` returns `string`, but `setApiKey` and `getModel` expect `KnownProvider` (likely `'anthropic' | 'openai' | ...`).

**Proper fix options:**
1. Import `KnownProvider` type from pi-ai and validate/narrow the type
2. Create a type guard: `function isKnownProvider(s: string): s is KnownProvider`
3. Use a const assertion in the mapping to preserve literal types
4. Request pi-ai library to export a looser type or validation function

---

## 2. tools.ts - Heterogeneous Tool Return Types

**Location:** `src/tools.ts:312-344`

**Problem:** The `read` tool returns different detail shapes based on file type:
- Image files: `{ path, encoding: 'base64', mime }`
- Binary files: `{ path, encoding: 'base64', bytes }`
- Text files: `{ path, encoding: 'utf8', bytes }`

```typescript
// Current workaround:
const read: AgentTool<typeof readSchema, any> = {
  // ...
  execute: wrapExecute<Static<typeof readSchema>, any>(
    'read',
    async (params): Promise<AgentToolResult<any>> => {
```

**Root cause:** `wrapExecute<T, D>` expects a single return type `D`, but `read` legitimately returns a union of result types.

**Proper fix options:**
1. Define a proper union type for read results:
   ```typescript
   type ReadDetails =
     | { path: string; encoding: 'base64'; mime: string }
     | { path: string; encoding: 'base64'; bytes: number }
     | { path: string; encoding: 'utf8'; bytes: number };
   ```
2. Refactor `wrapExecute` to support union return types
3. Consider if the tool should always return a consistent shape (add optional `mime?` and `bytes?` fields)

---

## 3. tools.ts - Heterogeneous Tool Array

**Location:** `src/tools.ts:399-400`

**Problem:** Returning an array of tools with different parameter schemas causes type incompatibility.

```typescript
// Current workaround:
return [bash, read, write, edit] as AgentTool<any, any>[];
```

**Root cause:** Each tool has a specific `TParameters` type (`typeof bashSchema`, `typeof readSchema`, etc.), but the array return type needs to be a common supertype.

**Proper fix options:**
1. Define `createBuiltinTools` return type explicitly:
   ```typescript
   export async function createBuiltinTools(ctx: ToolContext): Promise<AgentTool<TSchema, unknown>[]>
   ```
2. Use a base interface that all tool parameter schemas extend
3. Consider if `AgentTool` should use covariant/contravariant generics properly
4. Investigate if the pi-agent-core library expects tools to be typed this way

---

## Priority

1. **Low:** runner.ts provider types - Works fine at runtime, just cosmetic
2. **Medium:** tools.ts read result types - Could cause issues if code relies on specific detail shapes
3. **Low:** tools.ts tool array - Works fine, just loses type information for consumers

## Notes

These issues stem from TypeScript's strict structural typing clashing with runtime polymorphism patterns. The `any` casts are safe at runtime but lose compile-time type checking benefits.

Consider whether the upstream `pi-ai` and `pi-agent-core` libraries should expose more flexible types for integration use cases.
