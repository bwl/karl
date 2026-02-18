/**
 * Strategy Registry — built-in + external plugin registration
 */

import type { StrategyPlugin } from './strategy.js';

const strategies = new Map<string, () => StrategyPlugin>();

export function registerStrategy(factory: () => StrategyPlugin): void {
  const instance = factory();
  strategies.set(instance.name, factory);
}

export function getStrategy(name: string): StrategyPlugin | undefined {
  const factory = strategies.get(name);
  return factory?.();
}

export function listStrategies(): string[] {
  return Array.from(strategies.keys());
}

/**
 * Load external strategy plugins from directories.
 * Each .ts/.js file must export a default factory function.
 */
export async function loadExternalStrategies(dirs: string[]): Promise<void> {
  for (const dir of dirs) {
    try {
      const { readdirSync } = await import('fs');
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.js')) continue;

        try {
          const { join } = await import('path');
          const fullPath = join(dir, entry.name);
          const mod = await import(fullPath);
          if (typeof mod.default === 'function') {
            registerStrategy(mod.default);
          }
        } catch {
          // Skip invalid plugins silently
        }
      }
    } catch {
      // Directory doesn't exist, skip
    }
  }
}
