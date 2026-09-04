import React from 'react';
import { Link, Outlet } from '@tanstack/react-router';
import { errorText } from '../lib/errors';

const navigation = [
  ['/', '概览'],
  ['/accounts', '账号'],
  ['/keywords', '词库'],
  ['/feedback', '反馈'],
  ['/releases', '发布'],
  ['/settings', '设置'],
] as const;

export function Layout() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">FeedSieve</div>
        <nav aria-label="管理导航">
          {navigation.map(([to, label]) => <Link key={to} to={to} activeProps={{ className: 'active' }}>{label}</Link>)}
        </nav>
      </aside>
      <main className="main"><Outlet /></main>
    </div>
  );
}

export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return <header className="page-header"><h1>{title}</h1>{children ? <div className="actions">{children}</div> : null}</header>;
}

export function Loading({ error }: { error?: unknown }) {
  return <div className="empty-state">{error ? errorText(error) : '读取中…'}</div>;
}
