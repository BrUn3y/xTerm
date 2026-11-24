import {useEffect, useState} from 'react';
import {Github} from 'lucide-react';
import type {GitHubRepository} from '../types';

interface Props { cwd: string; refreshKey: number; onError(message: string): void }

export default function GitHubLink({cwd, refreshKey, onError}: Props) {
  const [resolved, setResolved] = useState<{cwd: string; refreshKey: number; repository: GitHubRepository | null} | null>(null);
  useEffect(() => {
    let alive = true;
    setResolved(null);
    if (!window.desktop || !cwd) return;
    void window.desktop.gitInfo(cwd).then(result => {
      if (alive) setResolved({cwd, refreshKey, repository: result?.github || null});
    }).catch(() => { if (alive) setResolved(null); });
    return () => { alive = false; };
  }, [cwd, refreshKey]);
  const repository = resolved?.cwd === cwd && resolved.refreshKey === refreshKey ? resolved.repository : null;
  if (!repository) return null;
  const name = `${repository.owner}/${repository.repo}`;
  return <button type="button" className="github-link" title={name} aria-label={`Open ${name} on GitHub`}
    onClick={() => void window.desktop?.openExternal(repository.url).catch(() => onError(`Could not open ${name} in your browser.`))}>
    <Github size={18} aria-hidden="true"/>
    <span className="github-link-tooltip" aria-hidden="true">{name}</span>
  </button>;
}
