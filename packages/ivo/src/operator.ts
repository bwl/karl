/**
 * Smart Context Operator — ivo's QA layer
 *
 * Runs an expand → build → evaluate → retry loop:
 * 1. Detect project type (cached in .ivo/project-profile.json)
 * 2. Expand keywords with LLM (project-aware)
 * 3. Build context via backend
 * 4. Evaluate result quality
 * 5. If bad mix → adjust keywords and retry (max 2 retries)
 */

import { existsSync, readFileSync } from 'fs';
import { readFile, writeFile, mkdir, readdir, stat } from 'fs/promises';
import { join, dirname, extname } from 'path';
import { resolveLlmConfig, chatComplete, type LlmConfig } from './llm.js';
import { loadConfig } from './config.js';
import type { IvoBackend } from './backends/types.js';
import type { ContextOptions, ContextResult, StrategyStats } from './types.js';

const MAX_RETRIES = 2;
const PROFILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Marker files → project type
const PROJECT_MARKERS: Record<string, string> = {
  'project.godot': 'Godot',
  'Cargo.toml': 'Rust',
  'package.json': 'Node.js/TypeScript',
  'go.mod': 'Go',
  'pyproject.toml': 'Python',
  'setup.py': 'Python',
  'requirements.txt': 'Python',
  'Gemfile': 'Ruby',
  'build.gradle': 'Java/Kotlin',
  'pom.xml': 'Java',
  'CMakeLists.txt': 'C/C++',
  'Makefile': 'C/C++',
  'pubspec.yaml': 'Flutter/Dart',
  'mix.exs': 'Elixir',
  'deno.json': 'Deno',
  'composer.json': 'PHP',
  'Package.swift': 'Swift',
  '.sln': 'C#/.NET',
};

export interface OperatorResult {
  contextId: string;
  result: ContextResult;
  attempts: number;
  profileUsed: boolean;
}

export interface ProjectProfile {
  type: string;
  languages: string[];
  frameworks: string[];
  domainVocab: string[];
  description: string;
  detectedAt: string;
}

// ============================================================================
// Project Profile — cached in .ivo/project-profile.json
// ============================================================================

function getProfilePath(repoRoot: string): string {
  return join(repoRoot, '.ivo', 'project-profile.json');
}

async function loadProfile(repoRoot: string): Promise<ProjectProfile | null> {
  const profilePath = getProfilePath(repoRoot);
  try {
    const content = await readFile(profilePath, 'utf-8');
    const profile = JSON.parse(content) as ProjectProfile;
    const age = Date.now() - new Date(profile.detectedAt).getTime();
    if (age > PROFILE_MAX_AGE_MS) return null;
    return profile;
  } catch {
    return null;
  }
}

async function saveProfile(repoRoot: string, profile: ProjectProfile): Promise<void> {
  const profilePath = getProfilePath(repoRoot);
  try {
    await mkdir(dirname(profilePath), { recursive: true });
    await writeFile(profilePath, JSON.stringify(profile, null, 2));
  } catch {
    // Best effort
  }
}

function detectProjectTypeFromMarkers(repoRoot: string): string | null {
  for (const [marker, type] of Object.entries(PROJECT_MARKERS)) {
    if (existsSync(join(repoRoot, marker))) return type;
  }
  return null;
}

async function getShallowTree(repoRoot: string, depth: number = 2): Promise<string> {
  const lines: string[] = [];

  async function walk(dir: string, currentDepth: number, prefix: string): Promise<void> {
    if (currentDepth > depth) return;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const filtered = entries.filter(e => !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== '__pycache__' && e.name !== 'target' && e.name !== '.godot');
      for (const entry of filtered.slice(0, 30)) {
        lines.push(`${prefix}${entry.name}${entry.isDirectory() ? '/' : ''}`);
        if (entry.isDirectory() && currentDepth < depth) {
          await walk(join(dir, entry.name), currentDepth + 1, prefix + '  ');
        }
      }
    } catch {
      // skip
    }
  }

  await walk(repoRoot, 0, '');
  return lines.join('\n');
}

async function detectProfile(repoRoot: string): Promise<ProjectProfile> {
  const markerType = detectProjectTypeFromMarkers(repoRoot);
  const tree = await getShallowTree(repoRoot);

  let profile: ProjectProfile;

  try {
    const config = await loadConfig(repoRoot);
    const llm = resolveLlmConfig(config);
    if (!llm) throw new Error('No LLM configured');

    const prompt = `Analyze this project and return a JSON object describing it.

Project root marker: ${markerType ?? 'unknown'}

File tree (depth 2):
${tree}

Return this exact JSON shape:
{
  "type": "short project type, e.g. Godot 4 GDScript, Rust CLI, Next.js webapp",
  "languages": ["primary", "secondary"],
  "frameworks": ["framework1", "framework2"],
  "domainVocab": ["domain-specific terms that would help search this codebase, 10-20 terms"],
  "description": "one sentence describing what this project appears to be"
}

JSON only, no markdown fences.`;

    const raw = await chatComplete(llm, [
      { role: 'system', content: 'You analyze project structures and return JSON. No markdown, no commentary.' },
      { role: 'user', content: prompt },
    ], { temperature: 0.2, maxTokens: 800 });

    const parsed = parseJson(raw);

    profile = {
      type: typeof parsed.type === 'string' ? parsed.type : markerType ?? 'unknown',
      languages: normalizeStringArray(parsed.languages),
      frameworks: normalizeStringArray(parsed.frameworks),
      domainVocab: normalizeStringArray(parsed.domainVocab),
      description: typeof parsed.description === 'string' ? parsed.description : '',
      detectedAt: new Date().toISOString(),
    };
  } catch {
    // Fallback to marker-only profile
    profile = {
      type: markerType ?? 'unknown',
      languages: [],
      frameworks: [],
      domainVocab: [],
      description: '',
      detectedAt: new Date().toISOString(),
    };
  }

  await saveProfile(repoRoot, profile);
  return profile;
}

