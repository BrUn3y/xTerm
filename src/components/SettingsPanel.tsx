import { ArrowDownLeft, Check, Minus, Plus, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { defaultSettings, fonts } from '../settings';
import type { AppInfo, Settings } from '../types';
interface Props { settings: Settings; info: AppInfo | null; onChange(value: Settings): void; onClose(): void; shell: string; onShell(value: string): void }
export default function SettingsPanel({settings, info, onChange, onClose, shell, onShell}: Props) {
  const change = <K extends keyof Settings>(key: K, value: Settings[K]) => onChange({...settings, [key]: value});
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="modal-top"><span><SlidersHorizontal size={15}/> MAKE IT YOURS</span><button className="icon-button" onClick={onClose} title="Close preferences"><X size={20}/></button></div>
      <header className="settings-title"><span className="section-code">PREFERENCES / 01</span><h2 id="settings-title">Your terminal.<br/>Your rules<span>.</span></h2><p>Changes are saved automatically.</p></header>
      <div className="settings-scroll">
        <div className="setting-section"><label className="setting-label" htmlFor="terminal-font">Typography <span>01</span></label>
          <select id="terminal-font" value={settings.font} onChange={event => change('font', event.target.value)}>{fonts.map(font => <option key={font.name} value={font.value}>{font.name}</option>)}</select>
          <div className="font-preview" style={{fontFamily: settings.font}}><span>Aa Bb 0123</span><code>const possibilities = ∞;</code></div>
          <div className="setting-row"><label>Font size</label><div className="stepper"><button title="Decrease font size" disabled={settings.fontSize <= 10} onClick={() => change('fontSize', settings.fontSize - 1)}><Minus size={13}/></button><span>{settings.fontSize} <small>px</small></span><button title="Increase font size" disabled={settings.fontSize >= 24} onClick={() => change('fontSize', settings.fontSize + 1)}><Plus size={13}/></button></div></div>
          <div className="setting-row"><label htmlFor="line-height">Line spacing</label><select id="line-height" value={settings.lineHeight} onChange={event => change('lineHeight', Number(event.target.value))}><option value={1.25}>Compact</option><option value={1.45}>Normal</option><option value={1.65}>Comfortable</option><option value={1.85}>Spacious</option></select></div>
        </div>
        <div className="setting-section"><div className="setting-label">Appearance <span>02</span></div>
          <div className="theme-options" role="group" aria-label="Color mode">{([{id:'light', name:'Light'}, {id:'dark', name:'Dark'}] as const).map(theme => <button key={theme.id} aria-pressed={settings.theme === theme.id} className={`theme-option ${settings.theme === theme.id ? 'selected' : ''}`} onClick={() => change('theme', theme.id)}><div className={`theme-sample ${theme.id}`}><span/><span/><span/>{settings.theme === theme.id && <Check size={13}/>}</div><span>{theme.name}</span></button>)}</div>
          <div className="setting-row"><label htmlFor="background">Background texture</label><select id="background" value={settings.background} onChange={event => change('background', event.target.value as Settings['background'])}><option value="blueprint">Blueprint</option><option value="contours">Contours</option><option value="clean">Clean</option></select></div>
          <div className="setting-row"><label htmlFor="background-motion">Animate background</label><input id="background-motion" className="toggle" type="checkbox" checked={settings.motion} onChange={event => change('motion', event.target.checked)}/></div>
          <div className="setting-row"><label htmlFor="cursor">Cursor style</label><select id="cursor" value={settings.cursor} onChange={event => change('cursor', event.target.value as Settings['cursor'])}><option value="block">▉ Block</option><option value="bar">│ Bar</option><option value="underline">_ Underline</option></select></div>
        </div>
        <div className="setting-section"><div className="setting-label">Behavior <span>03</span></div>
          <div className="setting-row"><label htmlFor="default-shell">Shell for new sessions</label><select id="default-shell" value={shell} onChange={event => onShell(event.target.value)}>{[...new Set([shell, ...(info?.shells || ['/bin/zsh','/bin/bash'])])].map(value => <option key={value} value={value}>{value.split('/').pop()}</option>)}</select></div>
          <div className="setting-row"><label htmlFor="scrollback">Scrollback lines</label><select id="scrollback" value={settings.scrollback} onChange={event => change('scrollback', Number(event.target.value))}><option value={1000}>1,000</option><option value={10000}>10,000</option><option value={50000}>50,000</option></select></div>
          <div className="setting-row"><label htmlFor="hidden-files">Show hidden files</label><input id="hidden-files" className="toggle" type="checkbox" checked={settings.showHidden} onChange={event => change('showHidden', event.target.checked)}/></div>
        </div>
      </div>
      <footer className="settings-footer"><button className="text-button" onClick={() => onChange(defaultSettings)}><RotateCcw size={13}/> Reset defaults</button><span>xTerm / v{info?.version || '0.4.0'} <ArrowDownLeft size={13}/></span></footer>
    </section>
  </div>;
}
