import {useEffect, useState} from 'react';
import {Bot, Server, Timer} from 'lucide-react';
import type {AgentInfo, SshInfo} from '../types';

const address = (endpoint: SshInfo['endpoint']) => endpoint ?
  `${endpoint.address.includes(':') ? `[${endpoint.address}]` : endpoint.address}:${endpoint.port}` : 'Unavailable';
const harnessLabels = {working: 'Working', ready: 'Ready for input', attention: 'Needs attention', running: 'Running'};

export default function SshCard({ssh, agent}: {ssh: SshInfo; agent: AgentInfo | null}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ssh.pid, ssh.startedAt]);
  const seconds = Math.max(0, Math.floor((now - ssh.startedAt) / 1000));
  const duration = `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  return <section className="ssh-card" aria-label="SSH connection">
    <header><span><Server size={13}/>SSH</span><span role="status" title={ssh.statusDetail}>{ssh.status === 'connecting' ? 'Connecting' : 'Unknown'}</span></header>
    <div className="ssh-target"><span>DESTINATION / ALIAS</span><h3 title={ssh.target}>{ssh.target}</h3></div>
    <div className="ssh-metadata">
      <dl>
        <dt>Configured host</dt><dd>{ssh.configuredHost || 'Unavailable'}</dd>
        <dt>User / port</dt><dd>{ssh.user || 'Unavailable'} / {ssh.port ?? 'Unavailable'}</dd>
        <dt>Destination IP</dt><dd>{address(ssh.endpoint)}</dd>
        <dt>Remote hostname</dt><dd>{ssh.remoteHostname || 'Not reported'}</dd>
        {ssh.jumpHost && <><dt>Jump host</dt><dd>{ssh.jumpHost}</dd></>}
        {ssh.transportEndpoint && !ssh.endpoint && <><dt>Transport peer</dt><dd>{address(ssh.transportEndpoint)}</dd></>}
        <dt>Authentication</dt><dd>Unknown</dd>
        <dt>Transport</dt><dd>{ssh.transportEndpoint ? 'TCP established' : ssh.status === 'connecting' ? 'TCP handshake' : 'Unavailable'}</dd>
        <dt>First observed</dt><dd><time dateTime={new Date(ssh.startedAt).toISOString()}>{new Date(ssh.startedAt).toLocaleTimeString()}</time></dd>
      </dl>
      {agent && <div className="ssh-harness" aria-label="Harness within SSH context"><span><Bot size={12}/>HARNESS</span><strong>{agent.name}</strong><span>{harnessLabels[agent.status]}</span><span>{agent.model || 'Model not reported'}</span></div>}
    </div>
    <footer><span><Timer size={11}/>Observed process time</span><time>{duration}</time></footer>
  </section>;
}
