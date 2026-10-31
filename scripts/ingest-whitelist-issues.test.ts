/**
 * 推荐 Issue 拉取脚本的纯函数测试：表单正文解析、合规收敛、publish 脚本兼容块。
 */
import { describe, expect, it } from 'vitest';
import { entryBlock, normalizeEntry, parseIssueBody } from './ingest-whitelist-issues.mjs';

const FORM = (handle, name, note, avatar = '', userId = '') => `### 佐证信息（运营填，选）

### X 账号 handle

${handle}
### 显示昵称

${name}
### X 公开头像链接

${avatar}
### 入册说明 / 简介

${note}
### 提交前自查

- [x] 内容真实、可核验
### X 数字 ID

${userId}`;

describe('parseIssueBody', () => {
  it('按 ### 小标题切段', () => {
    const sections = parseIssueBody(FORM('abc', '名', '说明'));
    expect(sections['X 账号 handle']).toBe('abc');
    expect(sections['显示昵称']).toBe('名');
  });
});

describe('normalizeEntry', () => {
  it('完整表单 → 合规条目，@ 与空白规范化', () => {
    const out = normalizeEntry(FORM('@Kosx_Note ', '子扬', ' 做 AI 内容记录\n公开真实复盘 ', 'https://pbs.twimg.com/profile_images/1/ok_400x400.jpg', '12'));
    expect(out).toEqual({
      ok: true,
      entry: {
        handle: 'kosx_note',
        name: '子扬',
        avatar_url: 'https://pbs.twimg.com/profile_images/1/ok_400x400.jpg',
        note: '做 AI 内容记录 公开真实复盘',
        x_user_id: '12',
      },
    });
  });

  it('缺 note / 非法 handle / 非 pbs 头像 / 伪数字 ID → 各自报错', () => {
    expect(normalizeEntry(FORM('ok handle!', '', '说明说明说明')).errors.join('\n')).toContain('handle 非法');
    expect(normalizeEntry(FORM('ok_handle', '', '好')).errors.join('\n')).toContain('4-240');
    expect(normalizeEntry(FORM('ok_handle', '', '说明说明说明', 'https://evil.example/a.jpg')).errors.join('\n')).toContain('pbs.twimg.com');
    expect(normalizeEntry(FORM('ok_handle', '', '说明说明说明', '', '12a')).errors.join('\n')).toContain('数字 ID');
  });

  it('选填字段缺省不进条目', () => {
    const out = normalizeEntry(FORM('plain_user', '', '一二三四五六'));
    expect(out.ok).toBe(true);
    expect(Object.keys(out.entry)).toEqual(['handle', 'note']);
  });

  it('拒收引号/反斜杠（双引号会破坏 publish 解析器的行格式）', () => {
    expect(normalizeEntry(FORM('ok_handle', '昵"称', '一二三四五六')).errors.join('\n')).toContain('显示昵称');
  });
});

describe('entryBlock', () => {
  it('字段顺序与 publish-community-whitelist.sh 内嵌解析器一致，值带双引号', () => {
    const block = entryBlock({
      handle: 'kosx_note',
      name: '子扬',
      avatar_url: 'https://pbs.twimg.com/profile_images/1/x.jpg',
      note: '真实简介',
      x_user_id: '12',
    });
    const fieldOrder = [...block.matchAll(/^\s*-?\s*([a-z_]+):/gm)].map((m) => m[1]);
    expect(fieldOrder).toEqual(['handle', 'name', 'avatar_url', 'note', 'x_user_id']);
    expect(block).toContain('note: "真实简介"');
  });
});
