/**
 * Tree-sitter Parser Module
 *
 * Uses native tree-sitter bindings for codemap extraction.
 * Native bindings are faster and more reliable than WASM.
 */

import Parser from 'tree-sitter';
import { join, dirname } from 'path';

// Supported languages and their npm package names
export type SupportedLanguage =
  | 'typescript'
  | 'tsx'
  | 'javascript'
  | 'rust'
  | 'python'
  | 'go'
  | 'markdown';

// Map of language to loaded grammar
const loadedLanguages: Map<SupportedLanguage, unknown> = new Map();

// Shared parser instance
let parserInstance: Parser | null = null;

// File extension to language mapping
const EXTENSION_LANGUAGE_MAP: Record<string, SupportedLanguage> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.rs': 'rust',
  '.py': 'python',
  '.go': 'go',
  '.md': 'markdown',
};

/**
 * Get or create the parser instance
 */
function getParserInstance(): Parser {
  if (!parserInstance) {
    parserInstance = new Parser();
  }
  return parserInstance;
}

/**
 * Load a language grammar from its npm package
 */
export async function loadLanguage(lang: SupportedLanguage): Promise<unknown> {
  // Return cached language if already loaded
  if (loadedLanguages.has(lang)) {
    return loadedLanguages.get(lang)!;
  }

  let language: unknown;

  switch (lang) {
    case 'typescript':
      // tree-sitter-typescript exports both typescript and tsx
      const tsPackage = await import('tree-sitter-typescript');
      language = tsPackage.default?.typescript ?? tsPackage.typescript;
      break;

    case 'tsx':
      const tsxPackage = await import('tree-sitter-typescript');
      language = tsxPackage.default?.tsx ?? tsxPackage.tsx;
      break;

    case 'javascript':
      const jsPackage = await import('tree-sitter-javascript');
      language = jsPackage.default ?? jsPackage;
      break;

    case 'rust':
      const rustPackage = await import('tree-sitter-rust');
      language = rustPackage.default ?? rustPackage;
      break;

    case 'python':
      const pyPackage = await import('tree-sitter-python');
      language = pyPackage.default ?? pyPackage;
      break;

    case 'go':
      const goPackage = await import('tree-sitter-go');
      language = goPackage.default ?? goPackage;
      break;

    default:
      throw new Error(`Unsupported language: ${lang}`);
  }

  loadedLanguages.set(lang, language);
  return language;
}

/**
 * Get a parser configured for a specific language
 */
export async function getParser(lang: SupportedLanguage): Promise<Parser> {
  const parser = getParserInstance();
  const language = await loadLanguage(lang);
  parser.setLanguage(language as Parser.Language);
  return parser;
}

/**
 * Detect language from file extension
 */
export function detectLanguage(filePath: string): SupportedLanguage | null {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return EXTENSION_LANGUAGE_MAP[ext] || null;
}

/**
 * Check if a language is supported
 */
export function isLanguageSupported(lang: string): lang is SupportedLanguage {
  return ['typescript', 'tsx', 'javascript', 'rust', 'python', 'go', 'markdown'].includes(lang);
}

/**
 * Get list of supported languages
 */
export function getSupportedLanguages(): SupportedLanguage[] {
  return ['typescript', 'tsx', 'javascript', 'rust', 'python', 'go', 'markdown'];
}

/**
 * Get list of supported file extensions
 */
export function getSupportedExtensions(): string[] {
  return Object.keys(EXTENSION_LANGUAGE_MAP);
}

// Re-export Parser type for use in other modules
export type { Parser };

// Export tree node types
export type SyntaxNode = Parser.SyntaxNode;
export type Tree = Parser.Tree;
