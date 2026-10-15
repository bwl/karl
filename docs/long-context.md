# Long-context runs

Karl reads explicit text files and stdin in full, without a local input-token
cap, truncation, or automatic summarization. The provider enforces its actual
context window, including instructions, input, and output. Text context does
not extract PDF, image, or office-document contents; convert those to text first.

## Gemini 4 Argon on OpenRouter

Configure an `openrouter` provider with your API key, then add a model alias:

```bash
karl models add argon --provider openrouter --model google/gemini-4-argon
```

This keeps your existing default model. To use a raw ID explicitly, pass both
`--provider openrouter` and `--model google/gemini-4-argon`. A raw ID without
`--provider` uses your default model's provider, but does not inherit that
other model's token limits or request settings.

As of October 15, 2026, OpenRouter lists a 1,048,576-token context window for
[Gemini 4 Argon](https://openrouter.ai/google/gemini-4-argon). Its
[migration guide](https://openrouter.ai/docs/cookbook/evaluate-and-optimize/model-migrations/gemini-4)
describes long decode using continuation tokens. Reasoning effort accepts
`low`, `medium`, or `high`; a separate reasoning-token budget is unsupported.

```bash
karl run --model argon --no-tools --reasoning-effort high \
  --max-tokens 262144 --timeout 2h \
  --context-file context.txt \
  "Read the entire context. Write a detailed analysis with evidence, contradictions, conclusions, and recommendations." \
  > answer.md
```

The output budget includes reasoning, so 262,144 is a ceiling rather than a
target answer length. Karl keeps that ceiling unchanged between continuation
requests and combines the answer and usage across them. It never raises the
budget automatically. Each continuation is billed separately, including its
input; total input usage is billing usage, not the size of the original context.

`--timeout 2h` applies to the whole task attempt, including continuations and
tools. `--timeout 0` disables Karl's deadline. Without a stack timeout or this
flag, Karl has no task deadline. Provider/network limits can still apply.
Timeouts and incomplete streamed answers are not automatically replayed.

## Reusable deep-read command

Copy the example stack into your global configuration after adding `argon`:

```bash
mkdir -p ~/.config/karl/stacks
cp packages/karl/examples/stacks/deep-read.json ~/.config/karl/stacks/deep-read.json
karl deep-read --context-file context.txt "Evaluate the proposal in detail." > answer.md
```

The profile uses high reasoning effort, a 262,144-token output budget, a
two-hour deadline, and no local tools. It asks for a substantive answer grounded
in the supplied sources. CLI flags override the profile, for example
`--max-tokens 131072` or `--timeout 0`.

## Input options

All of these preserve the supplied text, apart from trimming outer whitespace:

```bash
# File as context; task stays separate.
karl deep-read --context-file context.txt "Analyze this."

# Piped text is context when a task is also supplied.
cat context.txt | karl deep-read "Analyze this."

# Explicit stdin context.
cat context.txt | karl deep-read --context-file - "Analyze this."

# Stdin can also supply the whole task, including its context.
cat prompt-and-context.txt | karl deep-read -
```

A missing/unreadable context file or empty explicit stdin context fails before
inference. Karl still loads the normal project instructions from the working
directory. Use `--dry-run` to inspect the selected provider, model, budget,
deadline, and context file without calling the model.

## Background runs and results

```bash
cat context.txt | karl deep-read --background "Analyze this in detail."
karl status <job-id>
karl logs <job-id> --tail
karl logs <job-id> > answer.md
```

Background stdin is saved inside `.karl/jobs/<job-id>/stdin.txt`, with the output
in `output.log`. The worker records completion after the launching process has
exited. The computer must remain awake for a local job to run.

Use `--json` to capture status, answer, token usage, duration, and history ID in
one machine-readable result. An output-limit stop, interrupted stream, or
provider error exits nonzero; any available answer is marked incomplete and
retained in the result/history. A failed run is not automatically resumed from
an encrypted checkpoint. Successful continuation within an active run is
automatic, bounded to 32 hops, and uses the same request and token budget.

## Behavior change

Before, `cat context.txt | karl run "analyze this"` ignored the piped context,
and a length-limited response could be reported as successful. Now the context
is included and unfinished responses are explicit failures:

```text
Error: Response reached its output limit before completing. Increase --max-tokens and run again.

Partial answer (incomplete):
<available text>
```

## Verification

`bun run --cwd packages/karl test:long-context` runs local HTTP and CLI tests
covering input over 1 MB, large opaque checkpoints, multiple continuation hops,
usage aggregation, tool signatures, streaming errors, deadlines, and detached
stdin. These tests make no paid model calls. The suite is also included in
`bun run check`.
