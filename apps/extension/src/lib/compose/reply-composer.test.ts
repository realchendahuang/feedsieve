// @vitest-environment happy-dom
import { beforeEach, expect, it } from 'vitest';
import { fillReplyComposer, findArticle } from './reply-composer';

const noWait = async () => {};

beforeEach(() => {
  document.body.innerHTML = '';
});

function tweet(postId: string): HTMLElement {
  const article = document.createElement('article');
  article.dataset.testid = 'tweet';
  article.innerHTML = `
    <div data-testid="User-Name"><a href="/farm">Farm</a></div>
    <div data-testid="tweetText">text</div>
    <div role="group">
      <a href="/farm/status/${postId}">1h</a>
      <button data-testid="reply">reply</button>
    </div>`;
  return article;
}

/** 点「回复」后 X 打开的那个对话框：带正文编辑器和一个附件区 */
function openDialog(mount: () => void, withEditor = true, withFileInput = true) {
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  if (withEditor) {
    // 真实 X 还挂着两个不可编辑的同前缀容器（2026-11-11 核实），必须一起造出来
    const label = document.createElement('div');
    label.dataset.testid = 'tweetTextarea_0_label';
    const container = document.createElement('div');
    container.dataset.testid = 'tweetTextarea_0RichTextInputContainer';
    const editor = document.createElement('div');
    editor.dataset.testid = 'tweetTextarea_0';
    editor.setAttribute('role', 'textbox');
    editor.contentEditable = 'true';
    dialog.append(label, container, editor);
  }
  const attachments = document.createElement('div');
  attachments.dataset.testid = 'attachments';
  dialog.appendChild(attachments);
  if (withFileInput) {
    const input = document.createElement('input');
    input.type = 'file';
    input.dataset.testid = 'fileInput';
    dialog.appendChild(input);
  }
  document.body.appendChild(dialog);
  mount();
  return { dialog, attachments };
}

/** 模拟 X 收到文件后把预览图放进附件区；返回被塞进 input / paste 的文件名 */
function fakeUpload(host: HTMLElement): { names: string[] } {
  const names: string[] = [];
  const attachments = host.querySelector('[data-testid="attachments"]')!;
  const input = host.querySelector<HTMLInputElement>('input[type="file"]');
  if (input) {
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      names.push(file.name);
      attachments.appendChild(document.createElement('img'));
    });
  }
  return { names };
}

it('找到帖子、点回复、把图塞进 X 自己的文件入口，不点发送', async () => {
  document.body.appendChild(tweet('900'));
  const button = document.querySelector('[data-testid="reply"]') as HTMLButtonElement;
  let upload = { names: [] as string[] };
  button.addEventListener('click', () => {
    const { dialog } = openDialog(() => undefined);
    upload = fakeUpload(dialog);
  });

  const outcome = await fillReplyComposer({
    postId: '900',
    blob: new Blob(['x'], { type: 'image/png' }),
    wait: noWait,
  });

  expect(outcome).toEqual({ ok: true });
  expect(upload.names).toEqual(['ai-flavor.png']);
  // 回复框里有图，但没有任何「点发送」的动作：发送按钮还是用户自己按
  expect(button.hasAttribute('disabled')).toBe(false);
});

it('没有文件入口时退回合成粘贴', async () => {
  document.body.appendChild(tweet('901'));
  const button = document.querySelector('[data-testid="reply"]') as HTMLButtonElement;
  const pasted: string[] = [];
  button.addEventListener('click', () => {
    const { dialog, attachments } = openDialog(() => undefined, true, false);
    dialog.querySelector('[data-testid="tweetTextarea_0"]')!.addEventListener('paste', (event) => {
      const transfer = (event as ClipboardEvent).clipboardData!;
      const file = transfer.files[0]!;
      pasted.push(file.name);
      attachments.appendChild(document.createElement('img'));
    });
  });

  const outcome = await fillReplyComposer({
    postId: '901',
    blob: new Blob(['x'], { type: 'image/png' }),
    filename: 'card.png',
    wait: noWait,
  });

  expect(outcome).toEqual({ ok: true });
  expect(pasted).toEqual(['card.png']);
});

