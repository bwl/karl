import { padRight, truncateLine, wrapText } from './text.js';

export interface Keypress {
  name?: string;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
  sequence?: string;
}

export interface OverlayRender {
  lines: string[];
  top: number;
  left: number;
  width: number;
  height: number;
}

export type OverlayKind = 'input' | 'inline-input' | 'textarea' | 'confirm' | 'picker';

export interface OverlayBase {
  kind: OverlayKind;
  title?: string;
  hint?: string;
  width?: number;
  height?: number;
}

export interface InputOverlay extends OverlayBase {
  kind: 'input' | 'inline-input';
  label?: string;
  value: string;
  cursor: number;
  placeholder?: string;
  error?: string;
  validate?: (value: string) => string | null;
}

export interface TextareaOverlay extends OverlayBase {
  kind: 'textarea';
  label?: string;
  value: string;
  cursor: number;
}

export interface ConfirmOverlay extends OverlayBase {
  kind: 'confirm';
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  focused?: 'confirm' | 'cancel';
}

export interface PickerItem {
  id: string;
  label: string;
  detail?: string;
}

export interface PickerOverlay extends OverlayBase {
  kind: 'picker';
  items: PickerItem[];
  filter: string;
  selectedIndex: number;
}

export type OverlayState = InputOverlay | TextareaOverlay | ConfirmOverlay | PickerOverlay;

export interface OverlayCommand {
  type: 'submit' | 'cancel';
  value?: string;
  selection?: PickerItem;
}

export interface OverlayUpdate {
  overlay: OverlayState | null;
  command?: OverlayCommand;
}

function getPrintableChar(text: string, key: Keypress): string | null {
  if (key.ctrl || key.meta) return null;
  if (!text) return null;
  if (text.length !== 1) return null;
  if (text < ' ' || text > '~') return null;
  return text;
}

function insertAt(value: string, cursor: number, text: string): { value: string; cursor: number } {
  const next = value.slice(0, cursor) + text + value.slice(cursor);
  return { value: next, cursor: cursor + text.length };
}

function removeAt(value: string, cursor: number): { value: string; cursor: number } {
  if (cursor <= 0) return { value, cursor };
  const next = value.slice(0, cursor - 1) + value.slice(cursor);
  return { value: next, cursor: cursor - 1 };
}

function moveCursor(value: string, cursor: number, delta: number): number {
  const next = cursor + delta;
  if (next < 0) return 0;
  if (next > value.length) return value.length;
  return next;
}

function findLineCol(value: string, cursor: number): { line: number; col: number; lines: string[] } {
  const lines = value.split('\n');
  let remaining = cursor;
  for (let i = 0; i < lines.length; i++) {
    const length = lines[i].length;
    if (remaining <= length) {
      return { line: i, col: remaining, lines };
    }
    remaining -= length + 1;
  }
  const lastLine = Math.max(0, lines.length - 1);
  return { line: lastLine, col: lines[lastLine]?.length ?? 0, lines };
}

function lineColToCursor(lines: string[], line: number, col: number): number {
  let cursor = 0;
  for (let i = 0; i < lines.length; i++) {
    if (i === line) {
      cursor += Math.min(col, lines[i].length);
      break;
    }
    cursor += lines[i].length + 1;
  }
  return cursor;
}

function renderBox(content: string[], width: number, title?: string): string[] {
  const innerWidth = Math.max(1, width - 2);
  const top = `+${'-'.repeat(innerWidth)}+`;
  const bottom = top;
  const lines: string[] = [];

  if (title) {
    const titleLine = truncateLine(title, innerWidth);
    lines.push(padRight(titleLine, innerWidth));
  }

  for (const line of content) {
    lines.push(padRight(truncateLine(line, innerWidth), innerWidth));
  }

  return [
    top,
    ...lines.map(line => `|${line}|`),
    bottom,
  ];
}

function computeCenterPlacement(width: number, height: number, termWidth: number, termHeight: number) {
  const left = Math.max(0, Math.floor((termWidth - width) / 2));
  const top = Math.max(0, Math.floor((termHeight - height) / 2));
  return { left, top };
}

function renderInputLine(
  label: string | undefined,
  value: string,
  cursor: number,
  placeholder: string | undefined,
  width: number
): string {
  const prefix = label ? `${label}: ` : '';
  const available = Math.max(1, width - prefix.length);
  let display = value;
  let cursorPos = cursor;

  if (!display && placeholder) {
    display = `(${placeholder})`;
    cursorPos = 0;
  }

  if (display.length > available - 1) {
    let start = Math.max(0, cursorPos - Math.floor(available / 2));
    if (start + (available - 1) > display.length) {
      start = Math.max(0, display.length - (available - 1));
    }
    display = display.slice(start, start + (available - 1));
    cursorPos = Math.max(0, cursorPos - start);
  }

  const cursorMarker = '|';
  const before = display.slice(0, cursorPos);
  const after = display.slice(cursorPos);
  const rendered = `${before}${cursorMarker}${after}`;
  return truncateLine(prefix + rendered, width);
}

