import path from 'path';
import { promises as fs } from 'fs';

export type WorkspaceOperation = 'Bash working directory' | 'Writing' | 'Editing';

export interface WorkspacePolicy {
  root: string;
  protectedPaths: string[];
}

async function canonicalizeExistingAncestor(inputPath: string): Promise<string> {
  const absolute = path.resolve(inputPath);
  const missing: string[] = [];
  let candidate = absolute;

  while (true) {
    try {
      const canonical = await fs.realpath(candidate);
      return path.join(canonical, ...missing.reverse());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        throw error;
      }
      const parent = path.dirname(candidate);
      if (parent === candidate) {
        throw new Error(`Unable to canonicalize path: ${inputPath}`);
      }
      missing.push(path.basename(candidate));
      candidate = parent;
    }
  }
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function isProtectedEnvironmentFile(candidate: string, root: string): boolean {
  if (path.dirname(candidate) !== root) return false;
  const name = path.basename(candidate);
  return name === '.env' || name.startsWith('.env.');
}

export async function createWorkspacePolicy(cwd: string): Promise<WorkspacePolicy> {
  let root: string;
  try {
    root = await fs.realpath(path.resolve(cwd));
  } catch {
    throw new Error(`Workspace directory does not exist or cannot be canonicalized: ${cwd}`);
  }

  return {
    root,
    protectedPaths: [path.join(root, '.git'), path.join(root, '.karl'), path.join(root, '.env')]
  };
}

export async function resolveWorkspacePath(
  inputPath: string,
  policy: WorkspacePolicy,
  operation: WorkspaceOperation,
  options: { protect?: boolean } = {}
): Promise<string> {
  const absolute = path.isAbsolute(inputPath) ? inputPath : path.join(policy.root, inputPath);
  const canonical = await canonicalizeExistingAncestor(absolute);

  if (!isWithin(canonical, policy.root)) {
    throw new Error(
      `${operation} outside working directory is not allowed: ${inputPath}\n` +
      'Use --unrestricted to bypass this check.'
    );
  }

  if (options.protect) {
    const protectedPath = policy.protectedPaths.find((entry) => isWithin(canonical, entry));
    if (protectedPath || isProtectedEnvironmentFile(canonical, policy.root)) {
      throw new Error(
        `${operation} protected workspace path is not allowed: ${inputPath}\n` +
        'Use --unrestricted to bypass this check.'
      );
    }
  }

  return canonical;
}