it('找不到帖子 / 没有回复按钮 / 回复框没开 / 上传超时 各自给出原因', async () => {
  const blob = new Blob(['x'], { type: 'image/png' });
  expect(await fillReplyComposer({ postId: '404', blob, wait: noWait })).toEqual({
    ok: false,
    reason: 'no_article',
  });

  document.body.innerHTML = '<article data-testid="tweet"><a href="/a/status/5">1h</a></article>';
  expect(await fillReplyComposer({ postId: '5', blob, wait: noWait })).toEqual({
    ok: false,
    reason: 'no_reply_button',
  });

  document.body.innerHTML = '';
  document.body.appendChild(tweet('6'));
  // 点了回复，但对话框里没有编辑器
  document.querySelector('[data-testid="reply"]')!.addEventListener('click', () => {
    openDialog(() => undefined, false);
  });
  expect(await fillReplyComposer({ postId: '6', blob, wait: noWait, waitMs: 1 })).toEqual({
    ok: false,
    reason: 'no_editor',
  });

  document.body.innerHTML = '';
  document.body.appendChild(tweet('7'));
  // 有编辑器，但 X 一直不把图放进附件区
  document.querySelector('[data-testid="reply"]')!.addEventListener('click', () => {
    openDialog(() => undefined);
  });
  expect(await fillReplyComposer({ postId: '7', blob, wait: noWait, waitMs: 1 })).toEqual({
    ok: false,
    reason: 'upload_timeout',
  });
});

it('详情页的回复框是内联的（没有 dialog）：不新开节点也能填进去', async () => {
  document.body.appendChild(tweet('920'));
  const article = document.querySelector('article')!;
  // 详情页：回复框直接长在帖子里，点回复只是把焦点给它
  const inline = document.createElement('div');
  inline.innerHTML = `
    <div data-testid="tweetTextarea_0" contenteditable="true"></div>
    <div data-testid="attachments"></div>
    <input type="file" data-testid="fileInput" />`;
  article.appendChild(inline);
  const attachments = inline.querySelector('[data-testid="attachments"]')!;
  inline.querySelector('input')!.addEventListener('change', () => {
    attachments.appendChild(document.createElement('img'));
  });
  // 并挂一个侧栏主发帖框的 file input：不能误用它
  const sidebar = document.createElement('div');
  sidebar.innerHTML = `<div data-testid="tweetTextarea_1" contenteditable="true"></div>
    <input type="file" data-testid="fileInput" />`;
  document.body.appendChild(sidebar);

  const outcome = await fillReplyComposer({
    postId: '920',
    blob: new Blob(['x'], { type: 'image/png' }),
    wait: noWait,
  });

  expect(outcome).toEqual({ ok: true });
  expect(attachments.querySelectorAll('img')).toHaveLength(1);
  expect(sidebar.querySelector('[data-testid="attachments"]')).toBeNull();
});

it('不把 tweetTextarea_0_label / RichTextInputContainer 这类壳子当成正文框', async () => {
  document.body.appendChild(tweet('930'));
  let focused = '';
  document.querySelector('[data-testid="reply"]')!.addEventListener('click', () => {
    const { dialog } = openDialog(() => undefined, true, false);
    dialog
      .querySelectorAll('[data-testid^="tweetTextarea_"]')
      .forEach((n) =>
        n.addEventListener('focus', () => (focused = n.getAttribute('data-testid')!)),
      );
  });
  await fillReplyComposer({
    postId: '930',
    blob: new Blob(['x'], { type: 'image/png' }),
    wait: noWait,
    waitMs: 1,
  });
  // 只有真正可编辑的那个节点会被 focus，壳子不会
  expect(focused).toBe('tweetTextarea_0');
});

it('fileInput 比编辑器晚渲染时也会等它，不掉进兜底分支', async () => {
  document.body.appendChild(tweet('940'));
  document.querySelector('[data-testid="reply"]')!.addEventListener('click', () => {
    // 先只造编辑器，文件入口 120ms 后才挂上（真实 X 的一拍延迟）
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const editor = document.createElement('div');
    editor.dataset.testid = 'tweetTextarea_0';
    editor.contentEditable = 'true';
    const attachments = document.createElement('div');
    attachments.dataset.testid = 'attachments';
    dialog.append(editor, attachments);
    document.body.appendChild(dialog);
    setTimeout(() => {
      const input = document.createElement('input');
      input.type = 'file';
      input.dataset.testid = 'fileInput';
      input.addEventListener('change', () => {
        attachments.appendChild(document.createElement('img'));
      });
      dialog.appendChild(input);
    }, 120);
  });

  const outcome = await fillReplyComposer({
    postId: '940',
    blob: new Blob(['x'], { type: 'image/png' }),
    waitMs: 2_000,
  });

  expect(outcome).toEqual({ ok: true });
});

it('findArticle 按帖子 ID 找，且能跟上 X 换节点', () => {
  document.body.appendChild(tweet('910'));
  expect(findArticle('910')?.querySelector('a[href*="/status/910"]')).not.toBeNull();
  document.body.innerHTML = '';
  expect(findArticle('910')).toBeNull();
  document.body.appendChild(tweet('911'));
  expect(findArticle('911')).not.toBeNull();
});
