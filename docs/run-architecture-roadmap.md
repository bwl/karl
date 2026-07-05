# Karl Run Architecture Roadmap

Status: planning
Last updated: 2026-07-05

This document captures the outstanding design plans from the July 2026 Karl
session. It is intentionally exploratory. The goal is to preserve the shape of
the ideas before they get flattened into small tickets.

Karl should stay slim, personal, and agent-friendly. The ambition here is not to
turn Karl into a universal agent framework. The ambition is to make Karl better
at deciding how a run should happen when providers, models, routers, skills,
context tools, and agent harnesses are all moving quickly.

## Current State

The current production surface is `karl route`:

- `karl route plan` interprets a task and returns a recommended route plus
  alternatives.
- `karl route select` materializes a selected route as text or JSON.
- The route set currently includes `coder`, `readonly`, `panel`, `cheap`,
  `bodyplan`, and `direct`.
- OpenRouter support exists as model/stack request passthrough, plus helpers for
  Fusion aliases.
- Route JSON exposes `tools.mode` and `tools.allowed`, so caller agents can see
  whether a route is no-tools, read-only, or read-write.
- Read-only repo review is now a first-class route, not a side effect of prompt
  wording.

This is useful, but it is still a route broker. It does not yet design a full
run architecture.

## North Star

Karl should answer a bigger question than "which model should I use?"

It should answer:

> What operating structure should this task use?

For a simple prompt, the answer may still be one call. For a serious codebase
task, the answer may be a small graph:

```json
{
  "kind": "karl.runArchitecture",
  "architecture": "evidence-led implementation",
  "nodes": [
    { "id": "evidence", "route": "readonly", "purpose": "map constraints" },
    { "id": "scope_gate", "type": "gate", "purpose": "accept or narrow scope" },
    { "id": "patch", "route": "coder", "purpose": "implement focused change" },
    { "id": "verify", "route": "direct", "purpose": "run checks and summarize risk" }
  ]
}
```

The run architect may use LLM judgment, but Karl must compile and enforce the
result. The LLM can propose a process; Karl owns policy.

## Design Principles

- Keep the first screen / first JSON response small.
- Prefer authored `.karl/` harness files and local config over remote catalogs.
- Use provider/router knobs through request passthrough rather than runtime
  branches whenever possible.
- Let the run architect propose, but let deterministic code validate.
- Treat external tools as evidence, not authority.
- Make every advanced path inspectable, reproducible, and easy to ignore.
- Add structure only when it removes burden from the caller agent.

## Outstanding Plans

### 1. Promote Route Plans Into Run Architectures

`karl route plan` should be able to emit a richer graph when asked, probably
behind a flag or versioned JSON kind before it becomes the default.

Possible surfaces:

```bash
karl route plan --json "implement the verifier"
karl route architect --json "implement the verifier"
karl architecture plan --json "implement the verifier"
```

The simple route response should remain available because caller agents often
need a fast answer.

The architecture response should include:

- visible recommendation
- graph nodes
- dependencies
- gates
- tool policy
- worktree policy
- budget hints
- context requirements
- validation expectations
- residual risk

### 2. Add A Capability Snapshot

The architecture planner needs a compact view of Karl's actual capabilities in
the current project.

Inputs should include:

- configured providers
- configured model aliases
- OpenRouter availability
- model request passthrough features
- stacks and stack tools
- skills and project skills
- `.karl/agent.md`, `.karl/context.md`, `.karl/worktree.md`
- current git branch and dirty state
- available route kinds
- Ivo availability and saved packs
- recent Karl receipts/history
- project policy and authored harness files

This should be data, not prose. The architect can receive a summarized form, but
Karl should keep the raw snapshot inspectable.

### 3. Use Body Builder As A Specialist, Not The Brain

OpenRouter Body Builder is useful because it can generate OpenRouter-compatible
request bodies from natural language and can select current model slugs. It
should not become Karl's entire planner.

Better role:

- Karl does local policy interpretation first.
- If the task benefits from OpenRouter-side experiment design, Karl asks
  `openrouter/bodybuilder` to propose request bodies.
- Karl maps those bodies back into route or architecture nodes.
- Karl validates anything Body Builder suggests before exposing it as runnable.

Body Builder is especially promising for:

- multi-model comparisons
- benchmark plans
- "try this with a few model families"
- discovering current OpenRouter model slugs
- generating variants for a panel or experiment

It is less appropriate for:

- deciding whether local filesystem writes are allowed
- worktree safety
- repo context sufficiency
- user approval gates
- project-specific `.karl/` policy

### 4. Add A Small Architecture Classifier Call

The regex parser should become the fallback and safety net, not the main source
of nuance.

A classifier/planner call could classify:

