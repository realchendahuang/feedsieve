import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SCHEDULE_ASSIGNMENTS_KEY,
  getAssignments,
  removeAssignmentsForPosts,
  removeAssignmentsMatching,
  removeAssignmentForDraft,
  setAssignment,
  setComposeIntent,
  takeComposeIntent,
} from './schedule-store';

let store: Record<string, unknown>;
let session: Record<string, unknown>;
let setMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  store = {};
  session = {};
  setMock = vi.fn(async (value: Record<string, unknown>) => {
    Object.assign(store, value);
  });
  vi.stubGlobal('browser', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: store[key] })),
        set: setMock,
      },
      session: {
        get: vi.fn(async (key: string) => ({ [key]: session[key] })),
        set: vi.fn(async (value: Record<string, unknown>) => {
          Object.assign(session, value);
        }),
        remove: vi.fn(async (key: string) => {
          delete session[key];
        }),
      },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  });
});

describe('排期分配', () => {
  it('给草稿占时间；同一个草稿再排会覆盖旧时间', async () => {
    const now = Date.now();
    await setAssignment({ draftId: 'd1', text: 'hello', at: now + 60_000, now });
    await setAssignment({ draftId: 'd1', text: 'hello', at: now + 120_000, now });
    const list = await getAssignments(now);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ draftId: 'd1', textKey: 'hello', at: now + 120_000 });
    expect(store[SCHEDULE_ASSIGNMENTS_KEY]).toEqual(list);
  });

  it('取消草稿分配', async () => {
    const now = Date.now();
    await setAssignment({ draftId: 'd1', text: 'hello', at: now + 60_000, now });
    const list = await removeAssignmentForDraft('d1');
    expect(list).toEqual([]);
  });

  it('X 里确认后按正文或时间清掉分配', async () => {
    const now = Date.now();
    await setAssignment({ draftId: 'd1', text: 'hello', at: now + 60_000, now });
    await setAssignment({ draftId: 'd2', text: 'world', at: now + 120_000, now });
    const byText = await removeAssignmentsMatching('hello', now + 60_000);
    expect(byText.map((a) => a.draftId)).toEqual(['d2']);
    const byTime = await removeAssignmentsMatching('', now + 120_000);
    expect(byTime).toEqual([]);
  });

  it('打开预排期列表时批量清掉已经存在的帖子', async () => {
    const now = Date.now();
    await setAssignment({ draftId: 'd1', text: 'hello', at: now + 60_000, now });
    await setAssignment({ draftId: 'd2', text: 'world', at: now + 120_000, now });
    const list = await removeAssignmentsForPosts([{ text: 'world', executeAt: now + 120_000 }]);
    expect(list.map((a) => a.draftId)).toEqual(['d1']);
  });

  it('过了发布时刻很久的分配不再返回', async () => {
    const now = Date.now();
    await setAssignment({ draftId: 'd1', text: 'hello', at: now, now });
    expect(await getAssignments(now + 3 * 60 * 60_000)).toEqual([]);
  });

  it('打开发帖框后一直不确认，半小时后释放名额', async () => {
    const now = Date.now();
    await setAssignment({ draftId: 'd1', text: 'hello', at: now + 24 * 60 * 60_000, now });
    expect(await getAssignments(now + 10 * 60_000)).toHaveLength(1);
    expect(await getAssignments(now + 31 * 60_000)).toEqual([]);
  });
});

describe('写新帖的预填时间', () => {
  it('只取一次，过期或已过去的时间不取', async () => {
    const now = Date.now();
    await setComposeIntent(now + 60_000, now);
    expect(await takeComposeIntent(now + 1_000)).toBe(now + 60_000);
    expect(await takeComposeIntent(now + 1_000)).toBeNull();

    await setComposeIntent(now + 60_000, now);
    expect(await takeComposeIntent(now + 11 * 60_000)).toBeNull();

    await setComposeIntent(now - 1, now);
    expect(await takeComposeIntent(now + 1_000)).toBeNull();
  });
});
