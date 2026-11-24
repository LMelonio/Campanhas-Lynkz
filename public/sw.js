// ============================================================
//  SERVICE WORKER — app instalável, abertura rápida e reserva offline.
//
//  v2.6: cada versão guarda TODOS os arquivos do app de uma vez (ARQUIVOS),
//  então o celular abre a partir do aparelho, sem esperar a rede para cada
//  um dos ~35 arquivos, e nunca mistura arquivos de duas versões.
//   - Página (navegação) e config.js: rede primeiro (pegam versão nova e
//     troca de banco na hora); sem rede, a cópia guardada.
//   - Demais arquivos do app: cópia guardada na hora e atualização em
//     segundo plano (se alguém esquecer de subir a VERSAO, a próxima
//     abertura já pega o arquivo novo).
//   - Fontes do Google: guardadas na primeira vez.
//   - Supabase e /api/: nunca passam pelo cache.
//  VERSAO tem de ser igual à do config.js e à VERSAO_APP do js/app.js. Módulo novo em public/js/?
//  Acrescente em ARQUIVOS (o teste de navegador confere).
// ============================================================
const VERSAO = '2.9.0';
const CACHE = 'campanhas-' + VERSAO;
const ARQUIVOS = [
  './', 'config.js', 'manifest.json',          // './' e não 'index.html': o Cloudflare redireciona /index.html → /
  'css/tokens.css', 'css/base.css', 'css/componentes.css', 'css/telas.css',
  'assets/logo.png', 'assets/logo-branca.png', 'assets/icon-192.png',
  'vendor/supabase-2.119.0.js',
  'js/app.js', 'js/acesso.js', 'js/exportar.js',
  'js/dados/cadastros.js', 'js/dados/campanhas.js', 'js/dados/erros.js', 'js/dados/qlik.js', 'js/dados/saude.js', 'js/dados/usuarios.js',
  'js/lib/dom.js', 'js/lib/regras.js', 'js/lib/supabase.js', 'js/lib/url-auth.js',
  'js/telas/campanhas.js', 'js/telas/detalhe.js', 'js/telas/gestao.js', 'js/telas/historico.js',
  'js/telas/inicio.js', 'js/telas/nova.js', 'js/telas/perfil.js', 'js/telas/usuarios.js',
  'js/ui/avisos.js', 'js/ui/cadastro-dialogos.js', 'js/ui/campos.js', 'js/ui/combo.js', 'js/ui/copiar.js',
  'js/ui/estado.js', 'js/ui/icones.js', 'js/ui/pecas.js', 'js/ui/senha.js',
];
const FONTES = ['fonts.googleapis.com', 'fonts.gstatic.com'];
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
  // Só resposta completa do próprio site (ou CORS das fontes): nada de redirect ou "opaque".
  if (resp && resp.ok && (resp.type === 'basic' || resp.type === 'cors')) {
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

  if (FONTES.includes(url.hostname)) {
    e.respondWith(caches.match(req).then(achou => achou || daRede(req)));
    return;
  }
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
