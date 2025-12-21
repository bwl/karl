/**
 * Codemap Module - Tree-sitter based code structure extraction
 */

export { extractCodemap, formatCodemapCompact } from './extractor.js';
export {
  loadLanguage,
  getParser,
  detectLanguage,
  isLanguageSupported,
  getSupportedLanguages,
  getSupportedExtensions,
  type SupportedLanguage,
} from './parser.js';
export { getQueryForLanguage, LANGUAGE_QUERIES } from './queries.js';
