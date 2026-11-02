/**
 * 发帖框里的排期助手（内容脚本，ISOLATED world）。
 *
 * - 发帖框工具栏里 X 的日历图标旁加一个「排下一条」按钮（快捷键 Alt+N）：
 *   打开 X 自己的「安排表」并把五个下拉框填进下一个有空位的小时（分钟内随机），
 *   你只点 X 的「确认」。
 * - 「安排表」顶上加一排快捷时间：排下一条、+1 小时、+3 小时、明天此时、同上一条、±15 分钟；
 *   选的时间离已排期的帖子太近时提示。
 * - 面板「发帖 › 同步」：让 X 页面打开它自己的「预排期」列表（X 自己去拉数据，扩展只读）。
 * - 面板「草稿 › 排下一条」：发帖页会把时间先占好，这里只负责打开发帖框、贴正文、填时间；
 *   你在 X 里排好后（X 发出 CreateScheduledTweet），草稿和本机分配一起拿掉。
 *
 * 只改 X 自己的下拉框（写值 + 派发 change），不替你点「确认」「预排期」，也不调 X 的接口。
 */
import type { UiLanguage } from '../platform/i18n';
import {
  DEFAULT_SCHEDULE_SETTINGS,
  isOccupied,
  nextFreeSlots,
  slotLabel,
  type ScheduleSettings,
} from './schedule-slots';
import { asScheduledEvent } from './scheduled-parse';
import {
  applyScheduledEvent,
  EMPTY_SCHEDULED_CACHE,
  getAssignments,
  getLastPick,
  getScheduledCache,
  getScheduleSettings,
  removeAssignmentsForPosts,
  removeAssignmentsMatching,
  removeDraftsMatching,
  setLastPick,
  subscribeAssignments,
  subscribeScheduledCache,
  subscribeScheduleSettings,
  takeComposeIntent,
  upcomingTimes,
  type ScheduleAssignment,
  type ScheduledCache,
} from './schedule-store';

export const OPEN_SCHEDULED_MESSAGE = 'feedsieve:open-scheduled';
/** 发帖页「草稿 › 排下一条」：打开 X 发帖框、贴好正文、填好已占好的时间 */
export const COMPOSE_DRAFT_MESSAGE = 'feedsieve:compose-draft';
export const COMPOSE_PATH = '/compose/post';
export const SCHEDULED_BRIDGE_EVENT = 'feedsieve:scheduled';
export const SCHEDULED_LIST_PATH = '/compose/post/unsent/scheduled';

const SLOT_BUTTON_ATTR = 'data-fs-slot-button';
const BAR_ATTR = 'data-fs-sched-bar';
const STYLE_ID = 'feedsieve-compose-styles';
const CONFIRM_SELECTOR = '[data-testid="scheduledConfirmationPrimaryAction"]';
const SCHEDULE_OPTION_SELECTOR = '[data-testid="scheduleOption"]';
const MINUTE_MS = 60_000;
/** 本页刚确认过、还没出现在已排期列表里的时间，记这么久 */
const SESSION_USED_TTL_MS = 30 * MINUTE_MS;

const COPY = {
  zh: {
    next: '排下一条',
    nextTitle: (label: string) => `排下一条：${label}（Alt+N）`,
    noSlot: '节奏里没有空位',
    plus1: '+1 小时',
    plus3: '+3 小时',
    tomorrow: '明天此时',
    same: '同上一条',
    minus15: '−15 分',
    plus15: '+15 分',
    conflict: (minutes: number) => `离已排期的一条只差 ${minutes} 分钟`,
    past: '这个时间已经过了',
    fillFailed: '没填上，请手动选择',
  },
  en: {
    next: 'Schedule next',
    nextTitle: (label: string) => `Schedule next: ${label} (Alt+N)`,
    noSlot: 'No open slot in your cadence',
    plus1: '+1h',
    plus3: '+3h',
    tomorrow: 'Tomorrow',
    same: 'Same as last',
    minus15: '−15m',
    plus15: '+15m',
    conflict: (minutes: number) => `Only ${minutes} min from another scheduled post`,
    past: 'This time has passed',
    fillFailed: 'Could not fill in, please pick manually',
  },
} as const;

