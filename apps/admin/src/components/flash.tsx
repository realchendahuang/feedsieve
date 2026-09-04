import React from 'react';

export type Flash = { tone: 'success' | 'error'; text: string } | null;

export function useFlash(): [Flash, (tone: 'success' | 'error', text: string) => void] {
  const [flash, setFlash] = React.useState<Flash>(null);
  const timer = React.useRef<number | null>(null);
  React.useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  return [flash, (tone, text) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setFlash({ tone, text });
    timer.current = window.setTimeout(() => setFlash(null), 4000);
  }];
}

export function FlashMessage({ flash }: { flash: Flash }) {
  return flash ? <div className={`flash ${flash.tone}`} role="status">{flash.text}</div> : null;
}
