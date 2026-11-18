// ============================================================
//  Servidor local de desenvolvimento (sem dependências).
//
//    node dev/servidor.mjs              → app com o Supabase SIMULADO
//    node dev/servidor.mjs --real       → app com o Supabase de verdade (config.js)
//    PORTA=9000 node dev/servidor.mjs
//
//  Abra http://localhost:8000/?papel=aprovador  (ou ?papel=coordenador).
//  No modo simulado, js/lib/supabase.js é trocado por dev/supabase-simulado.js
//  só na resposta do servidor — nenhum arquivo do app é alterado.
// ============================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJETO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAIZ = path.join(PROJETO, 'public');
const SIMULADO = path.join(PROJETO, 'dev/supabase-simulado.js');
const REAL = process.argv.includes('--real');
const PORTA = +process.env.PORTA || 8000;
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

http.createServer((rq, rs) => {
  let p = decodeURIComponent(new URL(rq.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = !REAL && p === '/js/lib/supabase.js' ? SIMULADO : path.join(RAIZ, p);
  if (!(f.startsWith(RAIZ + path.sep) || f === SIMULADO) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    rs.writeHead(404, { 'Content-Type': 'text/plain' }); rs.end('404'); return;
  }
  rs.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(rs);
}).listen(PORTA, () => console.log(`App em http://localhost:${PORTA}/?papel=aprovador  (${REAL ? 'Supabase REAL' : 'Supabase simulado'})`));
