/**
 * 白名单发布链单一实现（scripts/lib/whitelist-schema.mjs）的测试：
 * 行式 YAML 解析（原 publish-community-whitelist.sh 内嵌 Python 的忠实移植）
 * + 规则校验 + SQL 生成（固定 now/stamp 的逐字节快照）。
 */
import { describe, expect, it } from 'vitest';
import {
  AVATAR_PREFIX,
  epochSeconds,
  generateWhitelistSql,
  parseWhitelistYaml,
  utcIsoStamp,
} from './whitelist-schema.mjs';

const FIXED_NOW = 1789261042;
const FIXED_STAMP = '2026-09-13T00:57:22.276295+00:00';

// 发布解析器按 name -> avatar_url -> note -> x_user_id 顺序吸收字段，
// 跳过中间字段会中断吸收（怪点），空值行用于推进指针。
const chainBlock = (
  handle: string,
  note: string,
  extra: { name?: string; avatar?: string; id?: string } = {},
) =>
  [
    `  - handle: ${handle}`,
    `    name: "${extra.name ?? ''}"`,
    `    avatar_url: "${extra.avatar ?? ''}"`,
    `    note: "${note}"`,
    ...(extra.id ? [`    x_user_id: "${extra.id}"`] : []),
  ].join('\n');

const yamlOf = (...blocks: string[]) => `schema_version: 1\nentries:\n${blocks.join('\n')}\n`;

