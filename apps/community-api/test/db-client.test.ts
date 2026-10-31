import { DrizzleQueryError } from 'drizzle-orm/errors';
import { describe, expect, it } from 'vitest';
import { describeDbError, retryOnConflict } from '../src/db/client';

function driverError(code: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`driver ${code}`), { name: 'PostgresError', code, ...extra });
}

describe('describeDbError', () => {
  it('keeps the driver error but drops the query and bound params', () => {
    const error = new DrizzleQueryError(
      'insert into t (email) values ($1)',
      ['secret@example.com'],
      driverError('23505', { constraint_name: 't_pkey' }),
    );
    const text = describeDbError(error);
    expect(text).toContain('23505');
    expect(text).toContain('t_pkey');
    expect(text).not.toContain('secret@example.com');
    expect(text).not.toContain('insert into');
  });

  it('passes other errors through as their message', () => {
    expect(describeDbError(new Error('boom'))).toBe('boom');
    expect(describeDbError('plain')).toBe('plain');
  });
});

describe('retryOnConflict', () => {
  it.each(['40P01', '40001'])(
    'retries once on SQLSTATE %s (wrapped in DrizzleQueryError)',
    async (code) => {
      let calls = 0;
      const result = await retryOnConflict(async () => {
        calls += 1;
        if (calls === 1) throw new DrizzleQueryError('q', [], driverError(code));
        return 'ok';
      });
      expect(result).toBe('ok');
      expect(calls).toBe(2);
    },
  );

  it('does not retry other errors, and retries at most once', async () => {
    let calls = 0;
    await expect(
      retryOnConflict(async () => {
        calls += 1;
        throw new DrizzleQueryError('q', [], driverError('23505'));
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);

    calls = 0;
    await expect(
      retryOnConflict(async () => {
        calls += 1;
        throw driverError('40P01');
      }),
    ).rejects.toThrow();
    expect(calls).toBe(2);
  });
});
