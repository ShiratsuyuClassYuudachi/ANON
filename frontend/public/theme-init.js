try {
  var mode = localStorage.getItem('anon-theme') === 'dark' ? 'dark' : 'light';
  var style = localStorage.getItem('anon-style') || 'minimal';
  var meta = {
    minimal: { light: '#f6f7f9', dark: '#111418' },
    playful: { light: '#faf7ff', dark: '#16121f' },
    'anon-tokyo': { light: '#fdfbfa', dark: '#141216' }
  };
  if (!meta[style]) style = 'minimal';
  var el = document.documentElement;
  if (mode === 'dark') el.classList.add('dark');
  el.dataset.style = style;
  var m = document.querySelector('meta[name=theme-color]');
  if (m) m.content = meta[style][mode];
} catch (e) {}
