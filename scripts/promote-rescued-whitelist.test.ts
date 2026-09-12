import { describe, expect, it } from 'vitest';
import { planEntries } from './promote-rescued-whitelist.mjs';

describe('抢救名单 → 推荐白名单候选', () => {
  it('生成公开问责 note：票数/净票/快照版本齐全，handle 归一小写', () => {
    const entries = planEntries({
      snapshot_version: '2026.09.12.2',
      whitelist: {
        verified: [
          { handle: 'Rescued_OK', net_votes: 4, rescue_count: 6, report_count: 2 },
          { handle: 'skip_me' }, // 只有 handle 没有票：不生成无效净票文案
        ],
      },
    });
    expect(entries).toEqual([
      {
        handle: 'rescued_ok',
        note: '社区抢救入册：6 票共识推翻误标（净票 +4 · 快照 2026.09.12.2）',
      },
      { handle: 'skip_me', note: '社区抢救入册：0 票共识推翻误标（净票 +0 · 快照 2026.09.12.2）' },
    ]);
  });

  it('非法 handle 拒收', () => {
    const entries = planEntries({
      whitelist: { verified: [{ handle: 'ok handle!', net_votes: 3, rescue_count: 3 }] },
    });
    expect(entries).toEqual([]);
  });
});
