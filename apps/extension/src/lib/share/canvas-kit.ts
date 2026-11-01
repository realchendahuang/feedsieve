/**
 * 分享图共用的 Canvas 工具：字体栈、折行、圆角矩形、头像读取与 PNG 导出。
 *
 * AI 味报告卡（ai-check/share-card）与主页洞察卡（insight/share-card）共用这一套，
 * 头像跨域的坑（换 400×400、不带 cookie、失败返回 null）只在这里处理一次。
 */

/** 中英文都要能排：优先苹方，再回退到各平台自带的中文字体。 */
export const CARD_FONT =
  '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif';

/** 不能出现在行首的标点：断到它们前面时，把上一行最后一个字一起带下来。 */
const NO_LINE_START = /[，。、；：？！）」』】》〉…—]/;

/** 拉丁字母、数字与西文标点：整词不拆，避免把 time 断成 t / ime。 */
const LATIN = /[A-Za-z0-9@#_'"()[\]{}<>.,:;!?/\\&%$+=*~`^|-]/;

/**
 * 切成折行单位：西文按词（空格并进前一个词），中日韩按字。
 * 空格跟着前一个词走，换行时被丢掉，不会在行首留空。
 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let word = '';
  for (const ch of [...text]) {
    if (LATIN.test(ch)) {
      word += ch;
    } else if (ch === ' ') {
      tokens.push(word ? `${word} ` : ' ');
      word = '';
    } else {
      if (word) {
        tokens.push(word);
        word = '';
      }
      tokens.push(ch);
    }
  }
  if (word) tokens.push(word);
  return tokens;
}

/** 折行：西文按词、中文按字；中文标点不落行首；最多 maxLines 行，超出加省略号。 */
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
  maxLines: number,
): string[] {
  const lines: string[] = [];
  let line: string[] = [];
  for (const token of tokenize(text)) {
    if (ctx.measureText(line.join('') + token).width > width && line.length > 0) {
      // 中文标点不能落在行首：把它前面那个单位也挤到下一行
      if (NO_LINE_START.test(token) && line.length > 1) {
        const carry = line.pop()!;
        lines.push(line.join(''));
        line = [carry, token];
      } else {
        lines.push(line.join(''));
        line = [token.trimStart()];
      }
      if (lines.length === maxLines) break;
    } else {
      line.push(token);
    }
  }
  if (lines.length < maxLines && line.length > 0) lines.push(line.join(''));
  else if (lines.length === maxLines && line.length > 0) {
    lines[maxLines - 1] = `${lines[maxLines - 1]!.slice(0, -1)}…`;
  }
  return lines;
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * X 头像 → 位图。pbs.twimg.com 允许跨域读取（不带 cookie 也能取），
 * 顺手把 `_normal` 之类的小图换成 400×400，省得放大发虚。读不到就返回 null，由调用方画首字母。
 */
export async function loadAvatar(url: string | null | undefined): Promise<ImageBitmap | null> {
  if (!url || !/^https:\/\/pbs\.twimg\.com\//.test(url)) return null;
  const large = url.replace(
    /_(normal|bigger|mini|x96|200x200)(\.[a-z]+)(\?.*)?$/i,
    '_400x400$2',
  );
  try {
    const response = await fetch(large, { credentials: 'omit' });
    if (!response.ok) return null;
    return await createImageBitmap(await response.blob());
  } catch {
    return null;
  }
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
      'image/png',
    ),
  );
}

/** 画一个圆形头像；没有位图就画首字母。描边用调用方给的颜色。 */
export function drawAvatar(
  ctx: CanvasRenderingContext2D,
  avatar: CanvasImageSource | null,
  x: number,
  y: number,
  size: number,
  initial: string,
  ring?: string,
): void {
  const cx = x + size / 2;
  const cy = y + size / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (avatar) {
    ctx.drawImage(avatar, x, y, size, size);
  } else {
    ctx.fillStyle = '#1f2430';
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${Math.round(size * 0.45)}px ${CARD_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(initial, cx, cy + size * 0.16);
    ctx.textAlign = 'left';
  }
  ctx.restore();
  if (!ring) return;
  ctx.strokeStyle = ring;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2 + 7, 0, Math.PI * 2);
  ctx.stroke();
}