// ---------- X「安排表」里的下拉框 ----------

export interface ScheduleFields {
  month: HTMLSelectElement;
  day: HTMLSelectElement;
  year: HTMLSelectElement;
  hour: HTMLSelectElement;
  minute: HTMLSelectElement;
  /** 12 小时制界面的上午 / 下午 */
  meridiem: HTMLSelectElement | null;
}

function labelOf(select: HTMLSelectElement): string {
  const ids = (select.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
  const text = ids
    .map((id) => select.ownerDocument.getElementById(id)?.textContent ?? '')
    .join(' ');
  return (text || select.getAttribute('aria-label') || '').trim();
}

function numericValues(select: HTMLSelectElement): number[] {
  return [...select.options]
    .map((option) => option.value)
    .filter((value) => /^\d+$/.test(value))
    .map(Number);
}

/**
 * 找出「安排表」里的五个（12 小时制是六个）下拉框。
 * 先按标签文字（月 / 日 / 年 / 时 / 分，Month / Day …），认不出再按选项特征和顺序。
 */
export function findScheduleFields(root: ParentNode): ScheduleFields | null {
  const selects = [...root.querySelectorAll('select')];
  if (selects.length < 5) return null;
  const byLabel: Partial<Record<keyof ScheduleFields, HTMLSelectElement>> = {};
  const patterns: Array<[keyof ScheduleFields, RegExp]> = [
    ['month', /^(月|month)/i],
    ['day', /^(日|day)/i],
    ['year', /^(年|year)/i],
    ['hour', /^(时|小时|時|hour)/i],
    ['minute', /^(分|minute)/i],
    ['meridiem', /^(上午|下午|午前|午後|am|pm|am\/pm)/i],
  ];
  for (const select of selects) {
    const label = labelOf(select);
    const hit = patterns.find(([, re]) => re.test(label));
    if (hit && !byLabel[hit[0]]) byLabel[hit[0]] = select;
  }
  const rest = selects.filter((s) => !Object.values(byLabel).includes(s));
  const take = (test: (s: HTMLSelectElement) => boolean): HTMLSelectElement | undefined => {
    const index = rest.findIndex(test);
    return index >= 0 ? rest.splice(index, 1)[0] : undefined;
  };
  const year =
    byLabel.year ??
    take((s) => numericValues(s).every((v) => v >= 2000) && numericValues(s).length > 0);
  const minute = byLabel.minute ?? take((s) => numericValues(s).length === 60);
  const meridiem =
    byLabel.meridiem ?? take((s) => numericValues(s).length === 0 && s.options.length <= 3) ?? null;
  // 剩下的按出现顺序：月、日、时（X 的布局是日期一行、时间一行）
  const month = byLabel.month ?? take((s) => Math.max(...numericValues(s)) === 12);
  const day = byLabel.day ?? take((s) => Math.max(...numericValues(s)) >= 28);
  const hour = byLabel.hour ?? take(() => true);
  if (!month || !day || !year || !hour || !minute) return null;
  return { month, day, year, hour, minute, meridiem };
}

function isTwelveHour(fields: ScheduleFields): boolean {
  return fields.meridiem !== null && Math.max(...numericValues(fields.hour)) <= 12;
}

/** 下拉框当前选中的时间（本地时区），没选全返回 null。 */
export function readScheduleFields(fields: ScheduleFields): number | null {
  const n = (s: HTMLSelectElement) => (/^\d+$/.test(s.value) ? Number(s.value) : null);
  const [y, mo, d, h, mi] = [
    n(fields.year),
    n(fields.month),
    n(fields.day),
    n(fields.hour),
    n(fields.minute),
  ];
  if (y === null || mo === null || d === null || h === null || mi === null) return null;
  let hour = h;
  if (isTwelveHour(fields)) {
    const meridiem = fields.meridiem!;
    const option = [...meridiem.options].find((o) => o.value === meridiem.value);
    const text = `${option?.textContent ?? ''} ${meridiem.value}`;
    const pm = /p\.?m|下午|午後/i.test(text);
    hour = (h % 12) + (pm ? 12 : 0);
  }
  return new Date(y, mo - 1, d, hour, mi).getTime();
}

const nativeSelectValue = Object.getOwnPropertyDescriptor(
  HTMLSelectElement.prototype,
  'value',
)?.set;

/** 写值并派发 change：X 是 React 受控组件，直接改 value 它不知道，要走原生 setter 再发事件。 */
function setSelect(select: HTMLSelectElement, value: string): boolean {
  if (![...select.options].some((option) => option.value === value)) return false;
  if (select.value === value) return true;
  if (nativeSelectValue) nativeSelectValue.call(select, value);
  else select.value = value;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 30));

