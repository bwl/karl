/**
 * Built-in Strategy Registration
 *
 * Imports all built-in strategies and registers them with the registry.
 */

import { registerStrategy } from '../registry.js';

import explicit from './explicit.js';
import skeleton from './skeleton.js';
import keyword from './keyword.js';
import symbols from './symbols.js';
import ast from './ast.js';
import config from './config.js';
import diff from './diff.js';
import graph from './graph.js';
import semantic from './semantic.js';
import complexity from './complexity.js';
import docs from './docs.js';
import forest from './forest.js';
import inventory from './inventory.js';

export function registerBuiltinStrategies(): void {
  registerStrategy(explicit);
  registerStrategy(skeleton);
  registerStrategy(keyword);
  registerStrategy(symbols);
  registerStrategy(ast);
  registerStrategy(config);
  registerStrategy(diff);
  registerStrategy(graph);
  registerStrategy(semantic);
  registerStrategy(complexity);
  registerStrategy(docs);
  registerStrategy(forest);
  registerStrategy(inventory);
}
