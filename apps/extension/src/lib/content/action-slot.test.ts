// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { REDESIGN_TWEET_HTML } from '../../../../../fixtures/x/timeline/redesign';
import { createActionSlot } from './action-slot';

afterEach(() => document.body.replaceChildren());

it('does not copy native X engagement/menu markers or duplicate grouped buttons onto injected actions', () => {
  document.body.innerHTML = REDESIGN_TWEET_HTML;
  const group = document.querySelector('[role="group"]')!;
  // Both bookmark and share sit inside the same right-hand flex wrapper on redesigned X.
  group
    .querySelector('[data-engagement-action="bookmark"] button')!
    .insertAdjacentHTML('beforeend', '<svg viewBox="0 0 24 24"><path d="M0 0h1"/></svg>');
  group
    .querySelector('[data-engagement-action="share"]')!
    .insertAdjacentHTML('beforeend', '<svg viewBox="0 0 24 24"><path d="M1 1h2"/></svg>');
  const slot = createActionSlot(group, 'block', 'Block account');
  group.append(slot.root);
  expect(slot.root.tagName).toBe('DIV');
  expect(slot.root.querySelectorAll('button')).toHaveLength(1);
  expect(slot.button.querySelector('.fs-act-ico')).not.toBeNull();
  expect(slot.root.querySelector('[data-engagement-action], [data-slot]')).toBeNull();
  expect(slot.root.hasAttribute('data-engagement-action')).toBe(false);
  expect(slot.root.getAttribute('data-fs-action')).toBe('block');
  expect(group.querySelectorAll('[data-engagement-action="share"]')).toHaveLength(1);
});
