// @vitest-environment happy-dom
/**
 * 主页洞察分享卡的布局回归（真实 Canvas 不在 Node 里跑，这里用假 ctx 记录绘制指令）。
 *
 * 2026-11-05 线上分享图出过一次重叠：量 @handle 宽度时 ctx.font 已经被换成徽章的 26px，
 * 徽章就压到了 32px 的 handle 尾巴上。这里断言「徽章左边缘 ≥ handle 右边缘」。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { drawProfileShareCard, type ProfileShareInput } from './share-card';

interface FillCall {
  text: string;
  x: number;
  y: number;
  font: string;
}

interface MeasureCall {
  text: string;
  width: number;
  font: string;
}

type PathCommand = [name: string, a: number, b: number, c: number, d: number, e: number];

/** 假 ctx：按当前 font 的字号估宽，记录 fillText / measureText / 描边路径。 */
function createFakeContext() {
  const fillCalls: FillCall[] = [];
  const measureCalls: MeasureCall[] = [];
  const paths: PathCommand[][] = [];
  let path: PathCommand[] = [];

  const fontSize = (font: string): number => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
  const widthOf = (text: string, font: string): number => [...text].length * fontSize(font) * 0.6;

  const gradient = () => ({ addColorStop: () => undefined });

  const ctx = {
    font: '10px sans-serif',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    measureText(text: string) {
      const width = widthOf(text, this.font);
      measureCalls.push({ text, width, font: this.font });
      return { width } as TextMetrics;
    },
    fillText(text: string, x: number, y: number) {
      fillCalls.push({ text, x, y, font: this.font });
    },
    fillRect: () => undefined,
    clearRect: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    clip: () => undefined,
    arc: () => undefined,
    fill: () => undefined,
    drawImage: () => undefined,
    setLineDash: () => undefined,
    beginPath() {
      path = [];
    },
    closePath() {
      path.push(['closePath', 0, 0, 0, 0, 0]);
    },
    moveTo(x: number, y: number) {
      path.push(['moveTo', x, y, 0, 0, 0]);
    },
    lineTo: () => undefined,
    arcTo(x1: number, y1: number, x2: number, y2: number, r: number) {
      path.push(['arcTo', x1, y1, x2, y2, r]);
    },
    stroke() {
      if (path.length > 0) paths.push(path);
      path = [];
    },
    createRadialGradient: gradient,
    createLinearGradient: gradient,
  };

  return { ctx: ctx as unknown as CanvasRenderingContext2D, fillCalls, measureCalls, paths };
}

const originalGetContext = HTMLCanvasElement.prototype.getContext;

function installFakeCanvas() {
  const fake = createFakeContext();
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return fake.ctx;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
  return fake;
}

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

function input(overrides: Partial<ProfileShareInput> = {}): ProfileShareInput {
  return {
    handle: 'realchendahuang',
    displayName: '陈大黄',
    tier: 5,
    medianViews: 1658,
    outlierRate: 0.27,
    postCount: 2248,
    posts: [],
    lang: 'zh',
    date: new Date('2026-11-05T12:00:00Z'),
    ...overrides,
  };
}

/** 量级徽章是卡里唯一的圆角描边路径（4 段 arcTo），从左边缘反推它的 x。 */
function tierBadgeLeft(paths: PathCommand[][], radius: number): number | null {
  const badge = paths.find(
    (commands) => commands.filter(([name]) => name === 'arcTo').length === 4,
  );
  if (!badge) return null;
  const move = badge.find(([name]) => name === 'moveTo');
  return move ? move[1] - radius : null;
}

describe('drawProfileShareCard', () => {
  it('量级徽章不会压到 @handle 上：徽章左边缘在 handle 右边缘之后', async () => {
    const fake = installFakeCanvas();
    await drawProfileShareCard(input());

    const handle = fake.fillCalls.find((call) => call.text === '@realchendahuang');
    expect(handle, '应画出 @handle').toBeDefined();
    expect(handle!.font).toContain('32px');

    const handleMeasure = fake.measureCalls.find(
      (call) => call.text === '@realchendahuang' && call.font.includes('32px'),
    );
    expect(handleMeasure, '必须用 32px 的 handle 字体量宽度').toBeDefined();

    const badgeLeft = tierBadgeLeft(fake.paths, 22);
    expect(badgeLeft, '应画出量级徽章').not.toBeNull();

    const handleRight = handle!.x + handleMeasure!.width;
    expect(badgeLeft!).toBeGreaterThanOrEqual(handleRight + 20 - 0.01);

    const tier = fake.fillCalls.find((call) => call.text === '人气');
    expect(tier, '徽章里应写量级名').toBeDefined();
    expect(tier!.x).toBeCloseTo(badgeLeft! + 18, 5);
  });

  it('徽章右边缘不越过卡片右边距', async () => {
    const fake = installFakeCanvas();
    await drawProfileShareCard(input({ handle: 'a'.repeat(15) }));

    const badge = fake.paths.find(
      (commands) => commands.filter(([name]) => name === 'arcTo').length === 4,
    );
    expect(badge).toBeDefined();
    // roundRect: moveTo(x+r,y) → arcTo(x+w,y...) → arcTo(x+w,y+h...) → arcTo(x,y+h...) → arcTo(x,y...)
    const arcRight = badge!.filter(([name]) => name === 'arcTo')[1];
    const badgeRight = arcRight![1];
    expect(badgeRight).toBeLessThanOrEqual(1080 - 80);
  });
});