- intent: code, review, compare, ideation, experiment, release, incident, docs
- locality: no-tools, remote-only, local-readonly, local-readwrite
- risk: low, medium, high
- context need: none, light, Ivo pack, deep Ivo pack, human clarification
- process pattern: direct answer, evidence audit, panel, implementation, release
  gate, incident review, benchmark
- likely loops: inspect -> implement -> verify, panel -> choose -> code, etc.

Failure behavior matters:

- invalid JSON falls back to deterministic parser
- unavailable model falls back to deterministic parser
- planner confidence below threshold falls back or asks for a gate
- read-only/write constraints are enforced after the LLM response

### 5. Build A Compiler And Policy Validator

The run architect should not be trusted to execute directly.

Karl needs a compiler that turns proposed architecture JSON into validated
routes or execution nodes.

Compiler checks should include:

- route names exist
- dependency graph has no cycles
- read-only nodes omit write/edit tools
- no-tools nodes omit local tools
- read-write nodes respect worktree policy
- high-risk nodes have verification or a gate
- OpenRouter routes require configured/authenticated OpenRouter
- direct routes require a default model
- budgets are numeric and within local policy
- no node can secretly escalate from analysis to mutation

This is the important Kingdom lesson: the model proposes; the runtime enforces.

### 6. Introduce Process Recipes

Karl should have reusable run architecture recipes. These should be small,
auditable patterns rather than giant workflow engines.

Candidate recipes:

- `direct-answer`: one no-tools or default call
- `cheap-sketch`: low-cost ideation
- `evidence-audit`: local read-only repo review
- `evidence-led-patch`: read-only audit -> implementation -> verification
- `panel-decision`: Fusion/panel -> decision summary
- `bodybuilder-experiment`: Body Builder -> candidate request bodies -> compare
- `release-gate`: status/diff -> checks -> commit/push/release notes
- `incident-review`: collect evidence -> timeline -> risks -> remediation plan
- `staff-memo`: evidence -> options -> recommendation -> open questions
- `red-team`: proposal -> critique -> revision

The business/process vocabulary should be explicit. Karl should not reinvent
"staff memo", "release gate", or "incident review" from scratch every time.

### 7. Ivo Context Gate

Ivo should become the context quality gate for non-trivial repo work.

Possible rule:

- simple prompt: no Ivo
- explicit file or tiny diff: light Ivo or targeted file evidence
- read-only review: Ivo context pack recommended
- implementation across unknown code: Ivo context pack required before coder
- architecture/deep planning: deep Ivo pack recommended

The route architecture should reference context packs by ID, not copy huge
context blobs into every response.

Example:

```json
{
  "context": {
    "provider": "ivo",
    "packId": "feab81b",
    "files": 41,
    "tokens": 11994,
    "sufficientFor": ["readonly", "coder"]
  }
}
```

This mirrors Kingdom's "Ivo constructs the context pack before Crown" gate, but
with a much smaller Karl surface.

### 8. Mine RepoPrompt CE For Ivo Techniques

RepoPrompt CE is a goldmine for context engineering. Ivo should learn every
applicable technique without becoming a clone.

Technique areas to study:

- CodeMap density and presentation
- line slices and selected ranges
- file tree summarization
- Git diff context
- agentic context builder loops
- multi-root workspaces
- reviewable handoffs
- MCP/CLI context surfaces
- worktree-aware context
- token budgeting and context UX
- provider/plugin boundaries for agent harnesses

Suggested future deliverable:

```text
RepoPrompt technique -> Ivo current capability -> gap -> Karl relevance -> minimal slice
```

This should be a deliberate mining project, not a quick copy pass.

### 9. Import Kingdom's Useful Ideas Without The Palace

Kingdom is the maximalist ancestor for the run architecture idea.

Ideas worth importing:

- visible artifact vs hidden process
- Presentation before Crown
- Decree as machine-readable DAG
- approval gates
- context quality gates
- policy validation
- execution waves
- progress/status grounded in the DAG
- durable outcomes and receipts
- project-native Markdown memory
- "evidence, not authority" treatment for maps/context

Ideas to avoid importing wholesale:

- heavy royal terminology in Karl's public CLI
- mandatory giant plans for small tasks
- side services
- broad runtime framework shape
- making the user approve every little internal move

Karl can inherit the skeleton: context -> plan -> gates -> execution -> receipt.
It should not inherit all the ceremony.

### 10. Make Read-Only Review A Serious Path

Morley CoS identified the first real broker failure: "do not edit files" was
misclassified because the parser saw "edit".

The `readonly` route fixes the immediate bug, but there is a larger plan:

- read-only repo evidence audits should be common, not exceptional
- caller agents should not have to override for evidence review
- route JSON should make tool policy impossible to miss
- the executor should eventually enforce read-only mode, not merely describe it
- git status should be checked before and after read-only work

This route is important because many agents need Karl to inspect a repo without
changing it.

### 11. Add Explain And Explore Surfaces

Agents often need to know why Karl chose a route or what alternatives exist.

Possible additions:

