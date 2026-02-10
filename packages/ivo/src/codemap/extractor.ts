/**
 * Codemap Extractor
 *
 * Uses tree-sitter to parse source files and extract code structure
 * (functions, classes, types, imports) into CodeMap format.
 */

import { readFile } from 'fs/promises';
import { spawn } from 'child_process';
import Parser from 'tree-sitter';
import type { CodeMap, ClassInfo, FunctionInfo, TypeInfo, SectionInfo } from '../types.js';
import { getParser, detectLanguage, loadLanguage, type SupportedLanguage, type SyntaxNode, type Tree } from './parser.js';
import { getQueryForLanguage } from './queries.js';

// Query match type from tree-sitter
interface QueryMatch {
  pattern: number;
  captures: Array<{ name: string; node: SyntaxNode }>;
}

interface ExtractedItem {
  type: string;
  name: string;
  startLine: number;
  endLine: number;
  signature?: string;
  isAsync?: boolean;
  parent?: string;
}

/**
 * Extract codemap from a source file
 */
export async function extractCodemap(filePath: string, content?: string): Promise<CodeMap | null> {
  // Detect language from file extension
  const language = detectLanguage(filePath);
  if (!language) {
    return null;
  }

  // Markdown uses mq instead of tree-sitter
  if (language === 'markdown') {
    return extractMarkdownCodemap(filePath, content);
  }

  // Read content if not provided
  const source = content ?? (await readFile(filePath, 'utf-8'));

  // Get parser for the language
  const parser = await getParser(language);

  // Parse the source code
  const tree = parser.parse(source);

  // Extract items from the tree
  const items = await extractItems(tree, language, source);

  // Build the codemap
  return buildCodemap(filePath, language, items, source);
}

// ============================================================================
// Markdown codemap via mq
// ============================================================================

/** Cache whether mq is available on PATH (null = not checked yet) */
let mqAvailable: boolean | null = null;

