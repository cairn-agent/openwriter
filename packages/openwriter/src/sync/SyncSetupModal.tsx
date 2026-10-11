import { useCallback, useEffect, useRef, useState } from 'react';
import './SyncSetupModal.css';

interface SyncCapabilities {
  gitInstalled: boolean;
  ghInstalled: boolean;
  ghAuthenticated: boolean;
  existingRepo: boolean;
  remoteUrl?: string;
  /** A GitHub token is stored (signed in, or a PAT pasted before). */
  signedIn?: boolean;
  /** "Sign in with GitHub" (device flow) is available on this server. */
  deviceFlow?: boolean;
}

interface SyncSetupModalProps {
  onClose: () => void;
  onSetupComplete: () => void;
}

type Phase = 'detecting' | 'setup' | 'progress' | 'done' | 'error';
type Mode = 'gh' | 'github' | 'pat' | 'connect';
interface DeviceCode { userCode: string; verificationUri: string; interval: number }

export default function SyncSetupModal({ onClose, onSetupComplete }: SyncSetupModalProps) {
  const [phase, setPhase] = useState<Phase>('detecting');
  const [caps, setCaps] = useState<SyncCapabilities | null>(null);
  const [mode, setMode] = useState<Mode>('gh');
  const [repoName, setRepoName] = useState('openwriter-docs');
  const [isPrivate, setIsPrivate] = useState(true);
  const [pat, setPat] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [progressMsg, setProgressMsg] = useState('');
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [signedIn, setSignedIn] = useState(false);
  const [deviceCode, setDeviceCode] = useState<DeviceCode | null>(null);
  const [deviceMsg, setDeviceMsg] = useState('');
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detect capabilities on mount
  useEffect(() => {
    fetch('/api/sync/capabilities')
      .then((r) => r.json())
      .then((data: SyncCapabilities) => {
        setCaps(data);
        setSignedIn(!!data.signedIn);
        if (data.ghAuthenticated) setMode('gh');
        else if (data.deviceFlow) setMode('github');
        else setMode('pat');
        setPhase('setup');
      })
      .catch(() => {
        setErrorMsg('Failed to detect git capabilities');
        setPhase('error');
      });
  }, []);

  useEffect(() => () => { if (pollTimer.current) clearTimeout(pollTimer.current); }, []);

  // "Sign in with GitHub": show the code, then ask the server every few
  // seconds whether GitHub has approved it. adr: adr/two-way-sync.md
  const poll = useCallback((interval: number) => {
    pollTimer.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/sync/device/poll', { method: 'POST' });
        const data = await res.json();
        if (data.status === 'pending') { poll(data.interval || interval); return; }
        setDeviceCode(null);
        if (data.status === 'done') { setSignedIn(true); setDeviceMsg(''); return; }
        setDeviceMsg(data.status === 'expired' ? 'The code expired. Get a new one.'
          : data.status === 'denied' ? 'Sign-in was cancelled on GitHub.'
          : data.error || 'Sign-in failed. Try again.');
      } catch {
        setDeviceCode(null);
        setDeviceMsg('Sign-in failed. Try again.');
      }
    }, interval * 1000);
  }, []);

  const startSignIn = useCallback(async () => {
    setDeviceMsg('');
    try {
      const res = await fetch('/api/sync/device/start', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start sign-in');
      setDeviceCode(data);
      poll(data.interval || 5);
    } catch (err: any) {
      setDeviceMsg(err.message);
    }
  }, [poll]);

  const handleSetup = useCallback(async () => {
    setPhase('progress');
    setProgressMsg(mode === 'connect' ? 'Connecting and getting your documents from GitHub...' : 'Creating repository and syncing...');

    try {
      // 'github' creates a repo with the signed-in token: the server's PAT
      // path, with the stored token instead of a pasted one.
      const method = mode === 'github' ? 'pat' : mode;
      const body: Record<string, any> = { method, repoName, isPrivate };
      if (mode === 'pat') body.pat = pat;
      if (mode === 'connect') { body.remoteUrl = remoteUrl; body.pat = pat || undefined; }

      const res = await fetch('/api/sync/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Setup failed (${res.status})`);

      setConflicts(data.conflicts || []);
      setPhase('done');
      onSetupComplete();
    } catch (err: any) {
      setErrorMsg(err.message);
      setPhase('error');
    }
  }, [mode, repoName, isPrivate, pat, remoteUrl, onSetupComplete]);

  return (
    <div className="sync-modal-overlay" onClick={onClose}>
      <div className="sync-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sync-modal-header">
          <h2>Sync with GitHub</h2>
          <button className="sync-modal-close" onClick={onClose}>&times;</button>
        </div>

        {phase === 'detecting' && (
          <div className="sync-modal-body">
            <div className="sync-spinner" />
            <p>Detecting git configuration...</p>
          </div>
        )}

        {phase === 'setup' && caps && (
          <div className="sync-modal-body">
            {!caps.gitInstalled && (
              <div className="sync-warning">
                Git is not installed. Please <a href="https://git-scm.com/downloads" target="_blank" rel="noreferrer">install git</a> first.
              </div>
            )}

            {caps.gitInstalled && (
              <>
                <p className="sync-hint">
                  Sync works both ways: your changes go up to GitHub, and changes made in your other OpenWriter come back down.
                </p>

                {/* Mode tabs */}
                <div className="sync-tabs">
                  {caps.ghAuthenticated && (
                    <button className={`sync-tab${mode === 'gh' ? ' active' : ''}`} onClick={() => setMode('gh')}>
                      GitHub CLI
                    </button>
                  )}
                  {caps.deviceFlow && (
                    <button className={`sync-tab${mode === 'github' ? ' active' : ''}`} onClick={() => setMode('github')}>
                      Sign in with GitHub
                    </button>
                  )}
                  <button className={`sync-tab${mode === 'pat' ? ' active' : ''}`} onClick={() => setMode('pat')}>
                    Personal Access Token
                  </button>
                  <button className={`sync-tab${mode === 'connect' ? ' active' : ''}`} onClick={() => setMode('connect')}>
                    Connect Existing
                  </button>
                </div>

                {/* gh CLI mode */}
                {mode === 'gh' && (
                  <div className="sync-form">
                    <label>
                      Repository name
                      <input type="text" value={repoName} onChange={(e) => setRepoName(e.target.value)} placeholder="openwriter-docs" />
                    </label>
                    <label className="sync-checkbox">
                      <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
                      Private repository
                    </label>
                  </div>
                )}

                {/* Sign in with GitHub (device flow) */}
                {mode === 'github' && (
                  <div className="sync-form">
                    {!signedIn && !deviceCode && (
                      <>
                        <p className="sync-hint">GitHub gives you a short code to enter on github.com. Nothing to install.</p>
                        <button className="sync-btn primary" onClick={startSignIn}>Get sign-in code</button>
                      </>
                    )}
                    {!signedIn && deviceCode && (
                      <>
                        <p className="sync-hint">
                          Open <a href={deviceCode.verificationUri} target="_blank" rel="noreferrer">{deviceCode.verificationUri}</a> and enter this code:
                        </p>
                        <div className="sync-device-code">{deviceCode.userCode}</div>
                        <p className="sync-hint">Waiting for GitHub...</p>
                      </>
                    )}
                    {deviceMsg && <div className="sync-warning">{deviceMsg}</div>}
                    {signedIn && (
                      <>
                        <p className="sync-hint">Signed in to GitHub. Create a new repository, or use Connect Existing to bring down documents you already have.</p>
                        <label>
                          Repository name
                          <input type="text" value={repoName} onChange={(e) => setRepoName(e.target.value)} placeholder="openwriter-docs" />
                        </label>
                        <label className="sync-checkbox">
                          <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
                          Private repository
                        </label>
                      </>
                    )}
                  </div>
                )}

                {/* PAT mode */}
                {mode === 'pat' && (
                  <div className="sync-form">
                    {!caps.ghAuthenticated && !caps.ghInstalled && (
                      <p className="sync-hint">
                        Create a <a href="https://github.com/settings/tokens/new?scopes=repo&description=OpenWriter" target="_blank" rel="noreferrer">Personal Access Token</a> with <code>repo</code> scope.
                      </p>
                    )}
                    <label>
                      Personal Access Token
                      <input type="password" value={pat} onChange={(e) => setPat(e.target.value)} placeholder="ghp_..." />
                    </label>
                    <label>
                      Repository name
                      <input type="text" value={repoName} onChange={(e) => setRepoName(e.target.value)} placeholder="openwriter-docs" />
                    </label>
                    <label className="sync-checkbox">
                      <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
                      Private repository
                    </label>
                  </div>
                )}

                {/* Connect existing mode */}
                {mode === 'connect' && (
                  <div className="sync-form">
                    <p className="sync-hint">
                      Brings down every document in the repository. Documents already here are kept; if one changed in both places, GitHub's copy is saved next to yours.
                    </p>
                    <label>
                      Remote URL
                      <input type="text" value={remoteUrl} onChange={(e) => setRemoteUrl(e.target.value)} placeholder="https://github.com/user/repo.git" />
                    </label>
                    <label>
                      {signedIn ? 'PAT (optional, you are signed in)' : 'PAT (optional, for private repos)'}
                      <input type="password" value={pat} onChange={(e) => setPat(e.target.value)} placeholder="ghp_..." />
                    </label>
                  </div>
                )}

                <div className="sync-modal-actions">
                  <button className="sync-btn secondary" onClick={onClose}>Cancel</button>
                  <button
                    className="sync-btn primary"
                    onClick={handleSetup}
                    disabled={
                      (mode === 'pat' && !pat) ||
                      (mode === 'github' && !signedIn) ||
                      (mode === 'connect' && !remoteUrl) ||
                      (mode !== 'connect' && !repoName)
                    }
                  >
                    {mode === 'connect' ? 'Connect & Sync' : 'Create & Sync'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {phase === 'progress' && (
          <div className="sync-modal-body">
            <div className="sync-spinner" />
            <p>{progressMsg}</p>
          </div>
        )}

        {phase === 'done' && (
          <div className="sync-modal-body">
            <div className="sync-success-icon">&#10003;</div>
            <p>Your documents are synced with GitHub.</p>
            {conflicts.length > 0 && (
              <div className="sync-warning">
                These files changed in both places. Yours were kept, and GitHub's versions were saved next to them:
                <ul>{conflicts.map((f) => <li key={f}>{f}</li>)}</ul>
              </div>
            )}
            <div className="sync-modal-actions">
              <button className="sync-btn primary" onClick={onClose}>Done</button>
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="sync-modal-body">
            <div className="sync-error-msg">{errorMsg}</div>
            <div className="sync-modal-actions">
              <button className="sync-btn secondary" onClick={() => setPhase('setup')}>Back</button>
              <button className="sync-btn secondary" onClick={onClose}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
