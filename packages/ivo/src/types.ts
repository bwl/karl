/**
 * Core type definitions for Ivo - Context Intelligence Engine
 */

// ============================================================================
// Tree Types
// ============================================================================

export interface TreeOptions {
  /** Display mode: full tree, folders only, or selected files only */
  mode?: 'full' | 'folders' | 'selected';
  /** Starting path (relative or absolute) */
  path?: string;
  /** Maximum depth to traverse */
  maxDepth?: number;
}

// ============================================================================
// Search Types
// ============================================================================

export interface SearchOptions {
  /** Search mode: auto-detect, path-only, content-only, or both */
  mode?: 'auto' | 'path' | 'content' | 'both';
  /** File extensions to include (e.g., ['.ts', '.tsx']) */
  extensions?: string[];
  /** Number of context lines around matches */
  contextLines?: number;
  /** Maximum number of results */
  maxResults?: number;
  /** Use regex pattern */
  regex?: boolean;
  /** Case insensitive search */
  caseInsensitive?: boolean;
}

export interface SearchMatch {
  path: string;
  line: number;
  content: string;
  context?: {
    before: string[];
    after: string[];
  };
}

export interface SearchResult {
  pattern: string;
  matches: SearchMatch[];
  totalMatches: number;
  truncated: boolean;
}

// ============================================================================
// Structure/Codemap Types
// ============================================================================

export interface StructureOptions {
  /** Scope: explicit paths or current selection */
  scope?: 'paths' | 'selected';
  /** Maximum number of codemaps to return */
  maxResults?: number;
}

export interface CodeMap {
  path: string;
  language: string;
  exports: string[];
  classes: ClassInfo[];
  functions: FunctionInfo[];
  types: TypeInfo[];
  dependencies: string[];
  /** Heading hierarchy (markdown only) */
  sections?: SectionInfo[];
  /** Frontmatter key names (markdown only) */
  frontmatter?: string[];
  /** Code block inventory (markdown only) */
  codeBlocks?: { count: number; languages: string[] };
}

export interface SectionInfo {
  depth: number;  // 1-6 (h1-h6)
  title: string;
}

export interface ClassInfo {
  name: string;
  methods: string[];
  properties: string[];
}

export interface FunctionInfo {
  name: string;
  signature: string;
  async: boolean;
}

export interface TypeInfo {
  name: string;
  kind: 'interface' | 'type' | 'enum';
}

export interface StructureResult {
  codemaps: CodeMap[];
  filesWithoutCodemap: string[];
}

// ============================================================================
// Selection Types
// ============================================================================

export type SelectionMode = 'full' | 'codemap' | 'slice';

export interface SelectionFile {
  path: string;
  tokens: number;
  mode: SelectionMode;
  slices?: SliceRange[];
}

export interface SliceRange {
  startLine: number;
  endLine: number;
  description?: string;
}

export interface SelectionResult {
  files: SelectionFile[];
  totalTokens: number;
  prompt?: string;
}

// ============================================================================
// Context Types
// ============================================================================

export type OutputFormat = 'xml' | 'markdown' | 'json';

export interface ContextHistoryOptions {
  limit?: number;
  id?: string;
  full?: boolean;
  tag?: string[];
  status?: 'success' | 'error';
  stack?: string;
  model?: string;
  skill?: string;
}

export interface ContextHistoryEntry {
  id?: string;
  createdAt?: number;
  status?: string;
  prompt?: string;
  response?: string;
  [key: string]: unknown;
}

export interface ContextHistory {
  source: string;
  mode: 'summary' | 'full';
  entries: ContextHistoryEntry[];
}

export interface ContextOptions {
  /** Output format */
  format?: OutputFormat;
  /** Token budget limit */
  budget?: number;
  /** Include implementation plan */
  includePlan?: boolean;
  /** Response type for builder */
  responseType?: 'plan' | 'question' | 'clarify';
  /** What to include in context */
  include?: ('prompt' | 'selection' | 'code' | 'files' | 'tree' | 'tokens' | 'history')[];
  /** Include run history */
  history?: ContextHistoryOptions;
}

export interface ContextFile {
  path: string;
  tokens: number;
  mode: SelectionMode;
  content?: string;
  codemap?: string;
  relevance?: number;
  reason?: string;
  strategy?: string;
}

export interface StrategyStats {
  count: number;
  tokens: number;
}

export interface ContextResult {
  task: string;
  files: ContextFile[];
  totalTokens: number;
  budget?: number;
  strategies?: Record<string, StrategyStats>;
  plan?: string;
  prompt?: string;
  tree?: string;
  forest?: string;
  chatId?: string;
  history?: ContextHistory;
}

// ============================================================================
// Error Types
// ============================================================================

export class IvoError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'IvoError';
  }
}

export class BackendNotAvailableError extends IvoError {
  constructor(backend: string, details?: string) {
    super(
      `Backend '${backend}' is not available. ${details || ''}`,
      'BACKEND_NOT_AVAILABLE',
      { backend }
    );
    this.name = 'BackendNotAvailableError';
  }
}
