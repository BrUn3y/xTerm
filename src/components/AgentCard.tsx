import { useEffect, useState } from 'react';
import { Activity, ArrowUpRight, Bot, ChevronRight, Cpu, Sparkles } from 'lucide-react';
import openaiLogo from '../assets/openai.svg';
import claudeLogo from '../assets/claude.svg';
import type { AgentInfo } from '../types';

const labels = {working: 'Working', ready: 'Ready for input', attention: 'Needs attention', running: 'Running'};
function AgentLogo({agent}: {agent: AgentInfo}) {
  if (agent.provider === 'codex') return <img src={openaiLogo} alt="OpenAI"/>;
  if (agent.provider === 'claude') return <img src={claudeLogo} alt="Claude"/>;
  if (agent.provider === 'bob') return <span className="bob-avatar" aria-label="Bob">b<span>_</span></span>;
  if (agent.provider === 'gemini') return <Sparkles size={27}/>;
  return <Bot size={28}/>;
}
export default function AgentCard({agent}: {agent: AgentInfo | null}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!agent) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [agent?.startedAt]);
  if (!agent) return <div className="poster" aria-hidden="true"><div className="poster-top"><span>NO. 001 — XTERM</span><span>↗</span></div><div className="poster-main"><span>MAKE<br/>IT<br/>HAPPEN<span className="poster-period">.</span></span><div className="poster-orbit"/></div><div className="poster-bottom"><span>LESS NOISE.<br/>MORE POSSIBILITIES.</span><div className="barcode"/></div><div className="poster-cross">+</div></div>;
  const seconds = Math.max(0, Math.floor((now - agent.startedAt) / 1000));
  const duration = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  return <section className={`agent-card status-${agent.status}`} aria-label={`${agent.name} agent activity`}>
    <header className="agent-card-top"><span><i/> AGENT MODE ACTIVE</span><ArrowUpRight size={14}/></header>
    <div className="agent-identity"><div className={`agent-avatar provider-${agent.provider}`}><AgentLogo agent={agent}/></div><div><span>CONNECTED HARNESS</span><h3>{agent.name}</h3></div></div>
    <div className="agent-model"><div><Cpu size={11}/><span>LANGUAGE MODEL</span></div><strong title={agent.model ? agent.modelSource === 'reported' ? 'Model reported in this terminal' : 'Model specified in launch arguments' : 'This harness has not reported its model'}><span>{agent.model || 'Not reported'}</span><ChevronRight size={11}/></strong></div>
    <div className="agent-status-row"><span className="agent-status" role="status"><i/>{labels[agent.status]}</span><span className="agent-meter" aria-hidden="true">{Array.from({length:9}, (_,index) => <i key={index} style={{animationDelay:`${index * 85}ms`}}/>)}</span></div>
    <footer><span><Activity size={10}/>{agent.activitySource === 'reported' ? 'LIVE AGENT SIGNAL' : agent.activitySource === 'terminal' ? 'TERMINAL ACTIVITY' : 'PROCESS CONNECTED'}</span><time>{duration}</time></footer>
  </section>;
}
