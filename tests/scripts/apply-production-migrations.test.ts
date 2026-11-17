import { describe, expect, it, vi } from 'vitest';
import { applyAdditiveMigrations } from '../../scripts/apply-production-migrations.mjs';

const ADDITIVE = 'ALTER TABLE t ADD COLUMN c INTEGER NOT NULL DEFAULT 0;';
const DESTRUCTIVE = 'DROP TABLE t;';

function harness({
  pending = [['0015_add.sql'], []],
  sql = { '0015_add.sql': ADDITIVE } as Record<string, string>,
  bookmark = 'bm-1' as string | undefined,
  applyOk = true,
} = {}) {
  const readPending = vi.fn();
  for (const value of pending) readPending.mockReturnValueOnce(value);
  const deps = {
    readPending,
    readSql: (file: string) => sql[file],
    bookmark: vi.fn(() => bookmark),
    apply: vi.fn(() => applyOk),
    log: vi.fn(),
  };
  return { deps, run: () => applyAdditiveMigrations(deps) };
}

describe('applyAdditiveMigrations', () => {
  it('records a restore point before applying additive migrations', () => {
    const { deps, run } = harness();
    expect(run()).toEqual({ applied: ['0015_add.sql'], bookmark: 'bm-1' });
    expect(deps.bookmark.mock.invocationCallOrder[0])
      .toBeLessThan(deps.apply.mock.invocationCallOrder[0]);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('--bookmark=bm-1'));
  });

  it('does nothing when no migrations are pending', () => {
    const { deps, run } = harness({ pending: [[]] });
    expect(run()).toEqual({ applied: [] });
    expect(deps.bookmark).not.toHaveBeenCalled();
    expect(deps.apply).not.toHaveBeenCalled();
  });

  it('refuses non-additive migrations without touching the database', () => {
    const { deps, run } = harness({
      pending: [['0015_add.sql', '0016_drop.sql']],
      sql: { '0015_add.sql': ADDITIVE, '0016_drop.sql': DESTRUCTIVE },
    });
    expect(run).toThrow('0016_drop.sql');
    expect(deps.bookmark).not.toHaveBeenCalled();
    expect(deps.apply).not.toHaveBeenCalled();
  });

  it('does not apply without a restore point', () => {
    const { deps, run } = harness({ bookmark: '' });
    expect(run).toThrow('restore point');
    expect(deps.apply).not.toHaveBeenCalled();
  });

  it('fails when the apply command fails or leaves migrations pending', () => {
    expect(harness({ applyOk: false }).run).toThrow('Applying production D1 migrations failed');
    expect(harness({ pending: [['0015_add.sql'], ['0015_add.sql']] }).run)
      .toThrow('still pending after apply');
  });
});
