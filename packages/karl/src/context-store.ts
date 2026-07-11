import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

export interface ContextManifestFile {
  path: string;
  contentHash: string;
  reason?: string;
}

export interface ContextManifest {
  kind: 'karl.contextManifest';
  schemaVersion: 1;
  contextId: string;
  sourceProvider: string;
  createdAt: string;
  task: string;
  tokens: { budget: number; actual: number };
  selectedFiles: ContextManifestFile[];
  sourceHead: string;
  packContentPath: string;
  packContentHash: string;
  manifestHash: string;
}

export interface LegacyContextPack {
  kind: 'karl.legacyContextPack';
  schemaVersion: 1;
  legacy: true;
  contextId: string;
  task?: string;
  tokens?: { budget: number; actual: number };
  packContentPath: string;
  packContentHash: string;
}

export type ContextPack = ContextManifest | LegacyContextPack;

interface IvoMeta {
  id: string;
  task?: string;
  files?: number;
  tokens?: number;
  budget?: number;
  createdAt?: string;
  format?: 'xml' | 'markdown' | 'json';
}

const CONTEXT_ID = /^[a-f0-9]{7,64}$/;
const FORMAT_EXT: Record<string, string> = { xml: '.xml', markdown: '.md', json: '.json' };

export function hashContextContent(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

export function generateContextId(content: string): string {
  return hashContextContent(content).slice(0, 7);
}

export function getKarlContextsDir(cwd: string = process.cwd()): string {
  return path.join(cwd, '.karl', 'contexts');
}

export function getManifestPath(id: string, cwd: string = process.cwd()): string {
  assertContextId(id);
  return path.join(getKarlContextsDir(cwd), `${id}.manifest.json`);
}

export function getIvoContextsDir(cwd: string = process.cwd()): string {
  return path.join(cwd, '.ivo', 'contexts');
}

function assertContextId(id: string): void {
  if (!CONTEXT_ID.test(id)) throw new Error(`invalid context ID: ${id}`);
}

function normalizeRepoRelative(value: string, label: string): string {
  if (!value || path.isAbsolute(value) || value.includes('\\')) throw new Error(`${label} must be a repo-relative path: ${value}`);
  const normalized = path.posix.normalize(value);
  if (normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/')) {
    throw new Error(`${label} escapes the repository: ${value}`);
  }
  return normalized.replace(/^\.\//, '');
}

function canonicalManifest(value: Omit<ContextManifest, 'manifestHash'>): string {
  return JSON.stringify(value);
}

export function validateContextManifest(manifest: ContextManifest): void {
  if (manifest.kind !== 'karl.contextManifest' || manifest.schemaVersion !== 1) throw new Error('unsupported context manifest');
  assertContextId(manifest.contextId);
  if (!manifest.sourceProvider) throw new Error('context manifest requires a source provider');
  if (!Number.isFinite(manifest.tokens.budget) || !Number.isFinite(manifest.tokens.actual)) throw new Error('context manifest tokens must be numeric');
  normalizeRepoRelative(manifest.packContentPath, 'pack content path');
  const seen = new Set<string>();
  for (const file of manifest.selectedFiles) {
    const normalized = normalizeRepoRelative(file.path, 'selected file path');
    if (seen.has(normalized)) throw new Error(`duplicate selected file path: ${normalized}`);
    seen.add(normalized);
    if (!/^[a-f0-9]{64}$/.test(file.contentHash)) throw new Error(`invalid content hash for ${file.path}`);
  }
  const { manifestHash: _hash, ...withoutHash } = manifest;
  if (hashContextContent(canonicalManifest(withoutHash)) !== manifest.manifestHash) throw new Error('context manifest hash does not match its content');
}

function decodeXml(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

export function selectedFilesFromIvoXml(xml: string): Array<{ path: string; reason?: string }> {
  const files: Array<{ path: string; reason?: string }> = [];
  const regex = /<file\s+([^>]+)>/g;
  for (const match of xml.matchAll(regex)) {
    const attrs = match[1];
    const filePath = attrs.match(/(?:^|\s)path="([^"]+)"/);
    if (!filePath) continue;
    const reason = attrs.match(/(?:^|\s)reason="([^"]+)"/);
    files.push({ path: normalizeRepoRelative(decodeXml(filePath[1]), 'selected file path'), reason: reason ? decodeXml(reason[1]) : undefined });
  }
  return files;
}

async function readIvoMeta(id: string, cwd: string): Promise<IvoMeta | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(getIvoContextsDir(cwd), `${id}.meta.json`), 'utf8')) as IvoMeta;
  } catch {
    return null;
  }
}

