export const FILE_PATH_MIME = 'application/x-xterm-file-paths';
const absolute = value => typeof value === 'string' && /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(value) && !value.includes('\0');

export function pathsFromDropData(internal = '', uris = '') {
  if (internal) {
    try {
      const paths = JSON.parse(internal);
      if (Array.isArray(paths) && paths.every(absolute)) return paths.slice(0,100);
    } catch { /* Ignore data from unrelated drag sources. */ }
  }
  return uris.split(/\r?\n/).filter(line => line && !line.startsWith('#')).flatMap(line => {
    try {
      const url = new URL(line);
      if (url.protocol !== 'file:' || url.hostname && url.hostname !== 'localhost') return [];
      let path = decodeURIComponent(url.pathname);
      if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
      return absolute(path) ? [path] : [];
    } catch { return []; }
  }).slice(0,100);
}

export function quoteDroppedPaths(paths, shell = '/bin/zsh') {
  if (!paths.length || paths.length > 100 || !paths.every(absolute)) throw new Error('Only absolute file paths can be inserted.');
  const executable = shell.split(/[\\/]/).pop().toLowerCase();
  return paths.map(path => {
    if (/^(?:powershell|pwsh)(?:\.exe)?$/.test(executable)) {
      return '"' + path.replace(/`/g,'``').replace(/\$/g,'`$').replace(/"/g,'`"').replace(/\r/g,'`r').replace(/\n/g,'`n').replace(/\t/g,'`t') + '"';
    }
    if (/^cmd(?:\.exe)?$/.test(executable)) {
      if (/[\r\n"%!]/.test(path)) throw new Error('This path contains characters that cmd.exe cannot safely insert.');
      return '"' + path + '"';
    }
    if (/[\x01-\x1f\x7f]/.test(path)) {
      return "$'" + path.replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/[\x01-\x1f\x7f]/g,char=>'\\x'+char.charCodeAt(0).toString(16).padStart(2,'0')) + "'";
    }
    return "'" + path.replace(/'/g,"'\\''") + "'";
  }).join(' ') + ' ';
}
