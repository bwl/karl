# PROTOTYPE - Run Broker

Question: should `karl run` become a two-step broker where Karl interprets the
task, proposes a small set of execution options, then records the chosen route?

This prototype is throwaway. It models only the agent-facing decision state:
task interpretation, route options, explicit route selection, and a
receipt-shaped execution summary. It does not call models, create worktrees, or
run tools.

Run it with:

```bash
bun run prototype:run-broker -- plan --json "implement the verifier"
bun run prototype:run-broker -- execute --route coder --json "implement the verifier"
```

This is intentionally not a TUI. Karl's likely caller is another agent, so the
useful surface is deterministic text/JSON over stdin/stdout.
