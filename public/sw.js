// ============================================================
//  SERVICE WORKER — app instalável e reserva offline.
//  - Arquivos do app: rede primeiro (sempre a versão nova com internet;
//    cache só se a rede falhar).
//  - esm.sh, fontes do Google e SheetJS: cache primeiro (versões fixas).
//  - Supabase: nunca passa pelo cache.
//  Só guarda respostas OK. VERSAO tem de ser igual à do config.js.
// ============================================================
const VERSAO = '2.3.0';
const CACHE = 'campanhas-' + VERSAO;
const CASCA = [
  './', 'config.js', 'manifest.json',          // './' e não 'index.html': o Cloudflare redireciona /index.html → /
  'css/tokens.css', 'css/base.css', 'css/componentes.css', 'css/telas.css',
  'assets/logo.png', 'assets/icon-192.png',
];
const CACHE_PRIMEIRO = ['esm.sh', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.sheetjs.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CASCA)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(nomes => Promise.all(nomes.filter(n => n !== CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

function guardar(req, resp) {
  if (resp && resp.ok) {
    const copia = resp.clone();
    caches.open(CACHE).then(c => c.put(req, copia));
  }
  return resp;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (CACHE_PRIMEIRO.includes(url.hostname)) {
    e.respondWith(caches.match(req).then(achou => achou || fetch(req).then(r => guardar(req, r))));
    return;
  }
  if (url.origin !== location.origin) return;     // Supabase e o resto seguem direto

  e.respondWith(
    fetch(req).then(r => guardar(req, r))
      .catch(() => caches.match(req).then(achou => achou || (req.mode === 'navigate' ? caches.match('./') : undefined))),
  );
});
