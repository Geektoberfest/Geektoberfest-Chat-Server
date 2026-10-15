import './crazyUi.css';

// Playful extras: switchable accent themes, a confetti burst when someone posts a party emoji, and a
// tilt on the sidebar rooms. All motion is turned off when the user prefers reduced motion.
const THEME_KEY = 'gather-accent';
const THEMES = {
  forest: { name: 'Forest', green: '#356b52', soft: '#eaf1e9', glow: '#a4c2a8' },
  sunset: { name: 'Sunset', green: '#c2553a', soft: '#fbe9e1', glow: '#f0b59f' },
  ocean: { name: 'Ocean', green: '#1f6f8b', soft: '#e3f1f6', glow: '#9fd0e0' },
  grape: { name: 'Grape', green: '#6b3fa0', soft: '#efe7f7', glow: '#c6aee3' },
  candy: { name: 'Candy', green: '#d6336c', soft: '#fde8ef', glow: '#f7a8c2' },
};
const PARTY = /🎉|🥳|🎊|🎂/u;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function applyTheme(key) {
  const theme = THEMES[key] || THEMES.forest;
  const root = document.documentElement.style;
  root.setProperty('--green', theme.green);
  root.setProperty('--green-soft', theme.soft);
  root.setProperty('--green-glow', theme.glow);
  document.querySelectorAll('.accent-swatch').forEach((swatch) => {
    swatch.setAttribute('aria-pressed', String(swatch.dataset.theme === key));
  });
  localStorage.setItem(THEME_KEY, key);
}

function burst(near) {
  if (reduceMotion) return;
  const rect = near.getBoundingClientRect();
  const colors = Object.values(THEMES).flatMap((theme) => [theme.green, theme.glow]);
  for (let i = 0; i < 36; i += 1) {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    piece.style.left = `${rect.left + rect.width / 2}px`;
    piece.style.top = `${rect.top}px`;
    piece.style.background = colors[i % colors.length];
    piece.style.setProperty('--dx', `${(Math.random() - 0.5) * 320}px`);
    piece.style.setProperty('--dy', `${-120 - Math.random() * 220}px`);
    piece.style.setProperty('--spin', `${(Math.random() - 0.5) * 720}deg`);
    document.body.append(piece);
    piece.addEventListener('animationend', () => piece.remove());
  }
}

export default function initCrazyUi({ decorateMessage }) {
  // Accent picker in the sidebar.
  const rail = document.querySelector('.room-rail');
  const picker = document.createElement('div');
  picker.className = 'accent-picker';
  picker.setAttribute('role', 'group');
  picker.setAttribute('aria-label', 'Accent colour');
  Object.entries(THEMES).forEach(([key, theme]) => {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'accent-swatch';
    swatch.dataset.theme = key;
    swatch.title = theme.name;
    swatch.setAttribute('aria-label', `${theme.name} accent`);
    swatch.style.background = theme.green;
    swatch.addEventListener('click', () => applyTheme(key));
    picker.append(swatch);
  });
  rail.querySelector('.room-hint').after(picker);
  applyTheme(localStorage.getItem(THEME_KEY) || 'forest');

  // Confetti for party emoji, shown once per message as it is drawn.
  decorateMessage((row, message) => {
    if (message.deleted || !PARTY.test(message.text || '')) return;
    if (row.dataset.partied === 'true') return;
    row.dataset.partied = 'true';
    burst(row.querySelector('.message-bubble'));
  });

}
