/**
 * Config Stack management for Karl
 *
 * Stacks are named configurations that bundle model, temperature, timeout,
 * token limits, and skills for reusable CLI profiles.
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import type { StackConfig, KarlConfig, CliOptions } from './types';

export class StackManager {
  private stacksCache = new Map<string, StackConfig>();
  private readonly stacksPaths: string[];
  private readonly inlineStacks: Record<string, StackConfig>;

  constructor(config: KarlConfig, customPaths: string[] = []) {
    this.inlineStacks = config.stacks || {};
    this.stacksPaths = [
      // Standard paths
      join(homedir(), '.config', 'karl', 'stacks'),
      join(process.cwd(), '.karl', 'stacks'),
      // Custom paths
      ...customPaths
    ];
  }

  /**
   * Load all available stacks from configured paths and inline config
   */
  async loadAvailableStacks(): Promise<Map<string, StackConfig>> {
    const stacks = new Map<string, StackConfig>();

    // Load inline stacks first
    for (const [name, stack] of Object.entries(this.inlineStacks)) {
      stacks.set(name, { ...stack, name });
    }

    // Load from directories (overrides inline)
    for (const stacksPath of this.stacksPaths) {
      if (!existsSync(stacksPath)) continue;

      try {
        const entries = readdirSync(stacksPath, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.json')) continue;

          const stackPath = join(stacksPath, entry.name);
          const stackName = basename(entry.name, '.json');

          try {
            const stack = this.loadStackFromFile(stackPath);
            stacks.set(stackName, { ...stack, name: stackName });
          } catch (error) {
            console.warn(`Failed to load stack ${stackName}:`, error);
          }
        }
      } catch (error) {
        console.warn(`Failed to read stacks directory ${stacksPath}:`, error);
      }
    }

    this.stacksCache = stacks;
    return stacks;
  }

  /**
   * Load a specific stack by name
   */
  async getStack(name: string): Promise<StackConfig | null> {
    // Check cache first
    if (this.stacksCache.has(name)) {
      return this.resolveInheritance(this.stacksCache.get(name)!);
    }

    // Check inline stacks
    if (this.inlineStacks[name]) {
      const stack = { ...this.inlineStacks[name], name };
      this.stacksCache.set(name, stack);
      return this.resolveInheritance(stack);
    }

    // Search in directories
    for (const stacksPath of this.stacksPaths) {
      const stackPath = join(stacksPath, `${name}.json`);

      if (existsSync(stackPath)) {
        try {
          const stack = this.loadStackFromFile(stackPath);
          this.stacksCache.set(name, { ...stack, name });
          return this.resolveInheritance({ ...stack, name });
        } catch (error) {
          console.warn(`Failed to load stack ${name}:`, error);
        }
      }
    }

    return null;
  }

  /**
   * Load stack from a JSON file
   */
  private loadStackFromFile(stackPath: string): StackConfig {
    const content = readFileSync(stackPath, 'utf-8');
    const stack = JSON.parse(content) as StackConfig;

    // Validate required structure
    if (typeof stack !== 'object' || stack === null) {
      throw new Error('Stack must be a JSON object');
    }

    return stack;
  }

  /**
   * Resolve inheritance chain for a stack
   */
  private async resolveInheritance(
    stack: StackConfig,
    visited: Set<string> = new Set()
  ): Promise<StackConfig> {
    if (!stack.extends) {
      return stack;
    }

    const stackName = stack.name || 'unknown';

    // Detect cycles
    if (visited.has(stackName)) {
      throw new Error(`Circular inheritance detected: ${Array.from(visited).join(' -> ')} -> ${stackName}`);
    }
    visited.add(stackName);

    // Load parent stack
    const parent = await this.getStackRaw(stack.extends);
    if (!parent) {
      throw new Error(`Parent stack "${stack.extends}" not found for "${stackName}"`);
    }

    // Resolve parent's inheritance first
    const resolvedParent = await this.resolveInheritance(parent, visited);

    // Merge: child overrides parent
    const { extends: _, ...childWithoutExtends } = stack;
    return {
      ...resolvedParent,
      ...childWithoutExtends,
      name: stackName
    };
  }

  /**
   * Get raw stack without resolving inheritance (for internal use)
   */
  private async getStackRaw(name: string): Promise<StackConfig | null> {
    // Check inline stacks
    if (this.inlineStacks[name]) {
      return { ...this.inlineStacks[name], name };
    }

    // Search in directories
    for (const stacksPath of this.stacksPaths) {
      const stackPath = join(stacksPath, `${name}.json`);

      if (existsSync(stackPath)) {
        try {
          const stack = this.loadStackFromFile(stackPath);
          return { ...stack, name };
        } catch {
          // Continue searching
        }
      }
    }

    return null;
  }

  /**
   * Merge stack config with CLI options (CLI options take precedence)
   */
  mergeWithOptions(stack: StackConfig, options: CliOptions): CliOptions {
    return {
      // Stack provides defaults
      model: stack.model,
      skill: stack.skill,
      context: stack.context,
      contextFile: stack.contextFile,
      unrestricted: stack.unrestricted,
      timeoutMs: stack.timeout,
      temperature: stack.temperature,
      maxTokens: stack.maxTokens,
      // CLI options override
      ...Object.fromEntries(
        Object.entries(options).filter(([_, v]) => v !== undefined)
      )
    } as CliOptions;
  }

  /**
   * List available stacks with metadata
   */
  async listStacks(): Promise<Array<{ name: string; model?: string; skill?: string; extends?: string; path?: string }>> {
    await this.loadAvailableStacks();

    const result: Array<{ name: string; model?: string; skill?: string; extends?: string; path?: string }> = [];

    // Add inline stacks
    for (const [name, stack] of Object.entries(this.inlineStacks)) {
      result.push({
        name,
        model: stack.model,
        skill: stack.skill,
        extends: stack.extends,
        path: 'inline'
      });
    }

    // Add directory stacks
    for (const stacksPath of this.stacksPaths) {
      if (!existsSync(stacksPath)) continue;

      try {
        const entries = readdirSync(stacksPath, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.json')) continue;

          const stackName = basename(entry.name, '.json');
          const stackPath = join(stacksPath, entry.name);

          // Skip if already in result (inline takes precedence for display)
          if (result.some(s => s.name === stackName)) continue;

          try {
            const stack = this.loadStackFromFile(stackPath);
            result.push({
              name: stackName,
              model: stack.model,
              skill: stack.skill,
              extends: stack.extends,
              path: stackPath
            });
          } catch {
            // Skip invalid stacks
          }
        }
      } catch {
        // Skip unreadable directories
      }
    }

    return result.sort((a, b) => a.name.localeCompare(b.name));
  }
}

/**
 * Default stack manager instance (created on demand with config)
 */
let defaultManager: StackManager | null = null;

export function getStackManager(config: KarlConfig): StackManager {
  if (!defaultManager) {
    defaultManager = new StackManager(config);
  }
  return defaultManager;
}

/**
 * Load a stack by name and return merged options
 */
export async function loadStack(
  stackName: string,
  config: KarlConfig,
  cliOptions: CliOptions
): Promise<CliOptions> {
  const manager = new StackManager(config);
  const stack = await manager.getStack(stackName);

  if (!stack) {
    throw new Error(`Stack "${stackName}" not found`);
  }

  return manager.mergeWithOptions(stack, cliOptions);
}
