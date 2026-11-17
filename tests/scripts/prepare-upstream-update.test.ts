import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temporaryPaths: string[] = [];
afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

describe('upstream update preparation', () => {
  it('keeps the installer Wrangler file while merging updated application code', () => {
    const root = mkdtempSync(join(tmpdir(), 'telegram-updater-'));
    temporaryPaths.push(root);
    const upstream = join(root, 'source');
    const installation = join(root, 'installation');
    mkdirSync(upstream);
    git(upstream, 'init', '-b', 'main');
    git(upstream, 'config', 'user.email', 'test@example.com');
    git(upstream, 'config', 'user.name', 'Test');
    writeFileSync(join(upstream, 'wrangler.jsonc'), '{"binding":"upstream"}\n');
    writeFileSync(join(upstream, 'app.ts'), 'export const version = 1;\n');
    git(upstream, 'add', '.');
    git(upstream, 'commit', '-m', 'initial');
    git(upstream, 'tag', 'v1.0.0');
    execFileSync('git', ['clone', upstream, installation], { stdio: 'ignore' });
    git(installation, 'config', 'user.email', 'installer@example.com');
    git(installation, 'config', 'user.name', 'Installer');
    writeFileSync(join(installation, 'wrangler.jsonc'), '{"binding":"installer-specific"}\n');
    git(installation, 'add', '.');
    git(installation, 'commit', '-m', 'provisioned resources');

    writeFileSync(join(upstream, 'wrangler.jsonc'), '{"binding":"new-default"}\n');
    writeFileSync(join(upstream, 'app.ts'), 'export const version = 2;\n');
    git(upstream, 'add', '.');
    git(upstream, 'commit', '-m', 'new release');
    git(upstream, 'tag', 'v1.1.0');

    execFileSync('bash', [join(process.cwd(), 'scripts/prepare-upstream-update.sh'), 'v1.1.0'], {
      cwd: installation,
      env: { ...process.env, UPSTREAM_REPOSITORY_URL: upstream },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(git(installation, 'branch', '--show-current')).toBe('updates/v1.1.0');
    expect(readFileSync(join(installation, 'wrangler.jsonc'), 'utf8'))
      .toBe('{"binding":"installer-specific"}\n');
    expect(readFileSync(join(installation, 'app.ts'), 'utf8')).toContain('version = 2');
    expect(git(installation, 'status', '--porcelain')).toBe('');
  });
});
