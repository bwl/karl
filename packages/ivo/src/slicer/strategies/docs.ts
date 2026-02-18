/**
 * Docs Strategy — documentation file discovery and inclusion
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { detectLanguage, extractCodemap, formatCodemapCompact } from '../../codemap/index.js';
import type { StrategyPlugin, StrategyContext, StrategyResult } from '../strategy.js';
import type { SliceAlternate, SliceCandidate } from '../types.js';
import type { SearchMatch } from '../../types.js';
import {
  buildSnippet, collectKeywordMatches, CORE_DOC_FILES,
  estimateTokens, isDocPath, isPathIncluded, listRepoFiles,
  loadFileContent, makeReferenceAlternate, scoreCandidate,
} from '../utils.js';

export default (): StrategyPlugin => ({
  name: 'docs',
  defaultWeight: 0.30,
  defaultBudgetCap: 0.10,

  async isAvailable() { return true; },

  async execute(ctx: StrategyContext): Promise<StrategyResult> {
    const docsLimit = ctx.intensity === 'lite' ? 8 : ctx.intensity === 'deep' ? 30 : 16;
    const keywords = ctx.keywords.slice(0, 6);
    const contextLines = ctx.intensity === 'lite' ? 1 : ctx.intensity === 'deep' ? 4 : 2;
    const maxDocTokens = ctx.intensity === 'deep' ? 2400 : 1200;
    const candidates: SliceCandidate[] = [];

    const addDocCandidate = async (path: string, reason: string, matches?: SearchMatch[]) => {
      if (!isPathIncluded(path, ctx.request)) return;
      const fullPath = join(ctx.repoRoot, path);
      const content = await loadFileContent(fullPath);
      if (!content) return;

      const tokens = estimateTokens(content);
      let representation: 'full' | 'snippet' | 'codemap' = 'full';
      let body = content;
      let codemapStr: string | undefined;

      if (tokens > maxDocTokens) {
        if (detectLanguage(path) === 'markdown') {
          const codemap = await extractCodemap(fullPath, content);
          if (codemap) {
            body = formatCodemapCompact(codemap);
            representation = 'codemap';
            codemapStr = body;
          }
        }
        if (representation !== 'codemap') {
          const lines = content.split('\n');
          body = lines.slice(0, 200).join('\n');
          representation = 'snippet';
        }
      } else if (detectLanguage(path) === 'markdown') {
        const codemap = await extractCodemap(fullPath, content);
        if (codemap) codemapStr = formatCodemapCompact(codemap);
      }

      const alternates: SliceAlternate[] = [makeReferenceAlternate(path, 'docs reference')];
      if (codemapStr && representation !== 'codemap') {
        alternates.unshift({ representation: 'codemap', tokens: estimateTokens(codemapStr), codemap: codemapStr });
      }
      if (representation !== 'full' && tokens <= maxDocTokens * 2) {
        alternates.unshift({ representation: 'full', tokens, content });
      }

      const bodyTokens = estimateTokens(body);
      candidates.push({
        id: `docs:${path}`,
        path,
        strategy: 'docs',
        representation,
        score: scoreCandidate('docs', matches?.length ?? 1, bodyTokens, ctx.budgetTokens),
        tokens: bodyTokens,
        reason,
        source: 'docs',
        content: representation === 'codemap' ? undefined : body,
        codemap: representation === 'codemap' ? codemapStr : undefined,
        alternates,
      });
    };

    // Always include core docs if present
    for (const path of CORE_DOC_FILES) {
      if (existsSync(join(ctx.repoRoot, path))) {
        await addDocCandidate(path, 'Core doc');
      }
    }

    if (keywords.length > 0) {
      const matchByFile = await collectKeywordMatches(
        ctx.backend, keywords, ctx.request,
        { contextLines, maxResults: docsLimit * 10 },
        isDocPath
      );

      for (const [path, matches] of Array.from(matchByFile.entries()).slice(0, docsLimit)) {
        if (CORE_DOC_FILES.includes(path)) continue;
        const fullPath = join(ctx.repoRoot, path);
        const content = await loadFileContent(fullPath);
        if (!content) continue;

        const lines = content.split('\n');
        const lineNumbers = matches.map((m) => m.line).filter(Boolean);
        const snippet = buildSnippet(path, lines, lineNumbers.slice(0, 6), contextLines);
        const tokens = estimateTokens(snippet);
        const alternates: SliceAlternate[] = [makeReferenceAlternate(path, 'docs reference')];
        const fullTokens = estimateTokens(content);
        if (fullTokens <= maxDocTokens * 2) {
          alternates.unshift({ representation: 'full', tokens: fullTokens, content });
        }

        candidates.push({
          id: `docs:${path}`,
          path,
          strategy: 'docs',
          representation: 'snippet',
          score: scoreCandidate('docs', matches.length, tokens, ctx.budgetTokens),
          tokens,
          reason: `Doc hits: ${matches.length}`,
          source: 'search',
          content: snippet,
          alternates,
        });
      }
    } else {
      const docFiles = (await listRepoFiles(ctx.repoRoot)).filter(isDocPath);
      for (const path of docFiles.slice(0, docsLimit)) {
        if (CORE_DOC_FILES.includes(path)) continue;
        await addDocCandidate(path, 'Doc fallback');
      }
    }

    return { candidates };
  },
});