describe('parseWhitelistYaml', () => {
  it('合法 YAML：全字段条目 + 空值行推进指针的省缺条目，line 指向 - handle: 行', () => {
    const { entries, errors } = parseWhitelistYaml(
      yamlOf(
        [
          '  - handle: "Kosx_Note"',
          '    name: "子扬"',
          `    avatar_url: "${AVATAR_PREFIX}123/x_400x400.jpg"`,
          '    note: "01 年小镇做题家 🌍"',
          '    x_user_id: "4848269835"',
        ].join('\n'),
        chainBlock('plain', '只有 handle 和 note'),
      ),
    );
    expect(errors).toEqual([]);
    expect(entries).toEqual([
      {
        handle: 'Kosx_Note',
        name: '子扬',
        avatar_url: `${AVATAR_PREFIX}123/x_400x400.jpg`,
        note: '01 年小镇做题家 🌍',
        x_user_id: '4848269835',
        line: 3,
      },
      {
        handle: 'plain',
        note: '只有 handle 和 note',
        name: null,
        avatar_url: null,
        x_user_id: null,
        line: 8,
      },
    ]);
  });

  it('CRLF 行尾照常解析', () => {
    const { entries, errors } = parseWhitelistYaml(
      yamlOf(chainBlock('crlf_user', '回车换行也能解析')).replaceAll('\n', '\r\n'),
    );
    expect(errors).toEqual([]);
    expect(entries.map((e) => e.handle)).toEqual(['crlf_user']);
  });

  it('字段顺序固定：期望顺序之外的行触发「缺少 note」+「期望新的」级联，行号精确', () => {
    const { errors } = parseWhitelistYaml(
      [
        'schema_version: 1',
        'entries:',
        '  - handle: wrongorder',
        '    note: "先出现的 note"',
        '    name: "后出现的名字"',
      ].join('\n'),
    );
    expect(errors).toEqual([
      `3: 条目 'wrongorder' 缺少 note（字段顺序: - handle: / name: / avatar_url: / note: / x_user_id:）`,
      `4: 期望新的 "- handle:" 条目，实际 'note: "先出现的 note"'`,
      `5: 期望新的 "- handle:" 条目，实际 'name: "后出现的名字"'`,
      '3: note 需 4-240 字（当前 0）',
    ]);
  });

  it('重复 handle（lower 后）指向后者行号', () => {
    const { errors } = parseWhitelistYaml(
      yamlOf(chainBlock('Alice_01', '第一条合法 note'), chainBlock('alice_01', '第二条合法 note')),
    );
    expect(errors).toEqual(['7: handle 重复: @alice_01']);
  });

  it('非法 handle（字符集/长度）报原始大小写', () => {
    expect(parseWhitelistYaml(yamlOf(chainBlock('bad-handle!', '合法长度的 note'))).errors).toEqual(
      ["3: handle 非法: 'bad-handle!'"],
    );
    expect(
      parseWhitelistYaml(yamlOf(chainBlock('a1234567890123456', '合法长度的 note'))).errors,
    ).toEqual(["3: handle 非法: 'a1234567890123456'"]);
  });

  it('note 长度按 Unicode 码点计数（emoji 记 1）：240 贴上限通过，241 报错', () => {
    expect(
      parseWhitelistYaml(yamlOf(chainBlock('ok_user', 'a'.repeat(238) + '🚀🚀'))).errors,
    ).toEqual([]);
    expect(
      parseWhitelistYaml(yamlOf(chainBlock('ok_user', 'a'.repeat(239) + '🚀🚀'))).errors,
    ).toEqual(['3: note 需 4-240 字（当前 241）']);
    expect(parseWhitelistYaml(yamlOf(chainBlock('ok_user', '太短'))).errors).toEqual([
      '3: note 需 4-240 字（当前 2）',
    ]);
  });

  it('avatar_url 只看前缀：坏域拒绝，裸前缀放行（Python 原样怪点）', () => {
    expect(
      parseWhitelistYaml(
        yamlOf(
          chainBlock('ok_user', '合法长度的 note', { avatar: 'https://evil.example/pic.jpg' }),
        ),
      ).errors,
    ).toEqual(["3: avatar_url 必须是 pbs.twimg.com 公开头像: 'https://evil.example/pic.jpg'"]);
    expect(
      parseWhitelistYaml(
        yamlOf(chainBlock('ok_user', '合法长度的 note', { avatar: AVATAR_PREFIX })),
      ).errors,
    ).toEqual([]);
  });

  it('x_user_id：非数字拒绝；全角数字通过（Python \\d == Unicode Nd，原样保留）', () => {
    expect(
      parseWhitelistYaml(yamlOf(chainBlock('ok_user', '合法长度的 note', { id: '12ab' }))).errors,
    ).toEqual(["3: x_user_id 非法: '12ab'"]);
    expect(
      parseWhitelistYaml(yamlOf(chainBlock('ok_user', '合法长度的 note', { id: '１２３' }))).errors,
    ).toEqual([]);
  });

  it('未知顶层字段拒绝；schema_version/updated_at 白名单放行', () => {
    expect(parseWhitelistYaml('schema_version: 1\nfoo: bar\nentries: []\n').errors).toEqual([
      "2: 未知顶层字段 'foo: bar'",
    ]);
    expect(parseWhitelistYaml('schema_version: 1\nupdated_at: 2026-09-13\nentries: []\n')).toEqual({
      entries: [],
      errors: [],
    });
  });
});

