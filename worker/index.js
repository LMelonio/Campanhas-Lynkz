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
import { abrirEngine, consultarCompras, ErroQlik, CONFIG_PADRAO, valorSeguro, serialQlik } from './qlik-engine.js';

const json = (corpo, status = 200) => new Response(JSON.stringify(corpo), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

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
async function usuarioAtivo(request, env) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
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
  const corpo = await request.json().catch(() => null);
  if (!corpo) return json({ erro: 'Pedido inválido.' }, 400);
  const codigoCliente = valorSeguro(corpo.codigo_cliente, 'Código do cliente');
  const padraoFornecedor = valorSeguro(corpo.fornecedor_padrao, 'Laboratório');
  const marca = corpo.marca ? valorSeguro(corpo.marca, 'Marca') : null;
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
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/qlik/compras') return json({ erro: 'Não encontrado.' }, 404);
    if (request.method !== 'POST') return json({ erro: 'Use POST.' }, 405);
    try {
      if (!(await usuarioAtivo(request, env))) return json({ erro: 'Entre no app para consultar o Qlik.' }, 401);
      return await tratarCompras(request, env);
    } catch (e) {
      if (e instanceof ErroQlik) return json({ erro: e.message }, e.status);
      console.error('Falha na consulta ao Qlik', e);
      return json({ erro: 'Não foi possível consultar o Qlik agora.' }, 502);
    }
  },
};
