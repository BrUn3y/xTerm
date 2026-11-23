function rgb(value) {
  const hex = /^#([\da-f]{6})$/i.exec(value);
  if (hex) return [0, 2, 4].map(offset => parseInt(hex[1].slice(offset, offset + 2), 16));
  const css = /^rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/i.exec(value);
  return css ? css.slice(1, 4).map(Number) : null;
}
function luminance(color) {
  const [r,g,b] = color.map(value => {const s = value / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;});
  return .2126 * r + .7152 * g + .0722 * b;
}
function contrast(first, second) {
  const a = luminance(first), b = luminance(second);
  return (Math.max(a,b) + .05) / (Math.min(a,b) + .05);
}
const hex = color => '#' + color.map(value => Math.round(value).toString(16).padStart(2, '0')).join('');

// Adapt only neutral dark UI panels, preserving semantic colored backgrounds.
export function lightPanelColors(background, foreground, surface = '#e9eddf', ink = '#353c32') {
  const bg = rgb(background), fg = rgb(foreground), target = rgb(surface), text = rgb(ink);
  if (!bg || !fg || !target || !text || luminance(bg) > .18 || Math.max(...bg) - Math.min(...bg) > 32) return null;
  let adjusted = fg;
  if (contrast(fg, target) < 4.5) {
    if (Math.max(...fg) - Math.min(...fg) <= 32) adjusted = text;
    else {
      for (let mix = .05; mix <= 1.001; mix += .05) {
        adjusted = fg.map((value,index) => value * (1-mix) + text[index] * mix);
        if (contrast(adjusted, target) >= 4.5) break;
      }
    }
  }
  return {background: surface, foreground: hex(adjusted)};
}

export function ansiColor(index, palette, background, foreground) {
  if (index === 257) return background;
  if (index < 16) return palette[index] || foreground;
  if (index < 232) {
    const value = index - 16, levels = [0,95,135,175,215,255];
    return hex([levels[Math.floor(value / 36)], levels[Math.floor(value / 6) % 6], levels[value % 6]]);
  }
  if (index < 256) return hex([8,8,8].map(value => value + (index - 232) * 10));
  return foreground;
}