function renderInputOverlay(overlay: InputOverlay, termWidth: number, termHeight: number): OverlayRender {
  const width = Math.min(termWidth, Math.max(24, Math.min(70, overlay.width ?? termWidth - 6)));
  const content: string[] = [];

  const inputLine = renderInputLine(overlay.label, overlay.value, overlay.cursor, overlay.placeholder, width - 2);
  content.push(inputLine);

  if (overlay.error) {
    content.push(`Error: ${overlay.error}`);
  }
  if (overlay.hint) {
    content.push(overlay.hint);
  }

  const lines = renderBox(content, width, overlay.title);
  const height = lines.length;
  const { left, top } = computeCenterPlacement(width, height, termWidth, termHeight);

  return { lines, width, height, left, top };
}

function renderInlineInputOverlay(overlay: InputOverlay, termWidth: number, termHeight: number): OverlayRender {
  const width = Math.min(termWidth, Math.max(20, overlay.width ?? termWidth));
  const line = renderInputLine(overlay.label, overlay.value, overlay.cursor, overlay.placeholder, width);
  const divider = '-'.repeat(width);
  const hint = overlay.hint ? truncateLine(overlay.hint, width) : '';
  const lines = [divider, line, hint];
  const height = lines.length;
  const top = Math.max(0, termHeight - height);

  return { lines, width, height, left: 0, top };
}

function renderConfirmOverlay(overlay: ConfirmOverlay, termWidth: number, termHeight: number): OverlayRender {
  const width = Math.min(termWidth, Math.max(28, Math.min(70, overlay.width ?? termWidth - 6)));
  const content: string[] = [];

  const messageLines = wrapText(overlay.message, width - 2);
  content.push(...messageLines);
  content.push('');

  const confirmLabel = overlay.confirmLabel ?? 'Confirm';
  const cancelLabel = overlay.cancelLabel ?? 'Cancel';
  const focus = overlay.focused ?? 'confirm';
  const confirmText = focus === 'confirm' ? `> ${confirmLabel} <` : `  ${confirmLabel}  `;
  const cancelText = focus === 'cancel' ? `> ${cancelLabel} <` : `  ${cancelLabel}  `;
  content.push(`${confirmText}   ${cancelText}`);

  if (overlay.hint) {
    content.push('');
    content.push(overlay.hint);
  }

  const lines = renderBox(content, width, overlay.title);
  const height = lines.length;
  const { left, top } = computeCenterPlacement(width, height, termWidth, termHeight);
  return { lines, width, height, left, top };
}

function filterPickerItems(overlay: PickerOverlay): PickerItem[] {
  const filter = overlay.filter.trim().toLowerCase();
  if (!filter) return overlay.items;
  return overlay.items.filter(item =>
    item.label.toLowerCase().includes(filter) ||
    (item.detail?.toLowerCase().includes(filter) ?? false)
  );
}

function renderPickerOverlay(overlay: PickerOverlay, termWidth: number, termHeight: number): OverlayRender {
  const width = Math.min(termWidth, Math.max(32, Math.min(80, overlay.width ?? termWidth - 6)));
  const listHeight = Math.max(4, Math.min(10, overlay.height ?? 10));
  const content: string[] = [];

  const searchLine = renderInputLine('Search', overlay.filter, overlay.filter.length, 'type to filter', width - 2);
  content.push(searchLine);
  content.push('');

  const filtered = filterPickerItems(overlay);
  const start = Math.max(0, Math.min(overlay.selectedIndex, Math.max(0, filtered.length - 1)));
  const windowStart = Math.max(0, start - Math.floor(listHeight / 2));
  const windowEnd = Math.min(filtered.length, windowStart + listHeight);

  if (filtered.length === 0) {
    content.push('(no matches)');
  } else {
    for (let i = windowStart; i < windowEnd; i++) {
      const prefix = i === start ? '> ' : '  ';
      const detail = filtered[i].detail ? ` - ${filtered[i].detail}` : '';
      content.push(truncateLine(`${prefix}${filtered[i].label}${detail}`, width - 2));
    }
  }

  if (overlay.hint) {
    content.push('');
    content.push(overlay.hint);
  }

  const lines = renderBox(content, width, overlay.title);
  const height = lines.length;
  const { left, top } = computeCenterPlacement(width, height, termWidth, termHeight);
  return { lines, width, height, left, top };
}