describe('generateWhitelistSql', () => {
  it("note/name 单引号转义 ''，x_user_id 引用、空选填字段写 NULL", () => {
    const { entries } = parseWhitelistYaml(
      yamlOf(
        chainBlock('quotey', "it's a 'quoted' note", {
          name: "O'Brien's Lab",
          avatar: `${AVATAR_PREFIX}123/x.jpg`,
          id: '42',
        }),
      ),
    );
    const sql = generateWhitelistSql(entries, {
      now: FIXED_NOW,
      stamp: FIXED_STAMP,
      sourceFile: 'community/lists/whitelist.yaml',
    });
    expect(sql).toContain("'O''Brien''s Lab'");
    expect(sql).toContain("'it''s a ''quoted'' note'");
    expect(sql).toContain("VALUES ('update', 'quotey', 'it''s a ''quoted'' note', 1789261042)");
  });

  it('空名单只输出头注释 + 全量撤销 + 审计', () => {
    const sql = generateWhitelistSql([], {
      now: FIXED_NOW,
      stamp: FIXED_STAMP,
      sourceFile: 'community/lists/whitelist.yaml',
    });
    expect(sql).toMatchInlineSnapshot(`
      "-- generated by publish-community-whitelist.sh from community/lists/whitelist.yaml
      -- 0 entries · 2026-09-13T00:57:22.276295+00:00 · 文件为唯一事实，先全量撤销再 upsert
      UPDATE maintainer_whitelist SET active = 0, updated_at = 1789261042 WHERE active = 1;
      INSERT INTO maintainer_whitelist_audit (action, handle, note, created_at) SELECT 'remove', handle, note, 1789261042 FROM maintainer_whitelist WHERE active = 0 AND updated_at = 1789261042;
      "
    `);
  });

  it('全字段 + 省缺字段条目的 SQL 快照（固定 now/stamp；已与原 Python 输出逐字节对拍）', () => {
    const { entries, errors } = parseWhitelistYaml(
      yamlOf(
        [
          '  - handle: "Kosx_Note"',
          '    name: "子扬"',
          `    avatar_url: "${AVATAR_PREFIX}123/x_400x400.jpg"`,
          '    note: "01 年小镇做题家 🌍"',
          '    x_user_id: "4848269835"',
        ].join('\n'),
        chainBlock('plain', '只有 handle 和 note'),
      ),
    );
    expect(errors).toEqual([]);
    const sql = generateWhitelistSql(entries, {
      now: FIXED_NOW,
      stamp: FIXED_STAMP,
      sourceFile: 'community/lists/whitelist.yaml',
    });
    expect(sql).toMatchInlineSnapshot(`
      "-- generated by publish-community-whitelist.sh from community/lists/whitelist.yaml
      -- 2 entries · 2026-09-13T00:57:22.276295+00:00 · 文件为唯一事实，先全量撤销再 upsert
      UPDATE maintainer_whitelist SET active = 0, updated_at = 1789261042 WHERE active = 1;
      INSERT INTO maintainer_whitelist_audit (action, handle, note, created_at) SELECT 'remove', handle, note, 1789261042 FROM maintainer_whitelist WHERE active = 0 AND updated_at = 1789261042;
      INSERT INTO maintainer_whitelist (handle, x_user_id, name, avatar_url, note, active, created_at, updated_at) VALUES ('kosx_note', '4848269835', '子扬', 'https://pbs.twimg.com/profile_images/123/x_400x400.jpg', '01 年小镇做题家 🌍', 1, 1789261042, 1789261042) ON CONFLICT(handle) DO UPDATE SET x_user_id = COALESCE(excluded.x_user_id, maintainer_whitelist.x_user_id), name = COALESCE(excluded.name, maintainer_whitelist.name), avatar_url = COALESCE(excluded.avatar_url, maintainer_whitelist.avatar_url), note = excluded.note, active = 1, updated_at = excluded.updated_at;
      INSERT INTO maintainer_whitelist_audit (action, handle, note, created_at) VALUES ('update', 'kosx_note', '01 年小镇做题家 🌍', 1789261042);
      INSERT INTO maintainer_whitelist (handle, x_user_id, name, avatar_url, note, active, created_at, updated_at) VALUES ('plain', NULL, NULL, NULL, '只有 handle 和 note', 1, 1789261042, 1789261042) ON CONFLICT(handle) DO UPDATE SET x_user_id = COALESCE(excluded.x_user_id, maintainer_whitelist.x_user_id), name = COALESCE(excluded.name, maintainer_whitelist.name), avatar_url = COALESCE(excluded.avatar_url, maintainer_whitelist.avatar_url), note = excluded.note, active = 1, updated_at = excluded.updated_at;
      INSERT INTO maintainer_whitelist_audit (action, handle, note, created_at) VALUES ('update', 'plain', '只有 handle 和 note', 1789261042);
      "
    `);
  });
});

describe('时间戳格式（SQL 头/行内字段）', () => {
  it('epochSeconds 取整到秒，utcIsoStamp 对齐 Python isoformat 的 +00:00 与 6 位微秒', () => {
    const date = new Date('2026-09-13T00:57:22.276Z');
    expect(epochSeconds(date)).toBe(1789261042);
    expect(utcIsoStamp(date)).toBe('2026-09-13T00:57:22.276000+00:00');
    expect(utcIsoStamp(new Date('2026-09-13T00:57:22.000Z'))).toBe('2026-09-13T00:57:22+00:00');
  });
});
