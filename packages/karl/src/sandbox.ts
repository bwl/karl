/**
 * Process-level sandboxing for restricted bash execution.
 *
 * Restricted execution fails closed when the required OS facility is absent or
 * unusable. Only the explicit unrestricted mode disables this layer.
 */

import { spawnSync } from 'child_process';
import { existsSync, realpathSync, readdirSync } from 'fs';
import path from 'path';

export interface SandboxPolicy {
  /** Paths that can be written to (cwd is always included by the default policy). */
  writablePaths: string[];
  /** Allow network access (default: true). */
  network: boolean;
  /** Paths to protect from writes even within writable roots. */
  protectedPaths: string[];
  /** Path prefixes to protect. Bubblewrap can enforce existing matches only. */
  protectedPathPrefixes: string[];
}

export interface SandboxResult {
  sandboxed: boolean;
  command: string[];
  warning?: string;
}

export type SandboxPlatform = 'macos' | 'linux' | 'unsupported';

export function detectPlatform(): SandboxPlatform {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'linux') return 'linux';
  return 'unsupported';
}

let bwrapAvailability: { available: boolean; message?: string } | null = null;
let seatbeltAvailability: { available: boolean; message?: string } | null = null;

function getSeatbeltAvailability(): { available: boolean; message?: string } {
  if (seatbeltAvailability) return seatbeltAvailability;
  if (!existsSync('/usr/bin/sandbox-exec')) {
    seatbeltAvailability = { available: false, message: 'macOS sandbox-exec is unavailable.' };
    return seatbeltAvailability;
  }

  const probe = spawnSync('/usr/bin/sandbox-exec', ['-p', '(version 1) (allow default)', '--', '/usr/bin/true'], {
    stdio: 'pipe',
  });
  if (probe.status === 0) {
    seatbeltAvailability = { available: true };
  } else {
    const detail = probe.stderr?.toString().trim();
    seatbeltAvailability = {
      available: false,
      message: `macOS sandbox-exec is present but unusable${detail ? `: ${detail}` : '.'}`,
    };
  }
  return seatbeltAvailability;
}

function getBwrapAvailability(): { available: boolean; message?: string } {
  if (bwrapAvailability) return bwrapAvailability;

  // A version check is insufficient: containers commonly install bwrap while
  // denying the user namespaces it needs. Probe the minimum real sandbox.
  const probe = spawnSync('bwrap', [
    '--ro-bind', '/', '/',
    '--dev', '/dev',
    '--proc', '/proc',
    '--unshare-user',
    '--unshare-pid',
    '--die-with-parent',
    '--', '/bin/true',
  ], { stdio: 'pipe' });

  if (probe.error && (probe.error as NodeJS.ErrnoException).code === 'ENOENT') {
    bwrapAvailability = {
      available: false,
      message: 'bubblewrap (bwrap) was not found. Install it (for example: apt install bubblewrap).',
    };
  } else if (probe.status !== 0) {
    const detail = probe.stderr?.toString().trim();
    bwrapAvailability = {
      available: false,
      message: `bubblewrap is installed but cannot create the required namespaces${detail ? `: ${detail}` : '.'}`,
    };
  } else {
    bwrapAvailability = { available: true };
  }

  return bwrapAvailability;
}

function canonicalize(input: string): string {
  try {
    return realpathSync(input);
  } catch {
    return path.resolve(input);
  }
}

export function createDefaultPolicy(cwd: string): SandboxPolicy {
  const root = canonicalize(cwd);
  const temporaryPaths = [process.env.TMPDIR || '/tmp', '/tmp', '/var/tmp'].map(canonicalize);

  return {
    writablePaths: [...new Set([root, ...temporaryPaths])],
    network: true,
    protectedPaths: [
      path.join(root, '.git'),
      path.join(root, '.karl'),
      path.join(root, '.env'),
    ],
    protectedPathPrefixes: [path.join(root, '.env.')],
  };
}

const SEATBELT_BASE_POLICY = `(version 1)

(deny default)
(allow process-exec)
(allow process-fork)
(allow signal (target same-sandbox))
(allow user-preference-read)
(allow process-info* (target same-sandbox))
(allow file-write-data
  (require-all
    (path "/dev/null")
    (vnode-type CHARACTER-DEVICE)))
(allow sysctl-read)
(allow iokit-open)
(allow mach-lookup)
(allow pseudo-tty)
(allow file-read* file-write* file-ioctl (literal "/dev/ptmx"))
(allow file-read* file-write* (regex #"^/dev/ttys[0-9]+"))
(allow file-ioctl (regex #"^/dev/ttys[0-9]+"))
(allow ipc-posix-sem)
(allow ipc-posix-shm)
`;

