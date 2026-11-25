// Aplica o tema salvo antes da primeira pintura (script clássico no <head>; a CSP não permite script inline).
(() => {
  let escolha = 'auto';
  try { escolha = JSON.parse(localStorage.getItem('lynkz_tema')) || 'auto'; } catch { /* sem armazenamento */ }
  const escuro = matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.tema = ['claro', 'escuro', 'daltonico'].includes(escolha) ? escolha : escuro ? 'escuro' : 'claro';
})();
