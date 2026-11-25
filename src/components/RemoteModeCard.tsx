import { useEffect, useState } from 'react';
import { ChevronDown, Radio, TerminalSquare, X } from 'lucide-react';
import { AgentLogo, agentStatusLabels } from './AgentCard';
import { basename } from '../settings';
import { formatRemaining } from '../lib/remote-time';
import type { Pane, RemotePermission, RemoteState } from '../types';
import './RemoteModeCard.css';

interface Props {
  state: RemoteState;
  panes: Pane[];
  selected?: Pane;
  motion: boolean;
  onClose(): void;
}

export default function RemoteModeCard({state, panes, selected, motion, onClose}: Props) {
  const remote = window.desktop!.remote;
  const [ids, setIds] = useState(() => new Set(selected?.status === 'running' ? [selected.id] : []));
  const [hours, setHours] = useState(1);
  const [permission, setPermission] = useState<RemotePermission>('view');
  const [feedback, setFeedback] = useState('');
  const [qr, setQr] = useState<{link: string; image: string} | null>(null);
  const [hidden, setHidden] = useState(document.hidden);
  const available = panes.filter(pane => pane.status === 'running');
  const enabled = state.status !== 'disabled';
  const link = enabled ? state.invitation?.link : undefined;
  const message = state.status === 'disabled' ? state.message : '';
  const finished = ['Remote Mode expired.', 'Remote Mode disabled.'].includes(message);
  const status = state.status === 'starting' ? 'Starting'
    : state.status === 'active' ? state.device
      ? state.device.connected ? 'Connected' : 'Reconnecting'
      : 'Awaiting pairing'
    : finished ? 'Ended' : 'Setup';
  const phase = finished ? 'finished' : state.status === 'active'
    ? state.device?.connected ? 'connected' : state.device ? 'reconnecting' : 'pairing'
    : state.status;

  useEffect(() => {
    const change = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (link) void remote.qr(link).then(image => {
      if (!cancelled && image) setQr({link, image});
    }).catch(() => { if (!cancelled) setFeedback('Could not create the pairing QR.'); });
    return () => { cancelled = true; };
  }, [link, remote]);

  const run = (action: () => Promise<unknown>) => {
    setFeedback('');
    void action().catch(error => setFeedback(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Remote Mode action failed.'));
  };
  const start = () => {
    run(() => remote.start({ids: available.filter(pane => ids.has(pane.id)).map(pane => pane.id), hours, permission, provider: 'cloudflare'}));
  };
  const shared = selected && (enabled ? state.ids.includes(selected.id) : ids.has(selected.id));
  const toggleSession = (id: string) => {
    if (enabled) {
      run(() => state.ids.includes(id) ? remote.remove(id) : remote.share(id));
      return;
    }
    setIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return <section className={`remote-card ${motion && !hidden ? '' : 'remote-motion-off'}`} data-phase={phase} aria-label="Remote Mode">
    <header className="remote-card-header">
      <span role="status">{status}</span>
      {enabled ? <Radio size={14} aria-hidden="true"/>
        : <button type="button" className="icon-button" title="Close Remote Mode setup" onClick={onClose}><X size={14}/></button>}
    </header>
    <h2 className="poster-main remote-card-title">
      <span>Remote<span className="remote-title-break"> </span>Mode<span className="poster-period">.</span></span>
      <i className="poster-orbit remote-orbit" aria-hidden="true"/>
    </h2>
    <div className="remote-card-content">
      {message && <p role="status">{message}</p>}
      {enabled && <>
        {state.status === 'active' && !state.device && <>
          {link && qr?.link === link && <img className="remote-qr" src={qr.image} alt="Scan to pair with xTerm" width="252" height="252"/>}
          <div className="remote-qr-actions">
            {state.invitation && <small>Scan by {new Date(state.invitation.expiresAt).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})}</small>}
            <button className="remote-text-action" type="button" onClick={() => run(() => remote.regenerate())}>{link ? 'Refresh QR' : 'New pairing QR'}</button>
          </div>
        </>}
        {state.device && <div className="remote-device">
          <strong>{state.device.label}</strong>
          <span>{state.permission === 'commands' ? 'Allow commands' : 'View only'}</span>
          <button className="remote-text-action" type="button" onClick={() => run(() => remote.revoke())}>Revoke device</button>
        </div>}
        <small className="remote-provider">Cloudflare Quick Tunnel</small>
        <details className="remote-session-details">
          <summary>{state.ids.length} shared {state.ids.length === 1 ? 'terminal' : 'terminals'}<ChevronDown size={12} aria-hidden="true"/></summary>
          <SessionOptions available={available} ids={new Set(state.ids)} toggle={toggleSession}/>
        </details>
      </>}
      {!enabled && !finished && <>
        <label>Provider <select defaultValue="cloudflare"><option value="cloudflare">Cloudflare Quick Tunnel</option></select></label>
        <label>Duration <select value={hours} onChange={event => setHours(+event.target.value)}>
          {[1, 2, 3, 4, 5].map(hour => <option key={hour} value={hour}>{hour} {hour === 1 ? 'hour' : 'hours'}</option>)}
        </select></label>
        <label>Permissions <select value={permission} onChange={event => setPermission(event.target.value as RemotePermission)}>
          <option value="view">View only</option><option value="commands">Allow commands</option>
        </select></label>
        {permission === 'commands' && <p>Commands run with your local account’s permissions and can access files outside the selected terminal’s folder.</p>}
        <fieldset>
          <legend>Shared terminals</legend>
          <SessionOptions available={available} ids={ids} toggle={toggleSession}/>
        </fieldset>
      </>}
      {selected && (selected.agent || selected.ssh) && <div className="remote-harness">
        {selected.agent && <div>
          <span className={`remote-harness-icon provider-${selected.agent.provider}`}><AgentLogo agent={selected.agent}/></span>
          <span>{[selected.agent.name, selected.agent.model, agentStatusLabels[selected.agent.status]].filter(Boolean).join(' · ')}</span>
        </div>}
        {selected.ssh && <div><TerminalSquare size={13}/><span>SSH · {selected.ssh.target}</span></div>}
        {!shared && <small>Selected terminal is local only</small>}
      </div>}
      {feedback && <p role="status">{feedback}</p>}
    </div>
    {!finished && <footer className="remote-card-footer">
      {enabled ? <>
        <div className="remote-deadline"><time aria-label="Time remaining">{formatRemaining(state.remaining)}</time>
          <small>Ends {new Date(state.expiresAt).toLocaleString([], {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'})}</small></div>
        <button className="remote-primary-action" type="button" onClick={() => run(() => remote.stop())}>Disable Remote Mode</button>
      </> : <button className="remote-primary-action" type="button" onClick={start} disabled={!available.some(pane => ids.has(pane.id))}>Start Remote Mode</button>}
    </footer>}
  </section>;
}

function SessionOptions({available, ids, toggle}: {available: Pane[]; ids: Set<string>; toggle(id: string): void}) {
  return <div className="remote-session-options">
    {available.map((pane, index) => <label key={pane.id} title={pane.cwd}>
      <input type="checkbox" checked={ids.has(pane.id)} onChange={() => toggle(pane.id)}/>
      <span>{basename(pane.cwd)} · {basename(pane.shell)} · {index + 1}</span>
    </label>)}
    {!available.length && <p>Open a terminal to share it.</p>}
  </div>;
}
