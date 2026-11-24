import { ArrowUpRight, Download, LoaderCircle, RefreshCw, RotateCcw, X } from 'lucide-react';
import type { UpdateAction, UpdateState } from '../types';

interface Props { state: UpdateState; onAction(action: UpdateAction): void; busy: boolean }
export default function UpdateNotice({ state, onAction, busy }: Props) {
  if (state.dismissed || state.status === 'idle') return null;
  const loading = ['checking', 'downloading', 'installing'].includes(state.status);
  const heading = state.status === 'available' ? `xTerm v${state.version} is available` :
    state.status === 'ready' ? `xTerm v${state.version} is ready` :
    state.status === 'downloading' ? `Downloading xTerm v${state.version}` :
    state.status === 'checking' ? 'Checking for updates...' :
    state.status === 'up-to-date' ? 'xTerm is up to date' :
    state.status === 'installing' ? 'Verifying and restarting...' :
    state.status === 'unavailable' ? 'Updates unavailable' : 'Update failed';
  return <section className={`update-notice update-${state.status}`} aria-label="Application update">
    <div className="update-copy">
      <div role="status" aria-live="polite" aria-atomic="true">
        <strong>{loading && <LoaderCircle className="spinning" size={14}/>} {heading}</strong>
        {state.message && <p>{state.message}</p>}
      </div>
      {state.status === 'downloading' && <div className="update-progress">
        <progress aria-label="Update download progress" max={100} value={state.progress ?? 0}/>
        <span>{state.progress ?? 0}%</span>
      </div>}
    </div>
    <div className="update-actions">
      {state.releaseUrl && <button title={`Release notes for v${state.version}`} onClick={() => void window.desktop?.openExternal(state.releaseUrl!)}><ArrowUpRight size={14}/><span>Release notes</span></button>}
      {state.status === 'available' && <button className="update-primary" disabled={busy} onClick={() => onAction('download')}><Download size={14}/>Download update</button>}
      {state.status === 'ready' && <button className="update-primary" disabled={busy} onClick={() => onAction('restart')}><RotateCcw size={14}/>Restart and update</button>}
      {state.status === 'error' && <>
        {state.version && <button disabled={busy} onClick={() => onAction('download')}><Download size={14}/>Retry download</button>}
        <button disabled={busy} onClick={() => onAction('check')}><RefreshCw size={14}/>Check again</button>
      </>}
      {state.status !== 'installing' && <button title="Defer update notification" disabled={busy && state.status !== 'downloading'} onClick={() => onAction('later')}>
        <X size={14}/>{['available', 'downloading', 'ready'].includes(state.status) && <span>Later</span>}
      </button>}
    </div>
  </section>;
}