function runMq(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('mq', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
    proc.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `mq exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

async function isMqAvailable(): Promise<boolean> {
  if (mqAvailable !== null) return mqAvailable;
  try {
    await runMq(['--version']);
    mqAvailable = true;
  } catch {
    mqAvailable = false;
  }
  return mqAvailable;
}

interface MqHeading {
  type: 'Heading';
  depth: number;
  values: Array<{ type: string; value?: string }>;
}

interface MqCode {
  type: 'Code';
  value: string;
  lang: string | null;
}

interface MqYaml {
  type: 'Yaml';
  value: string;
}

/**
 * Extract codemap from a markdown file using mq
 */
async function extractMarkdownCodemap(filePath: string, _content?: string): Promise<CodeMap | null> {
  if (!(await isMqAvailable())) return null;

  try {
    // Run 3 mq queries in parallel
    const [headingsRaw, frontmatterRaw, codeBlocksRaw] = await Promise.all([
      runMq(['select(is_h(.))', filePath, '-F', 'json']).catch(() => '[]'),
      runMq(['select(is_yaml(.))', filePath, '-F', 'json']).catch(() => '[]'),
      runMq(['select(is_code(.))', filePath, '-F', 'json']).catch(() => '[]'),
    ]);

    // Parse headings
    const sections: SectionInfo[] = [];
    try {
      const headings: unknown[] = JSON.parse(headingsRaw);
      for (const h of headings) {
        const heading = h as MqHeading;
        if (heading.type !== 'Heading') continue;
        const title = heading.values
          ?.filter((v) => v.value)
          .map((v) => v.value)
          .join('') ?? '';
        if (title) {
          sections.push({ depth: heading.depth, title });
        }
      }
    } catch { /* malformed JSON — skip headings */ }

    // Parse frontmatter
    const frontmatter: string[] = [];
    try {
      const yamls: unknown[] = JSON.parse(frontmatterRaw);
      for (const y of yamls) {
        const yaml = y as MqYaml;
        if (yaml.type !== 'Yaml' || !yaml.value) continue;
        const keys = yaml.value
          .split('\n')
          .map((line) => line.match(/^([a-zA-Z_][\w-]*):/)?.[1])
          .filter(Boolean) as string[];
        frontmatter.push(...keys);
      }
    } catch { /* malformed JSON — skip frontmatter */ }

    // Parse code blocks
    let codeBlockCount = 0;
    const codeBlockLangs = new Set<string>();
    try {
      const blocks: unknown[] = JSON.parse(codeBlocksRaw);
      for (const b of blocks) {
        const block = b as MqCode;
        if (block.type !== 'Code') continue;
        codeBlockCount++;
        if (block.lang) codeBlockLangs.add(block.lang);
      }
    } catch { /* malformed JSON — skip code blocks */ }

    return {
      path: filePath,
      language: 'markdown',
      exports: [],
      classes: [],
      functions: [],
      types: [],
      dependencies: [],
      sections,
      frontmatter: frontmatter.length > 0 ? frontmatter : undefined,
      codeBlocks: codeBlockCount > 0
        ? { count: codeBlockCount, languages: [...codeBlockLangs] }
        : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Extract items from the syntax tree using queries
 */
async function extractItems(
  tree: Tree,
  language: SupportedLanguage,
  source: string
): Promise<ExtractedItem[]> {
  const items: ExtractedItem[] = [];

  // Get the query string for this language
  const queryString = getQueryForLanguage(language);

  // Load the language to create the query
  const lang = await loadLanguage(language);

  try {
    // Create and run the query using Parser.Query constructor
    const query = new Parser.Query(lang as Parser.Language, queryString);
    const matches = query.matches(tree.rootNode) as QueryMatch[];

    for (const match of matches) {
      const item = processMatch(match, source, language);
      if (item) {
        items.push(item);
      }
    }
  } catch (error) {
    // Query might fail for some languages/patterns - continue with basic extraction
    console.warn(`Query failed for ${language}, falling back to basic extraction:`, error);
    return extractItemsBasic(tree.rootNode, source);
  }

  return items;
}

/**
 * Process a query match into an ExtractedItem
 */
function processMatch(
  match: QueryMatch,
  source: string,
  language: SupportedLanguage
): ExtractedItem | null {
  // Find the definition capture (the main node) - can be @xxx.def or just @xxx
  const defCapture = match.captures.find((c) => c.name.endsWith('.def'));
  const nameCapture = match.captures.find((c) => c.name.endsWith('.name'));

  // Handle captures that don't use .def suffix (like @import, @export)
  const simpleCapture = !defCapture ? match.captures[0] : null;
  const mainCapture = defCapture || simpleCapture;

  if (!mainCapture) return null;

  const node = mainCapture.node;
  const name = nameCapture?.node.text ?? node.text;

  // Determine the type from capture name
  let type = defCapture
    ? defCapture.name.split('.')[0] // e.g., 'function' from 'function.def'
    : mainCapture.name; // e.g., 'import' from '@import'

  const isAsync = source.slice(node.startIndex, node.startIndex + 50).includes('async ');

  // Get signature for functions/methods
  let signature = nameCapture?.node.text ?? '';
  if (type === 'function' || type === 'method' || type === 'async_function') {
    signature = extractSignature(node, source, language);
    if (type === 'async_function') type = 'function';
  }

  return {
    type,
    name,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    signature,
    isAsync,
  };
}

/**
 * Extract function signature from a node
 */
function extractSignature(node: SyntaxNode, source: string, language: SupportedLanguage): string {
  // Get the first line of the definition
  const startIdx = node.startIndex;
  let endIdx = source.indexOf('\n', startIdx);
  if (endIdx === -1) endIdx = source.length;

  let firstLine = source.slice(startIdx, endIdx).trim();

  // Clean up the signature based on language
  switch (language) {
    case 'typescript':
    case 'tsx':
    case 'javascript':
      // Remove body if on same line
      if (firstLine.includes('{')) {
        firstLine = firstLine.slice(0, firstLine.indexOf('{')).trim();
      }
      // Remove 'export', 'async', 'function' keywords for cleaner display
      firstLine = firstLine.replace(/^(export\s+)?(async\s+)?function\s+/, '');
      break;

    case 'rust':
      firstLine = firstLine.replace(/^(pub\s+)?(async\s+)?fn\s+/, '');
      if (firstLine.includes('{')) {
        firstLine = firstLine.slice(0, firstLine.indexOf('{')).trim();
      }
      break;

    case 'python':
      // Strip decorator lines if present (they appear before def)
      firstLine = firstLine.replace(/^@\w+.*\n\s*/, '');
      firstLine = firstLine.replace(/^(async\s+)?def\s+/, '');
      if (firstLine.includes(':')) {
        firstLine = firstLine.slice(0, firstLine.lastIndexOf(':')).trim();
      }
      break;

    case 'go':
      firstLine = firstLine.replace(/^func\s+/, '');
      // Strip receiver prefix: (r *Type) → just the function name onwards
      firstLine = firstLine.replace(/^\([^)]*\)\s*/, '');
      if (firstLine.includes('{')) {
        firstLine = firstLine.slice(0, firstLine.indexOf('{')).trim();
      }
      break;
  }

  return firstLine.trim();
}

/**
 * Basic extraction fallback when queries fail
 */
function extractItemsBasic(rootNode: SyntaxNode, source: string): ExtractedItem[] {
  const items: ExtractedItem[] = [];
  const visited = new Set<number>();

  function walk(node: SyntaxNode, parent?: string) {
    // Avoid processing the same node twice
    if (visited.has(node.id)) return;
    visited.add(node.id);

    const nodeType = node.type;
    let item: ExtractedItem | null = null;

    // Check for common definition types
    if (
      nodeType === 'function_declaration' ||
      nodeType === 'function_definition' ||
      nodeType === 'function_item'
    ) {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        item = {
          type: 'function',
          name: nameNode.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          signature: extractSignature(node, source, 'typescript'),
          isAsync: source.slice(node.startIndex, node.startIndex + 50).includes('async'),
          parent,
        };
      }
    } else if (
      nodeType === 'class_declaration' ||
      nodeType === 'class_definition' ||
      nodeType === 'class_specifier'
    ) {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        item = {
          type: 'class',
          name: nameNode.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        };
        items.push(item);

        // Process class body for methods
        const body = node.childForFieldName('body');
        if (body) {
          for (let i = 0; i < body.childCount; i++) {
            walk(body.child(i)!, nameNode.text);
          }
        }
        return; // Don't add item twice
      }
    } else if (nodeType === 'method_definition' || nodeType === 'method_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        item = {
          type: 'method',
          name: nameNode.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          signature: extractSignature(node, source, 'typescript'),
          isAsync: source.slice(node.startIndex, node.startIndex + 50).includes('async'),
          parent,
        };
      }
    } else if (nodeType === 'interface_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        item = {
          type: 'interface',
          name: nameNode.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        };
      }
    } else if (nodeType === 'type_alias_declaration' || nodeType === 'type_item') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        item = {
          type: 'type',
          name: nameNode.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        };
      }
    } else if (nodeType === 'enum_declaration' || nodeType === 'enum_item') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        item = {
          type: 'enum',
          name: nameNode.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        };
      }
    } else if (nodeType === 'import_statement' || nodeType === 'import_declaration') {
      item = {
        type: 'import',
        name: node.text,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      };
    }

    if (item) {
      items.push(item);
    }

    // Recurse into children
    for (let i = 0; i < node.childCount; i++) {
      walk(node.child(i)!, parent);
    }
  }

  walk(rootNode);
  return items;
}

/**
 * Build CodeMap from extracted items
 */
function buildCodemap(
  filePath: string,
  language: SupportedLanguage,
  items: ExtractedItem[],
  source: string
): CodeMap {
  const exports: string[] = [];
  const functions: FunctionInfo[] = [];
  const types: TypeInfo[] = [];
  const dependencies: string[] = [];

  // First pass: collect classes with their line ranges
  interface ClassWithRange extends ClassInfo {
    startLine: number;
    endLine: number;
  }
  const classesWithRanges: ClassWithRange[] = [];
  const methods: ExtractedItem[] = [];

  for (const item of items) {
    switch (item.type) {
      case 'import':
        const dep = extractDependency(item.name);
        if (dep && !dependencies.includes(dep)) {
          dependencies.push(dep);
        }
        break;

      case 'function':
      case 'async_function':
        functions.push({
          name: item.name,
          signature: item.signature || item.name,
          async: item.isAsync ?? false,
        });
        break;

      case 'class':
      case 'struct':
        classesWithRanges.push({
          name: item.name,
          methods: [],
          properties: [],
          startLine: item.startLine,
          endLine: item.endLine,
        });
        break;

      case 'method':
        methods.push(item);
        break;

      case 'interface':
        types.push({ name: item.name, kind: 'interface' });
        break;

      case 'type':
        types.push({ name: item.name, kind: 'type' });
        break;

      case 'enum':
        types.push({ name: item.name, kind: 'enum' });
        break;

      case 'trait':
      case 'protocol':
        types.push({ name: item.name, kind: 'interface' });
        break;
    }
  }

  // Second pass: assign methods to classes based on line numbers
  for (const method of methods) {
    // Find the class that contains this method (method lines are within class lines)
    const parentClass = classesWithRanges.find(
      (cls) => method.startLine >= cls.startLine && method.endLine <= cls.endLine
    );
    if (parentClass) {
      parentClass.methods.push(method.signature || method.name);
    }
  }

  // Convert to ClassInfo (remove line range fields)
  const classes: ClassInfo[] = classesWithRanges.map(({ startLine, endLine, ...cls }) => cls);

  return {
    path: filePath,
    language,
    exports,
    classes,
    functions,
    types,
    dependencies,
  };
}

/**
 * Extract dependency name from import statement
 */
function extractDependency(importStatement: string): string | null {
  // Match various import patterns
  // ES6: import ... from 'pkg'
  // Python: import pkg, from pkg import ...
  // Go: import "pkg"
  // Rust: use pkg::...

  // ES6 style
  let match = importStatement.match(/from\s+['"]([^'"]+)['"]/);
  if (match) return match[1];

  // Direct import: import 'pkg' or import "pkg"
  match = importStatement.match(/import\s+['"]([^'"]+)['"]/);
  if (match) return match[1];

  // Python style: import pkg or from pkg
  match = importStatement.match(/^(?:from\s+)?(\w+)/);
  if (match) return match[1];

  // Rust use: use pkg::
  match = importStatement.match(/use\s+(\w+)/);
  if (match) return match[1];

  return null;
}

/**
 * Format a CodeMap as a compact string representation
 */
export function formatCodemapCompact(codemap: CodeMap): string {
  const lines: string[] = [];

  lines.push(`File: ${codemap.path}`);
  lines.push(`Language: ${codemap.language}`);

  // Markdown-specific rendering
  if (codemap.language === 'markdown') {
    if (codemap.sections && codemap.sections.length > 0) {
      lines.push('Sections:');
      for (const s of codemap.sections) {
        lines.push(`${'  '.repeat(s.depth)}${'#'.repeat(s.depth)} ${s.title}`);
      }
    }
    if (codemap.frontmatter && codemap.frontmatter.length > 0) {
      lines.push(`Front-matter: ${codemap.frontmatter.join(', ')}`);
    }
    if (codemap.codeBlocks) {
      const langs = codemap.codeBlocks.languages.length > 0
        ? ` (${codemap.codeBlocks.languages.join(', ')})`
        : '';
      lines.push(`Code blocks: ${codemap.codeBlocks.count}${langs}`);
    }
    return lines.join('\n');
  }

  if (codemap.dependencies.length > 0) {
    lines.push(`Imports: ${codemap.dependencies.join(', ')}`);
  }

  if (codemap.exports.length > 0) {
    lines.push(`Exports: ${codemap.exports.join(', ')}`);
  }

  if (codemap.types.length > 0) {
    lines.push('Types:');
    for (const t of codemap.types) {
      lines.push(`  ${t.kind} ${t.name}`);
    }
  }

  if (codemap.classes.length > 0) {
    lines.push('Classes:');
    for (const c of codemap.classes) {
      lines.push(`  class ${c.name}`);
      if (c.properties.length > 0) {
        lines.push(`    properties: ${c.properties.join(', ')}`);
      }
      if (c.methods.length > 0) {
        lines.push(`    methods: ${c.methods.join(', ')}`);
      }
    }
  }

  if (codemap.functions.length > 0) {
    lines.push('Functions:');
    for (const fn of codemap.functions) {
      const prefix = fn.async ? 'async ' : '';
      lines.push(`  ${prefix}${fn.signature}`);
    }
  }

  return lines.join('\n');
}