/**
 * 把下拉框填成 at（分钟取整）。按年 → 月 → 日 → 时 → 分的顺序，每步等 X 重新渲染
 * （换月份后「日」的选项会变）。填完读回来核对。
 */
export async function fillScheduleFields(root: ParentNode, at: number): Promise<boolean> {
  const date = new Date(at);
  const steps: Array<[keyof ScheduleFields, string]> = [
    ['year', String(date.getFullYear())],
    ['month', String(date.getMonth() + 1)],
    ['day', String(date.getDate())],
  ];
  const first = findScheduleFields(root);
  if (!first) return false;
  if (isTwelveHour(first)) {
    const hour12 = date.getHours() % 12 || 12;
    steps.push(['hour', String(hour12)]);
    const pm = date.getHours() >= 12;
    const option = [...first.meridiem!.options].find((o) =>
      pm
        ? /p\.?m|下午|午後/i.test(o.textContent ?? o.value)
        : /a\.?m|上午|午前/i.test(o.textContent ?? o.value),
    );
    if (option) steps.push(['meridiem', option.value]);
  } else {
    steps.push(['hour', String(date.getHours())]);
  }
  steps.push(['minute', String(date.getMinutes())]);
  for (const [field, value] of steps) {
    // 每一步重新找：X 重新渲染后元素可能换了
    const fields = findScheduleFields(root);
    const select = fields?.[field];
    if (!select || !setSelect(select, value)) return false;
    await tick();
  }
  const fields = findScheduleFields(root);
  const filled = fields ? readScheduleFields(fields) : null;
  return filled !== null && Math.abs(filled - Math.floor(at / MINUTE_MS) * MINUTE_MS) < MINUTE_MS;
}

// ---------- 快捷时间 ----------

/** 往后取整到 5 分钟 */
export function roundUp5(at: number): number {
  const step = 5 * MINUTE_MS;
  return Math.ceil(at / step) * step;
}

// ---------- 样式 ----------

function ensureComposeStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    [${SLOT_BUTTON_ATTR}] {
      display: inline-flex; align-items: center; justify-content: center;
      width: 34px; height: 34px; margin: 0; padding: 0; border: 0; border-radius: 999px;
      background: transparent; color: rgb(29, 155, 240); cursor: pointer; flex: none;
    }
    [${SLOT_BUTTON_ATTR}]:hover { background: rgba(29, 155, 240, 0.1); }
    [${SLOT_BUTTON_ATTR}] svg { width: 20px; height: 20px; }
    [${BAR_ATTR}] {
      display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
      padding: 4px 16px 12px; font: 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    [${BAR_ATTR}] button {
      height: 28px; padding: 0 10px; border-radius: 999px; cursor: pointer;
      border: 1px solid rgba(29, 155, 240, 0.5); background: transparent; color: rgb(29, 155, 240);
      font: inherit; white-space: nowrap;
    }
    [${BAR_ATTR}] button:hover { background: rgba(29, 155, 240, 0.1); }
    [${BAR_ATTR}] button[disabled] { opacity: 0.45; cursor: default; }
    [${BAR_ATTR}] button.fs-primary { background: rgb(29, 155, 240); color: #fff; border-color: transparent; }
    [${BAR_ATTR}] .fs-sched-warn { flex-basis: 100%; color: #f59e0b; min-height: 0; }
    [${BAR_ATTR}] .fs-sched-warn:empty { display: none; }
  `;
  (document.head ?? document.documentElement).append(style);
}

// 日历 + 右箭头：表达「下一个空档」，和 X 自带的日历 + 时钟区分开
const SLOT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/><path d="M14 17h7"/><path d="M18 14l3 3-3 3"/></svg>`;

// ---------- 主体 ----------

export interface ComposeScheduleDeps {
  getLanguage: () => UiLanguage;
  /** 当前登录的 X 账号（小写 handle） */
  getAccount: () => string | null;
  now?: () => number;
}

export function createComposeSchedule(deps: ComposeScheduleDeps) {
  const now = deps.now ?? Date.now;
  let settings: ScheduleSettings = DEFAULT_SCHEDULE_SETTINGS;
  let cache: ScheduledCache = EMPTY_SCHEDULED_CACHE;
  let assignments: ScheduleAssignment[] = [];
  let lastPick: number | null = null;
  let sessionUsed: Array<{ at: number; recordedAt: number }> = [];
  let pendingFill: { at: number; record: boolean } | null = null;
  /** 「配图」交接：正文已贴好、时间先留着，等用户加完图打开安排表再填 */
  let stashedSlot: { at: number; recordedAt: number } | null = null;
  let composerWasOpen = false;
  let composerCloseTimer: number | null = null;
  /** 同一个「下一条」在页面上保持稳定，别每次扫描都换一个随机分钟 */
  let preview: { at: number; computedAt: number } | null = null;
  /** 发帖框里刚占的时间；没点确认就关掉安排表时把它释放 */
  let pendingComposerAssignment: number | null = null;
  let observer: MutationObserver | null = null;
  let frame = 0;
  const watchedDialogs = new WeakSet<Element>();
  const cleanups: Array<() => void> = [];

  const copy = () => COPY[deps.getLanguage()];

  function occupied(): number[] {
    const t = now();
    sessionUsed = sessionUsed.filter((u) => t - u.recordedAt < SESSION_USED_TTL_MS);
    const account = deps.getAccount();
    const fromCache =
      !account || !cache.account || cache.account === account ? upcomingTimes(cache, t) : [];
    const fromAssignments = assignments.filter((a) => a.at > t).map((a) => a.at);
    return [...fromCache, ...fromAssignments, ...sessionUsed.map((u) => u.at)];
  }

  function invalidatePreview(): void {
    preview = null;
  }

  function nextSlot(): number | null {
    const t = now();
    if (preview && t - preview.computedAt < 30 * MINUTE_MS) return preview.at;
    const at = nextFreeSlots(settings, occupied(), t, 1)[0] ?? null;
    preview = at === null ? null : { at, computedAt: t };
    return at;
  }

  /** 关掉安排表却没确认：把刚才占的时间还回去。 */
  function releasePendingAssignment(): void {
    const at = pendingComposerAssignment;
    if (at === null) return;
    pendingComposerAssignment = null;
    sessionUsed = sessionUsed.filter((used) => Math.abs(used.at - at) >= MINUTE_MS);
    void removeAssignmentsMatching('', at)
      .then((list) => {
        assignments = list;
        invalidatePreview();
        refreshSlotTitles();
      })
      .catch(() => undefined);
  }

  function scheduleScan(): void {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      scan();
    });
  }

  function findComposer(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[role="dialog"] [data-testid="tweetTextarea_0"]');
  }

  function clearComposerCloseTimer(): void {
    if (composerCloseTimer === null) return;
    window.clearTimeout(composerCloseTimer);
    composerCloseTimer = null;
  }

  /** 用户没在 X 里确认就把发帖框关了：把本机占的时间还回去。 */
  function releaseStashedSlot(): void {
    const stashed = stashedSlot;
    stashedSlot = null;
    if (!stashed) return;
    void removeAssignmentsMatching('', stashed.at)
      .then((list) => {
        assignments = list;
        invalidatePreview();
        refreshSlotTitles();
      })
      .catch(() => undefined);
  }

  /** 发帖框关掉后稍等一会儿再释放：打开安排表时 X 可能先卸载发帖框再挂上弹窗。 */
  function watchComposer(): void {
    if (findComposer()) {
      composerWasOpen = true;
      clearComposerCloseTimer();
      return;
    }
    if (!composerWasOpen || composerCloseTimer !== null) return;
    composerCloseTimer = window.setTimeout(() => {
      composerCloseTimer = null;
      if (findComposer() || document.querySelector(CONFIRM_SELECTOR)) return;
      composerWasOpen = false;
      releaseStashedSlot();
    }, 1200);
  }

  function scan(): void {
    if (stashedSlot !== null || composerWasOpen) watchComposer();
    if (stashedSlot !== null && now() - stashedSlot.recordedAt > 10 * MINUTE_MS) {
      releaseStashedSlot();
    }
    if (settings.composeHelper) {
      for (const option of document.querySelectorAll<HTMLElement>(SCHEDULE_OPTION_SELECTOR)) {
        ensureSlotButton(option);
      }
    } else {
      document.querySelectorAll(`[${SLOT_BUTTON_ATTR}]`).forEach((el) => el.remove());
    }
    const confirm = document.querySelector(CONFIRM_SELECTOR);
    const dialog = confirm?.closest('[role="dialog"]');
    if (!dialog) {
      releasePendingAssignment();
      return;
    }
    if (settings.composeHelper) ensureBar(dialog);
    else dialog.querySelector(`[${BAR_ATTR}]`)?.remove();
    const fields = findScheduleFields(dialog);
    if (!fields) return;
    if (stashedSlot !== null) {
      const at = stashedSlot.at;
      stashedSlot = null;
      void fill(dialog, at);
    }
    if (pendingFill !== null) {
      const pending = pendingFill;
      pendingFill = null;
      void fill(dialog, pending.at, pending.record);
    }
  }

  function refreshSlotTitles(): void {
    const at = nextSlot();
    const label =
      at === null ? copy().noSlot : copy().nextTitle(slotLabel(at, now(), deps.getLanguage()));
    for (const button of document.querySelectorAll<HTMLButtonElement>(`[${SLOT_BUTTON_ATTR}]`)) {
      button.title = label;
      button.setAttribute('aria-label', label);
    }
    for (const bar of document.querySelectorAll(`[${BAR_ATTR}]`)) renderBar(bar as HTMLElement);
  }

  function ensureSlotButton(option: HTMLElement): void {
    // X 的工具栏按钮外面包了几层；往上找到工具栏那一行的直接子元素，按钮插在它后面
    let wrapper: HTMLElement = option;
    while (
      wrapper.parentElement &&
      wrapper.parentElement.querySelectorAll('button, [role="button"]').length <= 1
    ) {
      wrapper = wrapper.parentElement;
    }
    if (wrapper.nextElementSibling?.hasAttribute(SLOT_BUTTON_ATTR)) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute(SLOT_BUTTON_ATTR, '');
    button.innerHTML = SLOT_ICON;
    // 跟 X 工具栏图标取同一个颜色：直接抄 option 的文字色会变成纯黑，和旁边的原生图标不一致
    const color = getComputedStyle(option.querySelector('svg') ?? option).color;
    if (color) button.style.color = color;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openWithSlot(option);
    });
    wrapper.after(button);
    refreshSlotTitles();
  }

  /**
   * 打开 X 的「安排表」，等它出来后填时间。
   * `preferred` 来自发帖页（已经占好位），不传就在当前节奏里找下一条。
   */
  function openWithSlot(option?: HTMLElement | null, preferred?: number): void {
    const target = option ?? document.querySelector<HTMLElement>(SCHEDULE_OPTION_SELECTOR);
    const confirm = document.querySelector(CONFIRM_SELECTOR);
    const dialog = confirm?.closest('[role="dialog"]');
    const at = preferred ?? nextSlot();
    const record = preferred === undefined;
    if (dialog && findScheduleFields(dialog)) {
      if (at !== null) void fill(dialog, at, record);
      return;
    }
    if (!target) return;
    pendingFill = at === null ? null : { at, record };
    target.click();
  }

  async function fill(dialog: Element, at: number, record = false): Promise<void> {
    const ok = await fillScheduleFields(dialog, at);
    const bar = dialog.querySelector<HTMLElement>(`[${BAR_ATTR}]`);
    if (bar) {
      renderBar(bar);
      if (!ok) setWarn(bar, copy().fillFailed);
    }
    if (ok) {
      // 发帖页传来的时间也先记在这里：用户关掉安排表没确认时一起释放
      pendingComposerAssignment = at;
      if (record) {
        sessionUsed.push({ at, recordedAt: now() });
        invalidatePreview();
        refreshSlotTitles();
      }
    }
  }

  function setWarn(bar: HTMLElement, text: string): void {
    const warn = bar.querySelector('.fs-sched-warn');
    if (warn) warn.textContent = text;
  }

  function dialogTime(dialog: Element): number | null {
    const fields = findScheduleFields(dialog);
    return fields ? readScheduleFields(fields) : null;
  }

  function ensureBar(dialog: Element): void {
    if (dialog.querySelector(`[${BAR_ATTR}]`)) return;
    const fields = findScheduleFields(dialog);
    if (!fields) return;
    // 插在包住日期和时间两组下拉框的那一层前面（「将于 … 发布」那行下面）
    let block: Element | null = fields.month;
    while (block && !block.contains(fields.minute)) block = block.parentElement;
    if (!block || !block.parentElement || block === dialog) return;
    const bar = document.createElement('div');
    bar.setAttribute(BAR_ATTR, '');
    block.parentElement.insertBefore(bar, block);
    renderBar(bar);
    if (!watchedDialogs.has(dialog)) {
      watchedDialogs.add(dialog);
      dialog.addEventListener('change', () => {
        const current = dialog.querySelector<HTMLElement>(`[${BAR_ATTR}]`);
        if (current) checkConflict(dialog, current);
      });
    }
  }

  function renderBar(bar: HTMLElement): void {
    const dialog = bar.closest('[role="dialog"]');
    if (!dialog) return;
    const c = copy();
    const language = deps.getLanguage();
    const t = now();
    const slot = nextSlot();
    const items: Array<{
      label: string;
      at: () => number | null;
      primary?: boolean;
      disabled?: boolean;
    }> = [
      {
        label: slot === null ? c.noSlot : `${c.next} · ${slotLabel(slot, t, language)}`,
        at: () => nextSlot(),
        primary: true,
        disabled: slot === null,
      },
      { label: c.plus1, at: () => roundUp5(now() + 60 * MINUTE_MS) },
      { label: c.plus3, at: () => roundUp5(now() + 180 * MINUTE_MS) },
      { label: c.tomorrow, at: () => roundUp5(now() + 24 * 60 * MINUTE_MS) },
    ];
    if (lastPick !== null && lastPick > t) {
      items.push({ label: `${c.same} · ${slotLabel(lastPick, t, language)}`, at: () => lastPick });
    }
    items.push(
      { label: c.minus15, at: () => shift(dialog, -15) },
      { label: c.plus15, at: () => shift(dialog, 15) },
    );
    bar.replaceChildren(
      ...items.map((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = item.label;
        if (item.primary) button.className = 'fs-primary';
        if (item.disabled) button.disabled = true;
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const at = item.at();
          if (at !== null) void fill(dialog, at);
        });
        return button;
      }),
      Object.assign(document.createElement('div'), { className: 'fs-sched-warn' }),
    );
    checkConflict(dialog, bar);
  }

  function shift(dialog: Element, minutes: number): number | null {
    const current = dialogTime(dialog);
    return current === null ? null : current + minutes * MINUTE_MS;
  }

  function checkConflict(dialog: Element, bar: HTMLElement): void {
    // X 重新渲染完再读
    setTimeout(() => {
      const at = dialogTime(dialog);
      if (at === null) return setWarn(bar, '');
      if (at < now()) return setWarn(bar, copy().past);
      // 刚给这一条占的时间也会出现在 occupied 里，别把它自己算成冲突
      const taken = occupied().filter((time) => Math.abs(time - at) >= MINUTE_MS);
      const gap = Math.max(settings.minGapMinutes, 1);
      if (isOccupied(at, taken, gap)) {
        const nearest = Math.min(...taken.map((t) => Math.abs(t - at)));
        setWarn(bar, copy().conflict(Math.round(nearest / MINUTE_MS)));
      } else setWarn(bar, '');
    }, 60);
  }

  function onClick(event: MouseEvent): void {
    const confirm = (event.target as Element | null)?.closest?.(CONFIRM_SELECTOR);
    if (!confirm) return;
    const dialog = confirm.closest('[role="dialog"]');
    const at = dialog ? dialogTime(dialog) : null;
    if (at === null || at <= now()) return;
    lastPick = at;
    const planned = pendingComposerAssignment;
    pendingComposerAssignment = null;
    if (planned !== null && Math.abs(planned - at) >= MINUTE_MS)
      sessionUsed = sessionUsed.filter((used) => Math.abs(used.at - planned) >= MINUTE_MS);
    sessionUsed.push({ at, recordedAt: now() });
    invalidatePreview();
    void setLastPick(at).catch(() => undefined);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (!settings.composeHelper || !event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.code !== 'KeyN') return;
    const option = document.querySelector<HTMLElement>(SCHEDULE_OPTION_SELECTOR);
    const inDialog = document.querySelector(CONFIRM_SELECTOR);
    if (!option && !inDialog) return;
    event.preventDefault();
    event.stopPropagation();
    openWithSlot(option);
  }

  function onBridge(event: Event): void {
    const detail = (event as CustomEvent<unknown>).detail;
    if (typeof detail !== 'string' || detail.length > 1_000_000) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(detail);
    } catch {
      return;
    }
    const scheduled = asScheduledEvent(parsed);
    if (!scheduled) return;
    if (scheduled.kind === 'upsert') {
      // 已经进了列表：本页临时记的同一时间不用再记
      sessionUsed = sessionUsed.filter(
        (u) => Math.abs(u.at - scheduled.post.executeAt) >= MINUTE_MS,
      );
      void removeDraftsMatching(scheduled.post.text).catch(() => undefined);
      void removeAssignmentsMatching(scheduled.post.text, scheduled.post.executeAt)
        .then((list) => {
          assignments = list;
          invalidatePreview();
          refreshSlotTitles();
        })
        .catch(() => undefined);
    } else if (scheduled.kind === 'list') {
      void removeAssignmentsForPosts(scheduled.posts)
        .then((list) => {
          assignments = list;
          invalidatePreview();
          refreshSlotTitles();
        })
        .catch(() => undefined);
    }
    void applyScheduledEvent(scheduled, deps.getAccount(), now()).catch(() => undefined);
  }

  /**
   * 打开 X 的发帖框并贴好正文。
   * `openSchedule` 为 false 时不自动打开安排表，只把时间先留着 ——
   * 用户要先在原生框里加图片 / 视频，加完自己点日历，时间会填好。
   * 发帖框里已经有没写完的内容时不动它，返回 busy。
   */
  async function composeDraft(
    text: string,
    at?: number,
    openSchedule = true,
  ): Promise<{ ok: boolean; reason?: string }> {
    if (!findComposer()) {
      history.pushState(history.state, '', COMPOSE_PATH);
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    }
    let composer: HTMLElement | null = null;
    for (let i = 0; i < 60 && !composer; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      composer = findComposer();
    }
    if (!composer) return { ok: false, reason: 'no-composer' };
    if ((composer.textContent ?? '').trim() !== '') return { ok: false, reason: 'busy' };
    composerWasOpen = true;
    composer.focus();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const data = new DataTransfer();
    data.setData('text/plain', text);
    composer.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    const dialog = composer.closest('[role="dialog"]');
    const option = dialog?.querySelector<HTMLElement>(SCHEDULE_OPTION_SELECTOR) ?? null;
    if (openSchedule) {
      if (option) openWithSlot(option, at);
    } else if (at !== undefined) {
      stashedSlot = { at, recordedAt: now() };
    }
    return { ok: true };
  }

  function onMessage(message: unknown): Promise<unknown> | undefined {
    const msg = message as {
      type?: string;
      text?: unknown;
      at?: unknown;
      openSchedule?: unknown;
    } | null;
    if (msg?.type === OPEN_SCHEDULED_MESSAGE) {
      openScheduledList();
      return Promise.resolve({ ok: true });
    }
    if (msg?.type === COMPOSE_DRAFT_MESSAGE && typeof msg.text === 'string' && msg.text.trim()) {
      const at =
        typeof msg.at === 'number' && Number.isFinite(msg.at) && msg.at > now()
          ? msg.at
          : undefined;
      return composeDraft(msg.text, at, msg.openSchedule !== false);
    }
    return undefined;
  }

  function start(): void {
    ensureComposeStyles();
    void getScheduleSettings().then((value) => {
      settings = value;
      scheduleScan();
    });
    void getScheduledCache().then((value) => {
      cache = value;
      invalidatePreview();
      refreshSlotTitles();
    });
    void getAssignments().then((value) => {
      assignments = value;
      invalidatePreview();
      refreshSlotTitles();
    });
    void getLastPick().then((value) => {
      lastPick = value;
    });
    // 发帖页点空档「写新帖」时，新窗口从这里取预填时间
    if (location.pathname === COMPOSE_PATH) {
      void takeComposeIntent().then((at) => {
        if (at === null) return;
        stashedSlot = { at, recordedAt: now() };
        scheduleScan();
      });
    }
    cleanups.push(
      subscribeScheduleSettings((value) => {
        settings = value;
        invalidatePreview();
        scan();
        refreshSlotTitles();
      }),
      subscribeScheduledCache((value) => {
        cache = value;
        invalidatePreview();
        refreshSlotTitles();
      }),
      subscribeAssignments((value) => {
        assignments = value;
        invalidatePreview();
        refreshSlotTitles();
      }),
    );
    document.addEventListener(SCHEDULED_BRIDGE_EVENT, onBridge);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeydown, true);
    browser.runtime.onMessage.addListener(onMessage);
    cleanups.push(() => {
      document.removeEventListener(SCHEDULED_BRIDGE_EVENT, onBridge);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeydown, true);
      browser.runtime.onMessage.removeListener(onMessage);
    });
    observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, { childList: true, subtree: true });
    scan();
  }

  function stop(): void {
    observer?.disconnect();
    observer = null;
    clearComposerCloseTimer();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    cleanups.splice(0).forEach((fn) => {
      try {
        fn();
      } catch {
        // 上下文失效后扩展 API 会抛错，清理照常继续
      }
    });
    document.querySelectorAll(`[${SLOT_BUTTON_ATTR}], [${BAR_ATTR}]`).forEach((el) => el.remove());
    document.getElementById(STYLE_ID)?.remove();
  }

  return { start, stop, nextSlot, openWithSlot };
}

/** 让 X 打开它自己的「草稿 › 预排期」：X 是单页应用，改地址后补一个 popstate 让它的路由接手。 */
export function openScheduledList(): void {
  if (location.pathname === SCHEDULED_LIST_PATH) {
    history.replaceState(history.state, '', '/home');
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  }
  history.pushState(history.state, '', SCHEDULED_LIST_PATH);
  window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
}
