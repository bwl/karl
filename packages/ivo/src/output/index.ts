/**
 * Output Formatters
 */

export { formatXml, formatXmlMinimal } from './xml.js';
export { formatMarkdown, formatFileTable } from './markdown.js';
export { formatJson, formatSelectionJson, formatSearchJson, formatStructureJson } from './json.js';

import type { ContextResult, OutputFormat } from '../types.js';
import { formatXml } from './xml.js';
import { formatMarkdown } from './markdown.js';
import { formatJson } from './json.js';

/**
 * Format context result using the specified format
 */
export function formatContext(result: ContextResult, format: OutputFormat = 'xml'): string {
  switch (format) {
    case 'xml':
      return formatXml(result);
    case 'markdown':
      return formatMarkdown(result);
    case 'json':
      return formatJson(result);
    default:
      throw new Error(`Unknown output format: ${format}`);
  }
}