function renderTextareaOverlay(overlay: TextareaOverlay, termWidth: number, termHeight: number): OverlayRender {
  const width = Math.min(termWidth, Math.max(36, Math.min(90, overlay.width ?? termWidth - 6)));
  const height = Math.min(termHeight, Math.max(8, Math.min(16, overlay.height ?? Math.floor(termHeight * 0.6))));
  const innerWidth = width - 2;
  const innerHeight = height - 2;

  const { line: cursorLine, col: cursorCol, lines } = findLineCol(overlay.value, overlay.cursor);
  const maxStart = Math.max(0, lines.length - innerHeight);
  let startLine = Math.max(0, Math.min(cursorLine - Math.floor(innerHeight / 2), maxStart));
  if (cursorLine < startLine) startLine = cursorLine;
  if (cursorLine >= startLine + innerHeight) startLine = Math.min(maxStart, cursorLine - innerHeight + 1);

  const visible = lines.slice(startLine, startLine + innerHeight);
  const content: string[] = [];

  if (overlay.label) {
    content.push(truncateLine(overlay.label, innerWidth));
  }

  for (let i = 0; i < innerHeight; i++) {
    const lineIndex = startLine + i;
    let line = visible[i] ?? '';
    if (lineIndex === cursorLine) {
      const cursor = Math.min(cursorCol, line.length);
      line = `${line.slice(0, cursor)}|${line.slice(cursor)}`;
    }
    content.push(truncateLine(line, innerWidth));
  }

  if (overlay.hint) {
    content.push(truncateLine(overlay.hint, innerWidth));
  }

  const linesBox = renderBox(content, width, overlay.title);
  return {
    lines: linesBox,
    width,
    height: linesBox.length,
    ...computeCenterPlacement(width, linesBox.length, termWidth, termHeight)
  };
}

export function renderOverlay(overlay: OverlayState, termWidth: number, termHeight: number): OverlayRender {
  switch (overlay.kind) {
    case 'inline-input':
      return renderInlineInputOverlay(overlay, termWidth, termHeight);
    case 'input':
      return renderInputOverlay(overlay, termWidth, termHeight);
    case 'confirm':
      return renderConfirmOverlay(overlay, termWidth, termHeight);
    case 'picker':
      return renderPickerOverlay(overlay, termWidth, termHeight);
    case 'textarea':
      return renderTextareaOverlay(overlay, termWidth, termHeight);
    default:
      return {
        lines: [],
        width: 0,
        height: 0,
        top: 0,
        left: 0
      };
  }
}

function updateInputOverlay(overlay: InputOverlay, key: Keypress, text: string, submitOnEnter: boolean): OverlayUpdate {
  if (key.name === 'escape') {
    return { overlay: null, command: { type: 'cancel' } };
  }
  if (submitOnEnter && key.name === 'return') {
    if (overlay.validate) {
      const error = overlay.validate(overlay.value);
      if (error) {
        return { overlay: { ...overlay, error } };
      }
    }
    return { overlay: null, command: { type: 'submit', value: overlay.value } };
  }
  if (key.name === 'backspace') {
    const next = removeAt(overlay.value, overlay.cursor);
    return { overlay: { ...overlay, ...next, error: undefined } };
  }
  if (key.name === 'left') {
    return { overlay: { ...overlay, cursor: moveCursor(overlay.value, overlay.cursor, -1) } };
  }
  if (key.name === 'right') {
    return { overlay: { ...overlay, cursor: moveCursor(overlay.value, overlay.cursor, 1) } };
  }
  if (key.name === 'home') {
    return { overlay: { ...overlay, cursor: 0 } };
  }
  if (key.name === 'end') {
    return { overlay: { ...overlay, cursor: overlay.value.length } };
  }

  const char = getPrintableChar(text, key);
  if (char) {
    const next = insertAt(overlay.value, overlay.cursor, char);
    return { overlay: { ...overlay, ...next, error: undefined } };
  }

  return { overlay };
}

