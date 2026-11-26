// Service worker: guarda todos os arquivos da versão (ARQUIVOS) para abrir rápido e sem rede.
// Página e config.js: rede primeiro. Demais: cópia guardada e atualização em segundo plano. Supabase e /api/ não passam pelo cache.
// VERSAO igual à de config.js e app.js; módulo novo entra em ARQUIVOS (o teste confere).
const VERSAO = '3.3.0';
const CACHE = 'campanhas-' + VERSAO;
const ARQUIVOS = [
  './', 'config.js', 'tema-inicial.js', 'manifest.json',          // './' e não 'index.html': o Cloudflare redireciona /index.html → /
  'css/tokens.css', 'css/base.css', 'css/componentes.css', 'css/telas.css',
  'assets/logo.png', 'assets/logo-branca.png', 'assets/icon-192.png',
  'vendor/supabase-2.119.0.js', 'vendor/instrument-sans-5.3.0-latin.woff2',
  'js/app.js', 'js/acesso.js', 'js/exportar.js', 'js/adp.js', 'js/comissoes-excel.js', 'js/comissoes-pdf.js',
  'js/dados/cadastros.js', 'js/dados/campanhas.js', 'js/dados/comissoes.js', 'js/dados/erros.js', 'js/dados/qlik.js', 'js/dados/saude.js', 'js/dados/usuarios.js',
  'js/pdf/motor.js',
  'js/lib/comissoes.js', 'js/lib/comissoes-documentos.js', 'js/lib/dom.js', 'js/lib/regras.js', 'js/lib/supabase.js', 'js/lib/url-auth.js',
  'js/telas/campanhas.js', 'js/telas/detalhe.js', 'js/telas/gestao.js', 'js/telas/historico.js',
  'js/telas/inicio.js', 'js/telas/nova.js', 'js/telas/perfil.js', 'js/telas/usuarios.js',
  'js/telas/comissoes/index.js', 'js/telas/comissoes/comum.js', 'js/telas/comissoes/apuracao.js', 'js/telas/comissoes/documentos.js',
  'js/telas/comissoes/lancamentos.js', 'js/telas/comissoes/contrato.js', 'js/telas/comissoes/cadastro.js', 'js/telas/comissoes/parametros.js',
  'js/telas/comissoes/historico.js',
  'js/ui/adp-dialogo.js', 'js/ui/avisos.js', 'js/ui/cadastro-dialogos.js', 'js/ui/campos.js', 'js/ui/combo.js', 'js/ui/copiar.js', 'js/ui/decisao.js',
  'js/ui/estado.js', 'js/ui/icones.js', 'js/ui/tema.js', 'js/ui/pecas.js', 'js/ui/senha.js',
];
const REDE_PRIMEIRO = new Set(['/config.js']);

self.addEventListener('install', e => {
  // Um arquivo que falhar não impede a instalação: ele entra no cache no primeiro uso.
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.allSettled(ARQUIVOS.map(a => c.add(new Request(a, { cache: 'reload' })))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(nomes => Promise.all(nomes.filter(n => n !== CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

function guardar(req, resp) {
  // Só resposta completa do próprio site: nada de redirect, "opaque" ou CORS de terceiros.
  if (resp && resp.ok && resp.type === 'basic') {
    const copia = resp.clone();
    caches.open(CACHE).then(c => c.put(req, copia));
  }
  return resp;
}

const daRede = req => fetch(req).then(r => guardar(req, r));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate' || REDE_PRIMEIRO.has(url.pathname)) {
    e.respondWith(daRede(req).catch(() =>
      caches.match(req).then(achou => achou || (req.mode === 'navigate' ? caches.match('./') : undefined))));
    return;
  }
  // Cópia guardada na hora; a rede atualiza em segundo plano.
  e.respondWith(caches.match(req).then(achou => {
    const rede = daRede(req).catch(() => achou);
    if (achou) { e.waitUntil(rede.then(() => {}, () => {})); return achou; }
    return rede;
  }));
});