```bash
karl route explain --json "..."
karl route options --json "..."
karl route explore --route panel --json "..."
```

Borrow the Kingdom Study tough-question pattern:

- initial plan stays compact
- route questions can be expanded on demand
- alternatives are generated only when requested
- selected answers or constraints are compiled back into the architecture

### 12. Close The Loop With Receipts

Karl already has receipts/history work. The run architect should use that as
feedback.

Track:

- selected route/architecture
- whether the caller overrode it
- tools actually used
- files changed
- verification commands
- failure mode
- cost/tokens
- whether a follow-up was needed

Eventually Karl can learn project-local preferences without becoming a remote
analytics product.

### 13. Provider And Model Landscape Awareness

Karl should be lazily compatible with providers and models.

That means:

- use raw model IDs when provider protocol supports them
- keep request passthrough flexible
- avoid maintaining a universal catalog
- use OpenRouter routers for model selection when helpful
- sync/browse models only when explicitly useful
- let local stacks and project policy override generic recommendations

Provider knowledge belongs in compatibility shims and request bodies, not in
giant hardcoded switch statements.

### 14. Execution Graphs, Loops, And Gates

The future architecture graph should support:

- serial nodes
- parallel nodes
- human or agent gates
- retry loops
- verification gates
- escalation from cheap to strong
- early exit when evidence is sufficient
- "stop and report" blockers

This does not require a huge executor immediately. The first version can emit
the graph without running it. Execution can arrive node by node.

### 15. Agent-Facing JSON Stability

Most Karl route users will be agents. JSON should be the product surface.

Priorities:

- stable `kind` and `version`
- stable route IDs/names
- explicit tool policy
- explicit availability requirements
- machine-readable reasons and risks
- argv arrays, not shell strings
- enough provenance to debug route choice

Human text output can stay friendly and compact.

## Suggested Implementation Order

### Phase 1: Make The Current Broker More Honest

- Add architecture vocabulary to docs.
- Add route explanation reasons in JSON.
- Expand read-only tests/smokes.
- Add `--no-classifier` or equivalent only once classifier exists.
- Keep deterministic parser as fallback.

### Phase 2: Capability Snapshot

- Implement `buildCapabilitySnapshot(cwd)`.
- Include providers, models, stacks, tools, skills, git status, `.karl/` harness,
  and OpenRouter readiness.
- Add `karl route capabilities --json` for inspection.

### Phase 3: Architecture Schema

- Define `karl.runArchitecture` v1.
- Add graph nodes, gates, policies, context requirements, and validation.
- Emit architecture plans without executing them.

### Phase 4: Planner Call

- Add optional no-tools planner/classifier call.
- Feed it task + capability snapshot + recipe catalog.
- Validate and compile output.
- Fall back to deterministic parser on failure.

### Phase 5: Body Builder Integration

- Add an internal Body Builder call for OpenRouter experiment nodes.
- Parse generated request bodies.
- Map them into validated architecture nodes.
- Keep local policy outside Body Builder.

### Phase 6: Ivo Gate

- Let architecture planner request an Ivo pack.
- Add Ivo pack references to architecture JSON.
- Use Ivo context sufficiency as a gate for high-risk local repo tasks.

### Phase 7: Execution

- Execute only safe graph subsets at first.
- Start with readonly -> report and direct -> report.
- Add coder/worktree execution later.
- Add receipt comparison and after-action status.

## Non-Goals

- Do not make Karl universal.
- Do not vendor a giant agent runtime.
- Do not force multi-step architecture for simple prompts.
- Do not hide policy decisions inside an LLM response.
- Do not require OpenRouter for local/direct Karl use.
- Do not make Ivo a GUI clone of RepoPrompt.
- Do not make the user learn OpenRouter router trivia.

## Open Questions

- Should `karl route plan` grow into architecture output, or should
  `karl architecture` be separate?
- What is the smallest useful `runArchitecture` schema?
- Should architecture recipes live in `.karl/architectures/*.json`?
- How much context should the planner receive before it asks Ivo for a pack?
- Which model should be the default planner?
- Should Body Builder be called during planning by default, or only for explicit
  experiment/model-selection tasks?
- How do we prevent route planning from adding too much latency?
- What is the right "approval gate" shape for caller agents rather than humans?
- Should receipts become training examples for local project routing?

## Working Glossary

- **route**: one execution posture, such as `readonly`, `coder`, or `panel`.
- **run architecture**: a graph of routes, gates, loops, and validation nodes.
- **capability snapshot**: the current project's providers, models, stacks,
  skills, tools, policy, and context state.
- **compiler**: deterministic code that validates and materializes an LLM
  proposed architecture.
- **recipe**: a reusable operating structure such as evidence-led patch or
  incident review.
- **context gate**: a requirement that sufficient context exists before a route
  can run.
- **receipt**: durable record of what was planned, what ran, and what happened.

