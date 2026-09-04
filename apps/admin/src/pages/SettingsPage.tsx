import { useQuery } from '@tanstack/react-query';
import { Loading, PageHeader } from '../components/layout';
import { getMe } from '../lib/api';

export function SettingsPage() {
  const me = useQuery({ queryKey: ['me'], queryFn: getMe });
  return <section className="page"><PageHeader title="后台设置" />{!me.data ? <Loading error={me.error} /> : <div className="settings-value"><span>维护者邮箱</span><strong>{me.data.email}</strong></div>}</section>;
}
