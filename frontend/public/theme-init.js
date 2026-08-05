try {
  var mode = localStorage.getItem('anon-theme') || 'light';
  var style = localStorage.getItem('anon-style') || 'minimal';
  var el = document.documentElement;
  if (mode === 'dark') el.classList.add('dark');
  el.dataset.style = style;
  var m = document.querySelector('meta[name=theme-color]');
  if (m) m.content = mode === 'dark' ? '#111418' : '#f6f7f9';
} catch (e) {}