// ============================================================================
// JSON/Array Helpers
// ============================================================================

function parseJson(raw: string): Record<string, unknown> {
  if (!raw) throw new Error('Empty LLM response');
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw.trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object in response');
  return JSON.parse(candidate.slice(start, end + 1));
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(e => String(e).trim()).filter(Boolean);
  }
  return [];
}

// ============================================================================
// Operator Loop
// ============================================================================

interface EvalSummary {
  query: string;
  fileCount: number;
  totalTokens: number;
  budget: number;
  strategies: Record<string, StrategyStats>;
  topExtensions: string[];
  projectType: string;
}

function buildEvalSummary(query: string, result: ContextResult, budget: number, projectType: string): EvalSummary {
  const extCounts = new Map<string, number>();
  for (const file of result.files) {
    const ext = extname(file.path) || 'no-ext';
    extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
  }
  const topExtensions = [...extCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([ext, count]) => `${ext}(${count})`);

  return {
    query,
    fileCount: result.files.length,
    totalTokens: result.totalTokens,
    budget,
    strategies: result.strategies ?? {},
    topExtensions,
    projectType,
  };
}

function evaluateLocally(summary: EvalSummary): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const { strategies, fileCount, totalTokens, budget } = summary;

  const keywordStats = strategies['keyword'];
  const forestStats = strategies['forest'];
  const inventoryStats = strategies['inventory'];

  if (keywordStats && keywordStats.count <= 2) {
    issues.push('keyword_low_count');
  }
  if (keywordStats && budget > 0 && (keywordStats.tokens / budget) < 0.15) {
    issues.push('keyword_low_pct');
  }
  if (forestStats && budget > 0 && (forestStats.tokens / budget) > 0.40) {
    issues.push('forest_heavy');
  }
  if (inventoryStats && budget > 0 && (inventoryStats.tokens / budget) > 0.60) {
    issues.push('inventory_heavy');
  }
  if (budget > 0 && (totalTokens / budget) < 0.30) {
    issues.push('budget_undershot');
  }
  if (fileCount < 5) {
    issues.push('few_files');
  }

  return { ok: issues.length === 0, issues };
}

export async function operatorContext(
  query: string,
  backend: IvoBackend,
  opts: ContextOptions,
  repoRoot: string,
): Promise<OperatorResult> {
  const budget = opts.budget ?? 32000;

  // Step 0: Load or detect project profile
  let profile = await loadProfile(repoRoot);
  let profileUsed = true;
  if (!profile) {
    console.error('[operator] Detecting project type...');
    profile = await detectProfile(repoRoot);
    profileUsed = false;
    console.error(`[operator] Project: ${profile.type}`);
  } else {
    console.error(`[operator] Project: ${profile.type} (cached)`);
  }

  // Step 1: Expand keywords with LLM
  let expandedKeywords: string[];
  try {
    expandedKeywords = await expandWithOperator(query, profile, repoRoot);
    console.error(`[operator] Expanding: ${query} → ${expandedKeywords.join(', ')}`);
  } catch {
    console.error('[operator] LLM expansion failed, using raw query');
    expandedKeywords = query.split(/[,\s]+/).filter(Boolean);
  }

  // Step 2: Build context
  let task = expandedKeywords.join(', ');
  console.error(`Searching: ${task}`);
  let result = await backend.buildContext(task, opts);
  let attempts = 1;

  // Step 3: Evaluate
  const summary = buildEvalSummary(query, result, budget, profile.type);
  const eval1 = evaluateLocally(summary);

  if (eval1.ok) {
    const stratSummary = formatStratSummary(result);
    console.error(`[operator] Evaluating: ${result.files.length} files, ${formatTokens(result.totalTokens)} tokens — ${stratSummary}`);
    console.error('[operator] \u2713 Good mix');
    return { contextId: '', result, attempts, profileUsed };
  }

  console.error(`[operator] Evaluating: ${result.files.length} files, ${formatTokens(result.totalTokens)} tokens — ${formatStratSummary(result)}`);
  console.error(`[operator] \u2717 Issues: ${eval1.issues.join(', ')}. Asking LLM for adjustments...`);

  // Step 4: LLM evaluation + retry loop
  for (let retry = 0; retry < MAX_RETRIES; retry++) {
    try {
      const adjusted = await evaluateWithOperator(query, summary, eval1.issues, profile, repoRoot);
      if (!adjusted || adjusted.length === 0) {
        console.error('[operator] LLM returned no adjustments, keeping current result');
        break;
      }

      task = adjusted.join(', ');
      console.error(`[operator] Retry ${retry + 1}: ${task}`);
      console.error(`Searching: ${task}`);
      result = await backend.buildContext(task, opts);
      attempts++;

      const retrySummary = buildEvalSummary(query, result, budget, profile.type);
      const evalRetry = evaluateLocally(retrySummary);

      console.error(`[operator] Evaluating: ${result.files.length} files, ${formatTokens(result.totalTokens)} tokens — ${formatStratSummary(result)}`);

      if (evalRetry.ok) {
        console.error(`[operator] \u2713 Good mix (attempt ${attempts})`);
        return { contextId: '', result, attempts, profileUsed };
      }

      console.error(`[operator] \u2717 Still issues: ${evalRetry.issues.join(', ')}`);
    } catch (err) {
      console.error(`[operator] Retry evaluation failed: ${err instanceof Error ? err.message : err}`);
      break;
    }
  }

  console.error(`[operator] Returning best effort after ${attempts} attempt(s)`);
  return { contextId: '', result, attempts, profileUsed };
}

