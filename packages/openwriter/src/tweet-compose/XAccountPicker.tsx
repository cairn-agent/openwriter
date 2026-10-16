/**
 * Which X account a document posts as. /api/x/status lists every platform X
 * account; the document stores its choice as top-level metadata `xAccount`.
 * One account needs no choice. With two or more, the document has none until
 * the writer picks, and posting waits for that pick.
 *
 * adr: adr/x-accounts.md
 */
import { useCallback, useEffect, useState } from 'react';
import './XAccountPicker.css';

export interface XAccount {
  id: string;
  username: string;
}

export function useXAccount(docAccount?: string) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [pluginUsername, setPluginUsername] = useState<string | undefined>();
  const [accounts, setAccounts] = useState<XAccount[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/x/status');
      if (!res.ok) { setConnected(false); return; }
      const data = await res.json();
      setConnected(!!data.connected);
      setPluginUsername(data.username);
      setAccounts(Array.isArray(data.accounts) ? data.accounts : []);
    } catch {
      setConnected(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const selected = accounts.find((a) => a.id === docAccount)
    ?? (accounts.length === 1 ? accounts[0] : undefined);

  const select = useCallback((id: string) => {
    fetch('/api/metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xAccount: id }),
      keepalive: true,
    }).catch(() => {});
  }, []);

  return {
    connected,
    accounts,
    /** Platform connection id to post with; undefined when posting via the x-api plugin or unpicked. */
    connectionId: selected?.id,
    username: selected?.username ?? pluginUsername,
    /** Two or more accounts and none picked for this document. */
    needsChoice: accounts.length > 1 && !selected,
    select,
    refresh,
  };
}

interface XAccountPickerProps {
  accounts: XAccount[];
  value?: string;
  onChange: (id: string) => void;
}

/** Account dropdown, shown only when there is a choice to make. */
export default function XAccountPicker({ accounts, value, onChange }: XAccountPickerProps) {
  if (accounts.length < 2) return null;
  return (
    <select
      className={`x-account-picker${value ? '' : ' x-account-picker--unset'}`}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      title="X account this document posts as"
    >
      <option value="" disabled>Post as…</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>@{a.username}</option>
      ))}
    </select>
  );
}
