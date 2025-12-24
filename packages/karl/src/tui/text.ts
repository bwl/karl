export function truncateLine(text: string, width: number): string {
  if (width <= 0) return '';
  if (text.length <= width) return text;
  if (width <= 3) return text.slice(0, width);
  return `${text.slice(0, width - 3)}...`;
}

export function padRight(text: string, width: number): string {
  if (width <= 0) return '';
  if (text.length >= width) return text.slice(0, width);
  return text + ' '.repeat(width - text.length);
}

export function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [''];
  const trimmed = text.trim();
  if (!trimmed) return [''];
  const words = trimmed.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length <= width) {
      current += ` ${word}`;
      continue;
    }
    lines.push(current);
    current = word;
  }

  if (current) {
    lines.push(current);
  }

  return lines.length > 0 ? lines : [''];
}