// ============================================================================
// LLM Calls
// ============================================================================

async function expandWithOperator(query: string, profile: ProjectProfile, cwd: string): Promise<string[]> {
  const config = await loadConfig(cwd);
  const llm = resolveLlmConfig(config);
  if (!llm) throw new Error('No LLM configured for operator expansion');

  const prompt = `Project type: ${profile.type}
Languages: ${profile.languages.join(', ') || 'unknown'}
Frameworks: ${profile.frameworks.join(', ') || 'none'}
Domain vocabulary: ${profile.domainVocab.join(', ') || 'none'}

User query: "${query}"

Return a JSON array of 12-15 search keywords that would find the most relevant source code files for this query in this project. Include:
- The original terms from the query
- Project-specific identifiers (class names, function names, file names) that relate to the query
- Framework-specific types/APIs relevant to the query
- Related concepts that would appear in the same files

Return only a JSON array of strings, no explanation.`;

  const raw = await chatComplete(llm, [
    { role: 'system', content: 'You expand code search queries into project-specific keywords. Return JSON arrays only.' },
    { role: 'user', content: prompt },
  ], { temperature: 0.3, maxTokens: 400 });

  return parseLlmArray(raw);
}

async function evaluateWithOperator(
  originalQuery: string,
  summary: EvalSummary,
  issues: string[],
  profile: ProjectProfile,
  cwd: string,
): Promise<string[] | null> {
  const config = await loadConfig(cwd);
  const llm = resolveLlmConfig(config);
  if (!llm) throw new Error('No LLM configured for operator evaluation');

  const issueDescriptions: Record<string, string> = {
    keyword_low_count: 'Keywords matched very few files (0-2). The search terms missed — try different identifiers.',
    keyword_low_pct: 'Keyword search underperformed (<15% of budget). Try more specific project terms.',
    forest_heavy: 'Forest knowledge is >40% of budget, crowding out code. Need more targeted code keywords.',
    inventory_heavy: 'File tree/inventory is >60% of budget. Need more targeted keywords to find specific code.',
    budget_undershot: 'Only using <30% of token budget. Try broader or more keywords.',
    few_files: 'Only found <5 files. Keywords may be too narrow or incorrect for this project.',
  };

  const issueText = issues.map(i => issueDescriptions[i] ?? i).join('\n- ');

  const prompt = `Project: ${profile.type}
Original query: "${originalQuery}"

Current result:
${JSON.stringify(summary, null, 2)}

Issues detected:
- ${issueText}

Return a JSON array of 12-15 adjusted search keywords that would fix these issues. Focus on finding more relevant source code files for the original query.

Return only a JSON array of strings.`;

  const raw = await chatComplete(llm, [
    { role: 'system', content: 'You adjust code search keywords based on result quality feedback. Return JSON arrays only.' },
    { role: 'user', content: prompt },
  ], { temperature: 0.3, maxTokens: 400 });

  const keywords = parseLlmArray(raw);
  return keywords.length > 0 ? keywords : null;
}

function parseLlmArray(raw: string): string[] {
  if (!raw) return [];
  const match = raw.match(/\[[\s\S]*?\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map(s => s.trim())
      .filter(s => s.length >= 2 && s.length <= 60);
  } catch {
    return [];
  }
}

// ============================================================================
// Formatting helpers
// ============================================================================

function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

function formatStratSummary(result: ContextResult): string {
  if (!result.strategies) return 'no strategies';
  return Object.entries(result.strategies)
    .sort((a, b) => b[1].tokens - a[1].tokens)
    .map(([name, stats]) => `${name}: ${stats.count > 0 ? `${stats.count} hits` : formatTokens(stats.tokens)}`)
    .join(', ');
}
