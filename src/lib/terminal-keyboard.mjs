export function createAppKeyHandler(terminal, copy) {
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
