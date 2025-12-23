# Repository Guidelines

## Project Structure & Module Organization
This is a Bun monorepo with workspaces under `packages/`. The primary CLI lives in `packages/karl/` (TypeScript source in `packages/karl/src/`, output in `packages/karl/dist/`, helper scripts in `packages/karl/scripts/`, and example skills in `packages/karl/examples/skills/`). The context intelligence CLI lives in `packages/ivo/` with its own `src/` and build output. Reference docs and specs are tracked in `ideas/`, `status/`, and `megamerge_docs/`.

## Build, Test, and Development Commands
- `bun install`: install dependencies.
- `bun run dev`: run the Karl CLI from `packages/karl/src/cli.ts`.
- `bun run build`: compile `packages/karl/src/cli.ts` to `packages/karl/dist/karl`.
- `bun run typecheck`: run TypeScript checks for `packages/karl`.
- `cd packages/ivo && bun run dev`: run the Ivo CLI locally.
- `cd packages/ivo && bun run build`: build Ivo into `packages/ivo/dist/`.
- `cd packages/karl && bun run test-skills`: exercise the Agent Skills loader and validation.

## Coding Style & Naming Conventions
TypeScript uses ESM modules and explicit `.js` import extensions (even in `.ts` files). Indentation is two spaces with semicolons and single quotes. File names are short and lowercase (e.g., `cli.ts`, `skills.ts`); keep new modules consistent. There is no formatter or linter configured, so follow the style in the nearest file.

## Testing Guidelines
There is no general unit test framework wired up yet. Validate changes with `bun run typecheck` and, for skill-related updates, `bun run test-skills`. If you introduce tests, prefer Bun’s test runner with `*.test.ts` files and document the new command in the relevant `package.json`.

## Commit & Pull Request Guidelines
Commit messages in history are short, imperative summaries (e.g., “Add …”, “Fix …”, “Update …”) without conventional-commit prefixes. PRs should include a concise description, testing notes (or “not run”), and links to any related issues. For CLI behavior changes, add a before/after output snippet.

## Configuration & Secrets
User config lives in `~/.config/karl/`, with project overrides in `./.karl/` (notably `./.karl/stacks/`). Do not commit API keys or personal configs; use environment variables or local config files instead.