async function resolveIvoContent(id: string, cwd: string): Promise<{ absolutePath: string; relativePath: string; content: string; meta: IvoMeta | null }> {
  assertContextId(id);
  const meta = await readIvoMeta(id, cwd);
  const extensions = [FORMAT_EXT[meta?.format ?? 'xml'] ?? '.xml', '.xml', '.md', '.json'];
  for (const extension of [...new Set(extensions)]) {
    const absolutePath = path.join(getIvoContextsDir(cwd), `${id}${extension}`);
    try {
      const content = await fs.readFile(absolutePath, 'utf8');
      return { absolutePath, relativePath: normalizeRepoRelative(path.relative(cwd, absolutePath).split(path.sep).join('/'), 'pack content path'), content, meta };
    } catch {
      // Try the next Ivo-supported format.
    }
  }
  throw new Error(`Ivo context content is missing for ${id}`);
}

function gitHead(cwd: string): string {
  const result = Bun.spawnSync(['git', '-C', cwd, 'rev-parse', 'HEAD'], { stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) throw new Error(`could not resolve source HEAD: ${result.stderr.toString().trim()}`);
  return result.stdout.toString().trim();
}

export async function createIvoContextManifest(
  id: string,
  cwd: string = process.cwd(),
  overrides: { task?: string; budget?: number; actualTokens?: number; createdAt?: string } = {}
): Promise<ContextManifest> {
  const pack = await resolveIvoContent(id, cwd);
  if (generateContextId(pack.content) !== id.slice(0, 7)) throw new Error(`Ivo context ID ${id} does not match pack content`);
  if (!pack.relativePath.endsWith('.xml')) throw new Error('Karl can only derive selected-file manifests from Ivo XML packs');
  const selected = selectedFilesFromIvoXml(pack.content);
  if ((pack.meta?.files ?? 0) > 0 && selected.length === 0) throw new Error(`Ivo pack ${id} did not expose its selected file identities`);
  const selectedFiles: ContextManifestFile[] = [];
  for (const entry of selected) {
    const source = await fs.readFile(path.join(cwd, entry.path));
    selectedFiles.push({ path: entry.path, contentHash: hashContextContent(source), reason: entry.reason });
  }
  const withoutHash: Omit<ContextManifest, 'manifestHash'> = {
    kind: 'karl.contextManifest', schemaVersion: 1, contextId: id, sourceProvider: 'ivo',
    createdAt: overrides.createdAt ?? pack.meta?.createdAt ?? new Date().toISOString(),
    task: overrides.task ?? pack.meta?.task ?? '',
    tokens: { budget: overrides.budget ?? pack.meta?.budget ?? 0, actual: overrides.actualTokens ?? pack.meta?.tokens ?? 0 },
    selectedFiles, sourceHead: gitHead(cwd), packContentPath: pack.relativePath,
    packContentHash: hashContextContent(pack.content),
  };
  const manifest: ContextManifest = { ...withoutHash, manifestHash: hashContextContent(canonicalManifest(withoutHash)) };
  return saveContextManifest(manifest, cwd);
}

export async function saveContextManifest(manifest: ContextManifest, cwd: string = process.cwd()): Promise<ContextManifest> {
  validateContextManifest(manifest);
  await fs.access(path.join(cwd, manifest.packContentPath));
  const manifestPath = getManifestPath(manifest.contextId, cwd);
  try {
    await fs.access(manifestPath);
    const existing = await loadContextManifest(manifest.contextId, cwd);
    if (!existing) throw new Error(`existing context manifest is invalid for ${manifest.contextId}`);
    if (existing.packContentHash !== manifest.packContentHash) throw new Error(`context manifest collision for ${manifest.contextId}`);
    return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  const tempPath = `${manifestPath}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  await fs.writeFile(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await fs.rename(tempPath, manifestPath);
  return manifest;
}

export async function loadContextManifest(id: string, cwd: string = process.cwd()): Promise<ContextManifest | null> {
  try {
    const manifest = JSON.parse(await fs.readFile(getManifestPath(id, cwd), 'utf8')) as ContextManifest;
    validateContextManifest(manifest);
    return manifest;
  } catch {
    return null;
  }
}

export async function loadContextPack(id: string, cwd: string = process.cwd()): Promise<ContextPack> {
  const manifest = await loadContextManifest(id, cwd);
  if (manifest) return manifest;
  try {
    await fs.access(getManifestPath(id, cwd));
    throw new Error(`context manifest is invalid for ${id}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const pack = await resolveIvoContent(id, cwd);
  return {
    kind: 'karl.legacyContextPack', schemaVersion: 1, legacy: true,
    contextId: id,
    task: pack.meta?.task,
    tokens: pack.meta ? { budget: pack.meta.budget ?? 0, actual: pack.meta.tokens ?? 0 } : undefined,
    packContentPath: pack.relativePath,
    packContentHash: hashContextContent(pack.content),
  };
}

export async function readContextContent(id: string, cwd: string = process.cwd()): Promise<string> {
  return (await resolveIvoContent(id, cwd)).content;
}

export interface ContextFileState extends ContextManifestFile {
  state: 'current' | 'stale' | 'missing';
  currentHash?: string;
}

export async function inspectContextPack(id: string, cwd: string = process.cwd()): Promise<ContextPack & { fileStates?: ContextFileState[] }> {
  const pack = await loadContextPack(id, cwd);
  if (pack.kind !== 'karl.contextManifest') return pack;
  const fileStates: ContextFileState[] = [];
  for (const file of pack.selectedFiles) {
    try {
      const currentHash = hashContextContent(await fs.readFile(path.join(cwd, file.path)));
      fileStates.push({ ...file, currentHash, state: currentHash === file.contentHash ? 'current' : 'stale' });
    } catch {
      fileStates.push({ ...file, state: 'missing' });
    }
  }
  return { ...pack, fileStates };
}

export interface ContextManifestDiff {
  kind: 'karl.contextDiff';
  version: 1;
  oldId: string;
  newId: string;
  added: ContextManifestFile[];
  removed: ContextManifestFile[];
  changed: Array<{ path: string; oldHash: string; newHash: string }>;
}

export async function diffContextManifests(oldId: string, newId: string, cwd: string = process.cwd()): Promise<ContextManifestDiff> {
  const oldManifest = await loadContextManifest(oldId, cwd);
  const newManifest = await loadContextManifest(newId, cwd);
  if (!oldManifest || !newManifest) throw new Error('context diff requires two non-legacy manifests');
  const oldFiles = new Map(oldManifest.selectedFiles.map((file) => [file.path, file]));
  const newFiles = new Map(newManifest.selectedFiles.map((file) => [file.path, file]));
  const added = [...newFiles.values()].filter((file) => !oldFiles.has(file.path)).sort((a, b) => a.path.localeCompare(b.path));
  const removed = [...oldFiles.values()].filter((file) => !newFiles.has(file.path)).sort((a, b) => a.path.localeCompare(b.path));
  const changed = [...newFiles.values()].filter((file) => oldFiles.has(file.path) && oldFiles.get(file.path)!.contentHash !== file.contentHash)
    .map((file) => ({ path: file.path, oldHash: oldFiles.get(file.path)!.contentHash, newHash: file.contentHash }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return { kind: 'karl.contextDiff', version: 1, oldId, newId, added, removed, changed };
}
