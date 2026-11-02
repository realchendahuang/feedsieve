// @vitest-environment happy-dom
// 漏网账号手动拉黑：必须先选原因；reason=null 表示「仅拉黑」不参与社区。
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
import BlockedPage from './BlockedPage';

vi.mock('../../../../src/lib/community/blocked-accounts', () => ({
  getBlockedAccounts: vi.fn(async () => []),
  subscribeBlocked: vi.fn(() => () => {}),
}));

const mountedRoots: Array<{ unmount: () => void }> = [];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  act(() => {
    for (const root of mountedRoots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

function setInputValue(input: HTMLInputElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function pickReason(select: HTMLSelectElement, value: string): void {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function render(
  sendToXPage = vi.fn().mockResolvedValue({ ok: true, handle: 'spam_user' }),
): Promise<{ rootEl: HTMLElement; sendToXPage: ReturnType<typeof vi.fn> }> {
  const rootEl = document.createElement('div');
  document.body.append(rootEl);
  const root = ReactDOM.createRoot(rootEl);
  mountedRoots.push(root);
  act(() => {
    root.render(
      <BlockedPage
        language="zh"
        notify={vi.fn()}
        sendToXPage={sendToXPage}
        refreshPageMarked={vi.fn().mockResolvedValue(undefined)}
        pauseDestructive={false}
      />,
    );
  });
  await act(async () => {});
  return { rootEl, sendToXPage };
}

it('没选原因时不能提交；选了原因就按分类上报', async () => {
  const { rootEl, sendToXPage } = await render();
  const input = rootEl.querySelector<HTMLInputElement>('#manual-spam-handle')!;
  const select = rootEl.querySelector<HTMLSelectElement>('.manual-reason-select')!;
  const submit = rootEl.querySelector<HTMLButtonElement>('form button[type="submit"]')!;

  setInputValue(input, 'spam_user');
  expect(submit.disabled).toBe(true);

  pickReason(select, 'advertising');
  expect(submit.disabled).toBe(false);

  await act(async () => {
    rootEl
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(sendToXPage).toHaveBeenCalledWith({
    type: 'feedsieve:manual-spam-block',
    handle: 'spam_user',
    reason: 'advertising',
  });
});

it('选「仅拉黑」时上报 null，不参与社区计票', async () => {
  const { rootEl, sendToXPage } = await render();
  setInputValue(rootEl.querySelector<HTMLInputElement>('#manual-spam-handle')!, 'spam_user');
  pickReason(rootEl.querySelector<HTMLSelectElement>('.manual-reason-select')!, 'personal');

  await act(async () => {
    rootEl
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(sendToXPage).toHaveBeenCalledWith({
    type: 'feedsieve:manual-spam-block',
    handle: 'spam_user',
    reason: null,
  });
});
