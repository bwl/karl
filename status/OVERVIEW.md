# Karl Present State - Overview

This document provides an inventory of Karl's current architecture, capabilities, and development status.

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture](#architecture)
3. [Developer Experience & Branding](#developer-experience--branding)
4. [Build & Quality](#build--quality)

---

## Project Overview

### PROJECT_SUMMARY.md
High-level project overview: TypeScript CLI, Bun runtime, active development, key dependencies.

---

## Architecture

### CLI_ARCHITECTURE.md
Core execution engine in `packages/karl/src/`: cli.ts, runner.ts, scheduler.ts, tools.ts, state.ts.

### CLI_COMMANDS.md
Interactive CLI wizards in `packages/karl/src/commands/`: init, providers, models, stacks, skills.

### CONFIGURATION_SYSTEM.md
Config loading, stacks, providers, models, precedence rules, environment variable expansion.

### EXTENSIBILITY.md
Agent Skills standard implementation, hooks system, custom tools, extension points.

---

## Developer Experience & Branding

### DEVELOPER_EXPERIENCE.md
CLI commands inventory, flags, help text quality, error messages, documentation coverage.

### BRANDING_AUDIT.md
Tennis theme implementation, visual identity, messaging patterns, output formatting.

---

## Build & Quality

### BUILD_AND_DEPLOYMENT.md
Monorepo structure, Bun commands, dependencies, packaging.

### CODE_QUALITY.md
Testing coverage, type safety, patterns, documentation gaps.

### TECHNICAL_DEBT.md
Known issues, open questions, refactoring opportunities.

---

## Quick Reference

| Document | Focus | Key Area |
|----------|-------|----------|
| PROJECT_SUMMARY | Overview | Tech stack, entry points |
| CLI_ARCHITECTURE | Core | Execution engine |
| CLI_COMMANDS | Wizards | Interactive commands |
| CONFIGURATION_SYSTEM | Config | Stacks, providers, models |
| EXTENSIBILITY | Plugins | Skills, hooks, tools |
| DEVELOPER_EXPERIENCE | UX | Commands, help, errors |
| BRANDING_AUDIT | Identity | Tennis theme, messaging |
| BUILD_AND_DEPLOYMENT | DevOps | Build, deps, packaging |
| CODE_QUALITY | Quality | Tests, types, patterns |
| TECHNICAL_DEBT | Debt | Issues, gaps, TODOs |