function updateTextareaOverlay(overlay: TextareaOverlay, key: Keypress, text: string): OverlayUpdate {
  if (key.name === 'escape') {
    return { overlay: null, command: { type: 'cancel' } };
  }
  if (key.ctrl && key.name === 's') {
    return { overlay: null, command: { type: 'submit', value: overlay.value } };
  }

  if (key.name === 'return') {
    const next = insertAt(overlay.value, overlay.cursor, '\n');
    return { overlay: { ...overlay, ...next } };
  }
  if (key.name === 'tab') {
    const next = insertAt(overlay.value, overlay.cursor, '  ');
    return { overlay: { ...overlay, ...next } };
  }
  if (key.name === 'backspace') {
    const next = removeAt(overlay.value, overlay.cursor);
    return { overlay: { ...overlay, ...next } };
  }
  if (key.name === 'left') {
    return { overlay: { ...overlay, cursor: moveCursor(overlay.value, overlay.cursor, -1) } };
  }
  if (key.name === 'right') {
    return { overlay: { ...overlay, cursor: moveCursor(overlay.value, overlay.cursor, 1) } };
  }
  if (key.name === 'up' || key.name === 'down') {
    const { line, col, lines } = findLineCol(overlay.value, overlay.cursor);
    const nextLine = key.name === 'up' ? Math.max(0, line - 1) : Math.min(lines.length - 1, line + 1);
    const cursor = lineColToCursor(lines, nextLine, col);
    return { overlay: { ...overlay, cursor } };
  }
  if (key.name === 'home') {
    const { lines, line } = findLineCol(overlay.value, overlay.cursor);
    const cursor = lineColToCursor(lines, line, 0);
    return { overlay: { ...overlay, cursor } };
  }
  if (key.name === 'end') {
    const { lines, line } = findLineCol(overlay.value, overlay.cursor);
    const cursor = lineColToCursor(lines, line, lines[line]?.length ?? 0);
    return { overlay: { ...overlay, cursor } };
  }

  const char = getPrintableChar(text, key);
  if (char) {
    const next = insertAt(overlay.value, overlay.cursor, char);
    return { overlay: { ...overlay, ...next } };
  }

  return { overlay };
}

function updateConfirmOverlay(overlay: ConfirmOverlay, key: Keypress, text: string): OverlayUpdate {
  const lower = text.toLowerCase();
  if (key.name === 'escape' || lower === 'n') {
    return { overlay: null, command: { type: 'cancel' } };
  }
  if (lower === 'y') {
    return { overlay: null, command: { type: 'submit' } };
  }
  if (key.name === 'left' || key.name === 'right' || key.name === 'tab') {
    const next = overlay.focused === 'cancel' ? 'confirm' : 'cancel';
    return { overlay: { ...overlay, focused: next } };
  }
  if (key.name === 'return') {
    if (overlay.focused === 'cancel') {
      return { overlay: null, command: { type: 'cancel' } };
    }
    return { overlay: null, command: { type: 'submit' } };
  }

  return { overlay };
}

function updatePickerOverlay(overlay: PickerOverlay, key: Keypress, text: string): OverlayUpdate {
  if (key.name === 'escape') {
    return { overlay: null, command: { type: 'cancel' } };
  }

  const filtered = filterPickerItems(overlay);

  if (key.name === 'return') {
    const selection = filtered[overlay.selectedIndex];
    if (!selection) {
      return { overlay };
    }
    return { overlay: null, command: { type: 'submit', selection } };
  }

  if (key.name === 'up') {
    const nextIndex = Math.max(0, overlay.selectedIndex - 1);
    return { overlay: { ...overlay, selectedIndex: nextIndex } };
  }
  if (key.name === 'down') {
    const nextIndex = Math.min(Math.max(0, filtered.length - 1), overlay.selectedIndex + 1);
    return { overlay: { ...overlay, selectedIndex: nextIndex } };
  }
  if (key.name === 'backspace') {
    const nextFilter = overlay.filter.slice(0, -1);
    return { overlay: { ...overlay, filter: nextFilter, selectedIndex: 0 } };
  }

  const char = getPrintableChar(text, key);
  if (char) {
    return { overlay: { ...overlay, filter: overlay.filter + char, selectedIndex: 0 } };
  }

  return { overlay };
}

export function updateOverlay(overlay: OverlayState, key: Keypress, text: string): OverlayUpdate {
  switch (overlay.kind) {
    case 'input':
      return updateInputOverlay(overlay, key, text, true);
    case 'inline-input':
      return updateInputOverlay(overlay, key, text, true);
    case 'textarea':
      return updateTextareaOverlay(overlay, key, text);
    case 'confirm':
      return updateConfirmOverlay(overlay, key, text);
    case 'picker':
      return updatePickerOverlay(overlay, key, text);
    default:
      return { overlay };
  }
}

export function applyOverlay(baseLines: string[], overlay: OverlayRender, width: number): string[] {
  const output = baseLines.slice();
  const totalWidth = Math.max(0, width);

  for (let i = 0; i < overlay.lines.length; i++) {
    const row = overlay.top + i;
    if (row < 0 || row >= output.length) continue;
    const base = padRight(output[row], totalWidth);
    const line = padRight(overlay.lines[i], overlay.width);
    const left = Math.max(0, overlay.left);
    const right = Math.min(totalWidth, left + overlay.width);
    const head = base.slice(0, left);
    const mid = line.slice(0, right - left);
    const tail = base.slice(right);
    output[row] = head + mid + tail;
  }

  return output;
}
