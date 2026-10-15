import { execFile, spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execFile);
export interface GrokProcessIdentity { pid: number; parent: number; group: number; started: string }

export function parseGrokProcessTable(text: string): GrokProcessIdentity[] {
  return text.split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    return match ? [{ pid: Number(match[1]), parent: Number(match[2]), group: Number(match[3]), started: match[4] }] : [];
  });
}

export function grokDescendants(table: GrokProcessIdentity[], root: number): GrokProcessIdentity[] {
  const owned = new Set([root]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of table) if (owned.has(process.parent) && !owned.has(process.pid)) { owned.add(process.pid); changed = true; }
  }
  return table.filter(process => owned.has(process.pid));
}

/** Native Grok shells start their own sessions, so a root group kill is insufficient. */
export class GrokProcessScope {
  private identities = new Map<number, GrokProcessIdentity>();
  private timer: NodeJS.Timeout | undefined;
  private scanning: Promise<GrokProcessIdentity[]> | null = null;
  private stopped = false;

  constructor(private process: ChildProcess) {}

  watch(): void {
    if (this.stopped || this.timer || process.platform === 'win32') return;
    void this.scan();
    this.timer = setInterval(() => { void this.scan(); }, 500);
    this.timer.unref();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    const pid = this.process.pid;
    if (!pid) return;
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
      killer.on('error', () => { this.process.kill(); });
      return;
    }
    void this.scan().then(table => {
      this.signal(table, 'SIGTERM');
      const escalation = setTimeout(() => {
        void this.scan().then(current => this.signal(current, 'SIGKILL'));
      }, 2_000);
      escalation.unref();
    });
  }

  private signal(table: GrokProcessIdentity[], signal: NodeJS.Signals): void {
    const alive = table.filter(process => this.identities.get(process.pid)?.started === process.started);
    const groups = new Set<number>();
    for (const process of alive) {
      // Only groups led by an owned process, or the CLI's own detached group.
      if (process.group === this.process.pid || alive.some(owner => owner.pid === process.group)) groups.add(process.group);
    }
    for (const group of groups) { try { process.kill(-group, signal); } catch { /* group exited */ } }
    for (const child of alive) { try { process.kill(child.pid, signal); } catch { /* process exited */ } }
  }

  private scan(): Promise<GrokProcessIdentity[]> {
    if (this.scanning) return this.scanning;
    this.scanning = exec('ps', ['-axo', 'pid=,ppid=,pgid=,lstart='], { timeout: 2_000, maxBuffer: 8 * 1024 * 1024 })
      .then(({ stdout }) => {
        const table = parseGrokProcessTable(stdout);
        const root = table.find(process => process.pid === this.process.pid);
        const previous = this.identities.get(this.process.pid!);
        const rootAlive = this.process.exitCode === null && this.process.signalCode === null;
        if (rootAlive && root && (!previous || previous.started === root.started)) {
          for (const child of grokDescendants(table, this.process.pid!)) this.identities.set(child.pid, child);
        }
        return table;
      })
      .catch(() => {
        // Preserve the root containment path if process enumeration fails.
        if (this.stopped && this.process.exitCode === null && this.process.signalCode === null) {
          try { process.kill(-this.process.pid!, 'SIGKILL'); } catch { /* already exited */ }
        }
        return [];
      })
      .finally(() => { this.scanning = null; });
    return this.scanning;
  }
}