function seatbeltLiteral(value: string): string {
  return JSON.stringify(value);
}

function seatbeltRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&').replace(/"/g, '\\"');
}

export function createSeatbeltPolicy(policy: SandboxPolicy): string {
  const writable = policy.writablePaths
    .map(entry => `(subpath ${seatbeltLiteral(canonicalize(entry))})`)
    .join('\n    ');
  const denied = [
    ...policy.protectedPaths.map(entry => `(subpath ${seatbeltLiteral(canonicalize(entry))})`),
    ...policy.protectedPathPrefixes.map(entry => `(regex #"^${seatbeltRegex(canonicalize(entry))}.*")`),
  ].join('\n    ');

  return [
    SEATBELT_BASE_POLICY,
    '; Allow reading files globally\n(allow file-read*)\n',
    writable ? `; Allow writing to specified paths\n(allow file-write*\n    ${writable}\n)\n` : '',
    denied ? `; Protected workspace paths override writable roots\n(deny file-write*\n    ${denied}\n)\n` : '',
    policy.network ? '; Allow network access\n(allow network*)\n(allow system-socket)\n' : '',
  ].join('\n');
}

export function wrapWithSeatbelt(command: string[], policy: SandboxPolicy): string[] {
  return ['/usr/bin/sandbox-exec', '-p', createSeatbeltPolicy(policy), '--', ...command];
}

function existingPrefixMatches(prefix: string): string[] {
  const parent = path.dirname(prefix);
  const basename = path.basename(prefix);
  try {
    return readdirSync(parent)
      .filter(name => name.startsWith(basename))
      .map(name => path.join(parent, name));
  } catch {
    return [];
  }
}

export function wrapWithBwrap(command: string[], cwd: string, policy: SandboxPolicy): string[] {
  const args = ['bwrap', '--ro-bind', '/', '/'];

  for (const entry of policy.writablePaths) {
    if (existsSync(entry)) args.push('--bind', entry, entry);
  }

  // Later mounts override writable parent mounts. Bubblewrap cannot reserve a
  // nonexistent path, so future .env.* names cannot be protected on Linux.
  const protectedPaths = [
    ...policy.protectedPaths,
    ...policy.protectedPathPrefixes.flatMap(existingPrefixMatches),
  ];
  for (const entry of [...new Set(protectedPaths)]) {
    if (existsSync(entry)) args.push('--ro-bind', entry, entry);
  }

  args.push('--dev', '/dev', '--proc', '/proc', '--chdir', cwd);
  args.push('--unshare-user', '--unshare-pid', '--unshare-uts', '--unshare-cgroup');
  if (!policy.network) args.push('--unshare-net');
  args.push('--die-with-parent', '--', ...command);
  return args;
}

export function sandboxCommand(
  command: string[],
  cwd: string,
  policy?: Partial<SandboxPolicy>
): SandboxResult {
  const defaults = createDefaultPolicy(cwd);
  const fullPolicy: SandboxPolicy = {
    ...defaults,
    ...policy,
    // Callers may add protection but cannot remove the restricted defaults.
    protectedPaths: [...new Set([...defaults.protectedPaths, ...(policy?.protectedPaths ?? [])])],
    protectedPathPrefixes: [...new Set([
      ...defaults.protectedPathPrefixes,
      ...(policy?.protectedPathPrefixes ?? []),
    ])],
  };

  switch (detectPlatform()) {
    case 'macos': {
      const availability = getSeatbeltAvailability();
      if (availability.available) {
        return { sandboxed: true, command: wrapWithSeatbelt(command, fullPolicy) };
      }
      return { sandboxed: false, command, warning: availability.message };
    }

    case 'linux': {
      const availability = getBwrapAvailability();
      if (availability.available) {
        return { sandboxed: true, command: wrapWithBwrap(command, cwd, fullPolicy) };
      }
      return { sandboxed: false, command, warning: availability.message };
    }

    case 'unsupported':
      return {
        sandboxed: false,
        command,
        warning: `Sandboxing is not supported on ${process.platform}.`,
      };
  }
}

export function isSandboxAvailable(): {
  available: boolean;
  platform: SandboxPlatform;
  message?: string;
} {
  const platform = detectPlatform();
  if (platform === 'macos') return { ...getSeatbeltAvailability(), platform };
  if (platform === 'linux') return { ...getBwrapAvailability(), platform };
  return { available: false, platform, message: `Sandboxing is not supported on ${process.platform}.` };
}
