// ============================================================
//  WORKER DO CLOUDFLARE — só a rota /api/qlik/compras.
//  O resto do site é servido como arquivo estático (wrangler.jsonc).
//
//  A chave do Qlik fica aqui (segredo do Worker), nunca no navegador.
//  Quem chama precisa estar logado no app: o Worker confere o token do
//  Supabase e se o perfil está ativo antes de falar com o Qlik.
//
//  Variáveis (wrangler.jsonc → vars) e segredos (wrangler secret put):
//    QLIK_API_KEY (segredo) · QLIK_TENANT · QLIK_APP_ID
//    SUPABASE_URL · SUPABASE_ANON_KEY
//    QLIK_CAMPOS · QLIK_FILTROS · QLIK_EXPRESSAO_VALOR   (opcionais, JSON/texto)
// ============================================================
import { abrirEngine, consultarCompras, ErroQlik, CONFIG_PADRAO, codigoSeguro, padraoSeguro, serialQlik } from './qlik-engine.js';

// Cabeçalhos de segurança também nas respostas da API (o _headers só vale para arquivos estáticos).
const CABECALHOS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
const json = (corpo, status = 200, extra = {}) => new Response(JSON.stringify(corpo), { status, headers: { ...CABECALHOS, ...extra } });

const MAX_CORPO = 2048;          // bytes: o pedido real tem ~150
const LIMITE_POR_MINUTO = 20;    // consultas por usuário (cada uma leva ~3 s no Qlik)

// Limite por usuário. Com o binding LIMITE_QLIK (Rate Limiting do Cloudflare, ver
// wrangler.jsonc) vale para todos os servidores; sem ele, vale por instância do Worker.
const usoLocal = new Map();
export async function dentroDoLimite(env, chave, agora = Date.now()) {
  if (env.LIMITE_QLIK?.limit) return (await env.LIMITE_QLIK.limit({ key: chave })).success;
  const janela = (usoLocal.get(chave) || []).filter(t => agora - t < 60000);
  if (janela.length >= LIMITE_POR_MINUTO) { usoLocal.set(chave, janela); return false; }
  janela.push(agora);
  usoLocal.set(chave, janela);
  if (usoLocal.size > 5000) usoLocal.clear();
  return true;
}

// Lê o corpo com limite de tamanho (não confia no Content-Length).
async function lerCorpo(request) {
  if (!/^application\/json\b/i.test(request.headers.get('Content-Type') || '')) throw new ErroQlik('Envie JSON.', { status: 415 });
  const declarado = Number(request.headers.get('Content-Length') || 0);
  if (declarado > MAX_CORPO) throw new ErroQlik('Pedido grande demais.', { status: 413 });
  const texto = await request.text();
  if (texto.length > MAX_CORPO) throw new ErroQlik('Pedido grande demais.', { status: 413 });
  try { return JSON.parse(texto); } catch { return null; }
}

export function configDoEnv(env) {
  const lerJson = (v, padrao) => {
    if (!v) return padrao;
    try { return JSON.parse(v); } catch { throw new ErroQlik('Variável de configuração do Qlik com JSON inválido.', { status: 500 }); }
  };
  return {
    campos: { ...CONFIG_PADRAO.campos, ...lerJson(env.QLIK_CAMPOS, {}) },
    filtros: lerJson(env.QLIK_FILTROS, CONFIG_PADRAO.filtros),
    expressaoValor: env.QLIK_EXPRESSAO_VALOR || CONFIG_PADRAO.expressaoValor,
  };
}

// Confere o login pelo próprio Supabase: token válido E perfil ativo.
// O resultado fica 60 s em memória (evita 2 idas ao Supabase a cada consulta).
const sessoes = new Map();
async function usuarioAtivo(request, env) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token || token.length > 4096 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) return null;
  const guardado = sessoes.get(token);
  if (guardado && guardado.ate > Date.now()) return guardado.id;
  const id = await conferirNoSupabase(token, env);
  if (id) { if (sessoes.size > 2000) sessoes.clear(); sessoes.set(token, { id, ate: Date.now() + 60000 }); }
  return id;
}
async function conferirNoSupabase(token, env) {
  const cab = { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` };
  const u = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: cab });
  if (!u.ok) return null;
  const { id } = await u.json();
  const p = await fetch(`${env.SUPABASE_URL}/rest/v1/perfis?id=eq.${encodeURIComponent(id)}&select=ativo`, { headers: cab });
  if (!p.ok) return null;
  const [perfil] = await p.json();
  return perfil?.ativo ? id : null;
}

async function conectarQlik(env) {
  const r = await fetch(`https://${env.QLIK_TENANT}/app/${encodeURIComponent(env.QLIK_APP_ID)}`, {
    headers: { Upgrade: 'websocket', Authorization: `Bearer ${env.QLIK_API_KEY}` },
  });
  const ws = r.webSocket;
  if (!ws) throw new ErroQlik(r.status === 401 || r.status === 403 ? 'O Qlik recusou a chave de API.' : `Não conectou no Qlik (HTTP ${r.status}).`);
  ws.accept();
  return ws;
}

export async function tratarCompras(request, env, { conectar = conectarQlik } = {}) {
  const corpo = await lerCorpo(request);
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return json({ erro: 'Pedido inválido.' }, 400);
  const codigoCliente = codigoSeguro(corpo.codigo_cliente);
  const padraoFornecedor = padraoSeguro(corpo.fornecedor_padrao, 'Laboratório');
  const marca = corpo.marca ? padraoSeguro(corpo.marca, 'Marca') : null;
  const { inicio, fim } = corpo;
  const dias = serialQlik(fim) - serialQlik(inicio);
  if (dias < 0) throw new ErroQlik('O fim está antes do início.', { status: 400 });
  if (dias > 400) throw new ErroQlik('Período longo demais (máximo 400 dias).', { status: 400 });

  const ws = await conectar(env);
  const engine = abrirEngine(ws);
  try {
    const r = await consultarCompras(engine, { appId: env.QLIK_APP_ID, config: configDoEnv(env), codigoCliente, padraoFornecedor, marca, inicio, fim });
    return json({ ...r, consultado_em: new Date().toISOString() });
  } finally {
    engine.fechar();
  }
}

export default {
  async fetch(request, env, _ctx, { conectar = conectarQlik, conferir = usuarioAtivo } = {}) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/qlik/compras') return json({ erro: 'Não encontrado.' }, 404);
    if (request.method !== 'POST') return json({ erro: 'Use POST.' }, 405, { Allow: 'POST' });
    // Só o próprio app chama a API (o navegador manda Origin em todo POST).
    const origem = request.headers.get('Origin');
    if (origem && origem !== url.origin) return json({ erro: 'Origem não permitida.' }, 403);
    try {
      const id = await conferir(request, env);
      if (!id) return json({ erro: 'Entre no app para consultar o Qlik.' }, 401);
      if (!(await dentroDoLimite(env, id))) return json({ erro: 'Muitas consultas seguidas. Aguarde um minuto.' }, 429, { 'Retry-After': '60' });
      return await tratarCompras(request, env, { conectar });
    } catch (e) {
      if (e instanceof ErroQlik && !e.interno && e.status < 500) return json({ erro: e.message }, e.status);
      console.error('Falha na consulta ao Qlik', e);
      // Mensagens de configuração (campo inexistente etc.) ajudam quem mantém; o texto cru do Qlik não vai para a tela.
      const msg = e instanceof ErroQlik && !e.interno ? e.message : 'Não foi possível consultar o Qlik agora.';
      return json({ erro: msg }, e instanceof ErroQlik ? e.status : 502);
    }
  },
};
