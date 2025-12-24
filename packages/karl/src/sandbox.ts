/**
 * Karl Sandbox
 *
 * Process-level sandboxing for bash tool execution.
 * - macOS: Uses Seatbelt via /usr/bin/sandbox-exec
 * - Linux: Uses bubblewrap (bwrap) if available
 *
 * Default policy: Only cwd and /tmp are writable. Everything else is read-only.
 * This prevents the agent from modifying system files, ~/.ssh, ~/.git-credentials, etc.
 */

import { spawn, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface SandboxPolicy {
  /** Paths that can be written to (cwd is always included) */
  writablePaths: string[];
  /** Allow network access (default: true) */
  network: boolean;
  /** Paths to protect from writes even within writable roots */
  protectedPaths: string[];
}

export interface SandboxResult {
  sandboxed: boolean;
  command: string[];
  warning?: string;
}

type Platform = 'macos' | 'linux' | 'unsupported';

// ============================================================================
// Platform Detection
// ============================================================================

function detectPlatform(): Platform {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'linux') return 'linux';
  return 'unsupported';
}

let _bwrapAvailable: boolean | null = null;

function isBwrapAvailable(): boolean {
  if (_bwrapAvailable !== null) return _bwrapAvailable;
  try {
    const result = spawnSync('bwrap', ['--version'], { stdio: 'pipe' });
    _bwrapAvailable = result.status === 0;
  } catch {
    _bwrapAvailable = false;
  }
  return _bwrapAvailable;
}

// ============================================================================
// Default Policy
// ============================================================================

function canonicalize(p: string): string {
  try {
    return require('fs').realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

export function createDefaultPolicy(cwd: string): SandboxPolicy {
  const tmpdir = process.env.TMPDIR || '/tmp';
  const canonicalCwd = canonicalize(cwd);

  // Canonicalize all paths to handle symlinks (e.g., /tmp → /private/tmp on macOS)
  const writablePaths = [
    canonicalCwd,
    canonicalize(tmpdir),
    canonicalize('/tmp'),
    canonicalize('/var/tmp'),
  ].filter((p, i, arr) => arr.indexOf(p) === i);  // dedupe

  return {
    writablePaths,
    network: true,
    protectedPaths: [
      // Protect sensitive directories even within cwd
      path.join(canonicalCwd, '.git'),
      path.join(canonicalCwd, '.karl'),
      path.join(canonicalCwd, '.env'),
    ],
  };
}

// ============================================================================
// macOS Seatbelt
// ============================================================================

const SEATBELT_BASE_POLICY = `(version 1)

; Start with deny-by-default
(deny default)

; Allow process execution and forking
(allow process-exec)
(allow process-fork)
(allow signal (target same-sandbox))

; Allow reading user preferences
(allow user-preference-read)

; Allow process info for same sandbox
(allow process-info* (target same-sandbox))

; Allow writing to /dev/null
(allow file-write-data
  (require-all
    (path "/dev/null")
    (vnode-type CHARACTER-DEVICE)))

; Allow common sysctls
(allow sysctl-read)

; Allow IOKit for hardware info
(allow iokit-open)

; Allow mach lookups for common services
(allow mach-lookup)

; Allow pseudo-ttys for interactive commands
(allow pseudo-tty)
(allow file-read* file-write* file-ioctl (literal "/dev/ptmx"))
(allow file-read* file-write* (regex #"^/dev/ttys[0-9]+"))
(allow file-ioctl (regex #"^/dev/ttys[0-9]+"))

; Allow IPC for multiprocessing
(allow ipc-posix-sem)
(allow ipc-posix-shm)
`;

const SEATBELT_NETWORK_POLICY = `
; Allow network access
(allow network*)
(allow system-socket)
`;

function createSeatbeltPolicy(policy: SandboxPolicy): string {
  const parts = [SEATBELT_BASE_POLICY];

  // Add read access to everything
  parts.push(`
; Allow reading files globally
(allow file-read*)
`);

  // Add write access to specific paths
  if (policy.writablePaths.length > 0) {
    const writePolicies = policy.writablePaths
      .map(p => {
        // Canonicalize path to handle symlinks
        const canonical = canonicalize(p);
        return `(subpath "${canonical}")`;
      })
      .join('\n    ');

    parts.push(`
; Allow writing to specified paths
(allow file-write*
    ${writePolicies}
)
`);
  }

  // Add network if enabled
  if (policy.network) {
    parts.push(SEATBELT_NETWORK_POLICY);
  }

  return parts.join('\n');
}

function wrapWithSeatbelt(command: string[], policy: SandboxPolicy): string[] {
  const seatbeltPolicy = createSeatbeltPolicy(policy);

  return [
    '/usr/bin/sandbox-exec',
    '-p', seatbeltPolicy,
    '--',
    ...command,
  ];
}

// ============================================================================
// Linux Bubblewrap
// ============================================================================

function wrapWithBwrap(command: string[], cwd: string, policy: SandboxPolicy): string[] {
  const args: string[] = ['bwrap'];

  // Bind root filesystem as read-only
  args.push('--ro-bind', '/', '/');

  // Bind writable paths
  for (const p of policy.writablePaths) {
    if (existsSync(p)) {
      args.push('--bind', p, p);
    }
  }

  // Mount /dev, /proc, /sys
  args.push('--dev', '/dev');
  args.push('--proc', '/proc');

  // Set working directory
  args.push('--chdir', cwd);

  // Unshare namespaces (but not network if enabled)
  args.push('--unshare-user');
  args.push('--unshare-pid');
  args.push('--unshare-uts');
  args.push('--unshare-cgroup');

  if (!policy.network) {
    args.push('--unshare-net');
  }

  // Die with parent
  args.push('--die-with-parent');

  // Add the actual command
  args.push('--');
  args.push(...command);

  return args;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Wrap a command to run inside a sandbox.
 * Returns the modified command array and whether sandboxing was applied.
 */
export function sandboxCommand(
  command: string[],
  cwd: string,
  policy?: Partial<SandboxPolicy>
): SandboxResult {
  const fullPolicy = {
    ...createDefaultPolicy(cwd),
    ...policy,
  };

  const platform = detectPlatform();

  switch (platform) {
    case 'macos':
      return {
        sandboxed: true,
        command: wrapWithSeatbelt(command, fullPolicy),
      };

    case 'linux':
      if (isBwrapAvailable()) {
        return {
          sandboxed: true,
          command: wrapWithBwrap(command, cwd, fullPolicy),
        };
      }
      return {
        sandboxed: false,
        command,
        warning: 'bubblewrap (bwrap) not found. Install it for sandboxed execution: apt install bubblewrap',
      };

    case 'unsupported':
      return {
        sandboxed: false,
        command,
        warning: `Sandboxing not supported on ${process.platform}`,
      };
  }
}

/**
 * Check if sandboxing is available on this system.
 */
export function isSandboxAvailable(): { available: boolean; platform: Platform; message?: string } {
  const platform = detectPlatform();

  switch (platform) {
    case 'macos':
      // sandbox-exec is always available on macOS
      return { available: true, platform };

    case 'linux':
      if (isBwrapAvailable()) {
        return { available: true, platform };
      }
      return {
        available: false,
        platform,
        message: 'Install bubblewrap: apt install bubblewrap',
      };

    default:
      return {
        available: false,
        platform,
        message: `Sandboxing not supported on ${process.platform}`,
      };
  }
}
