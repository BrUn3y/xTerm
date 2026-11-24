export function createAppKeyHandler(terminal, copy, paste) {
  const reserved = new Set();
  return event => {
    const code = event.code || event.key;
    if (event.type === 'keyup') {
      if (reserved.delete(code)) return false;
      return true;
    }
    if (event.type !== 'keydown') return !reserved.has(code);
    const appModifier = event.metaKey || event.ctrlKey && event.shiftKey;
    const key = event.key.toLowerCase();
    if (key === 'v' && !event.altKey && (
      event.metaKey && !event.ctrlKey || event.ctrlKey && event.shiftKey && !event.metaKey
    )) {
      // Native paste must not also dispatch a Kitty key or a second DOM paste.
      event.preventDefault();
      event.stopPropagation();
      reserved.add(code);
      paste();
      return false;
    }
    if (!appModifier) return true;
    if (key === 'c') {
      if (terminal.hasSelection()) copy(terminal.getSelection());
    } else if (!['k','f','t','w','d',',','o','b','+','-','='].includes(key)) {
      return true;
    }
    // Pair reserved keydowns with their releases even if modifiers are released first.
    reserved.add(code);
    return false;
  };
}
