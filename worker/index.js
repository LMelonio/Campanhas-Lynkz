// Worker do Cloudflare: /api/qlik/compras, /api/qlik/comissoes (só administrador) e /api/usuarios/convidar; o resto do site é estático.
// Segredos (wrangler secret put): QLIK_API_KEY, SUPABASE_SERVICE_ROLE_KEY. Demais variáveis em wrangler.jsonc.
import { abrirEngine, consultarCompras, consultarComissoes, consultarBaseComissoes, ErroQlik, CONFIG_PADRAO, codigoSeguro, padraoSeguro, serialQlik, MAX_PADROES, marcasSeguras } from './qlik-engine.js';

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
// Token JWT do cabeçalho Authorization, ou null se vier vazio ou fora do formato.
function tokenDoPedido(request) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  return token && token.length <= 4096 && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token) ? token : null;
}

async function usuarioAtivo(request, env) {
  const token = tokenDoPedido(request);
  if (!token) return null;
  const guardado = sessoes.get(token);
  if (guardado && guardado.ate > Date.now()) return guardado.perfil;
  const perfil = await perfilDoToken(token, env);
  const ativo = perfil?.ativo ? { id: perfil.id, papel: perfil.papel } : null;
  if (ativo) { if (sessoes.size > 2000) sessoes.clear(); sessoes.set(token, { perfil: ativo, ate: Date.now() + 60000 }); }
  return ativo;
}

// { id, ativo, papel } de quem mandou o token, conferido no próprio Supabase (com RLS), ou null.
async function perfilDoToken(token, env) {
  const cab = { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` };
  const u = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: cab });
  if (!u.ok) return null;
  const { id } = await u.json();
  const p = await fetch(`${env.SUPABASE_URL}/rest/v1/perfis?id=eq.${encodeURIComponent(id)}&select=ativo,papel`, { headers: cab });
  if (!p.ok) return null;
  const [perfil] = await p.json();
  return perfil ? { id, ...perfil } : null;
}

// ---------- convite de usuário ----------
// Só administrador ativo convida. O Supabase cria a conta e manda o e-mail; o perfil
// (criado pelo gatilho criar_perfil) recebe nome, papel e acesso pela definir_perfil,
// chamada com o token de quem convidou (a regra de administrador fica no banco).
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PAPEIS = ['aprovador', 'coordenador'];

export function validarConvite(corpo) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new ErroQlik('Pedido inválido.', { status: 400 });
  const email = String(corpo.email ?? '').trim().toLowerCase();
  const nome = String(corpo.nome ?? '').trim().replace(/\s+/g, ' ');
  const papel = String(corpo.papel ?? '');
  if (!EMAIL_RE.test(email) || email.length > 254) throw new ErroQlik('Informe um e-mail válido.', { status: 400 });
  if (nome.length < 2 || nome.length > 80) throw new ErroQlik('O nome precisa ter de 2 a 80 caracteres.', { status: 400 });
  if (!PAPEIS.includes(papel)) throw new ErroQlik('Perfil inválido.', { status: 400 });
  return { email, nome, papel };
}

export async function tratarConvite(request, env, origem) {
  const token = tokenDoPedido(request);
  if (!token) return json({ erro: 'Entre no app para convidar.' }, 401);
  const { email, nome, papel } = validarConvite(await lerCorpo(request));
  const perfil = await perfilDoToken(token, env);
  const admin = perfil?.ativo && perfil.papel === 'aprovador' ? perfil.id : null;
  if (!admin) return json({ erro: 'Só administradores convidam usuários.' }, 403);
  // Só depois de saber que é administrador: quem não é não descobre como o servidor está configurado.
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new ErroQlik('Convite indisponível: falta configurar a chave do Supabase no servidor.', { status: 503 });
  if (!(await dentroDoLimite(env, `convite:${admin}`))) return json({ erro: 'Muitos convites seguidos. Aguarde um minuto.' }, 429, { 'Retry-After': '60' });

  const servico = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
  const conv = await fetch(`${env.SUPABASE_URL}/auth/v1/invite?redirect_to=${encodeURIComponent(origem + '/')}`, {
    method: 'POST', headers: servico, body: JSON.stringify({ email, data: { nome } }),
  });
  if (!conv.ok) {
    const det = await conv.json().catch(() => ({}));
    const texto = `${det.error_code || ''} ${det.msg || det.message || ''}`;
    if (conv.status === 422 || /already|exists|registered/i.test(texto)) return json({ erro: 'Já existe uma conta com este e-mail.' }, 409);
    if (conv.status === 429 || /rate/i.test(texto)) return json({ erro: 'O Supabase limitou o envio de e-mails. Tente de novo mais tarde.' }, 429);
    console.error('Convite recusado pelo Supabase', conv.status, texto);
    return json({ erro: 'O Supabase não enviou o convite.' }, 502);
  }
  const { id } = await conv.json();
  const definido = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/definir_perfil`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_id: id, p_papel: papel, p_ativo: true, p_nome: nome }),
  });
  if (!definido.ok) {
    console.error('Convite enviado, mas o perfil não foi definido', definido.status, await definido.text().catch(() => ''));
    return json({ id, email, aviso: 'Convite enviado. Confira o perfil da pessoa na lista de usuários.' }, 201);
  }
  return json({ id, email }, 201);
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
  // Um laboratório (texto) ou vários; cada padrão passa por padraoSeguro.
  const fp = corpo.fornecedor_padrao;
  if (Array.isArray(fp) && (!fp.length || fp.length > MAX_PADROES)) throw new ErroQlik('Laboratório inválido.', { status: 400 });
  const padraoFornecedor = Array.isArray(fp) ? fp.map(p => padraoSeguro(p, 'Laboratório')) : padraoSeguro(fp, 'Laboratório');
  // Uma marca (texto) ou várias.
  const marca = corpo.marca ? marcasSeguras(corpo.marca) : null;
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

// ---------- comissões ----------
// Pedido: { apuracao_inicio, apuracao_fim, contrato_inicio, contrato_fim } ou { apuracao_inicio, apuracao_fim, base: true }.
// cod_farelo (versão antiga do app) é aceito e ignorado: a resposta vem por fornecedor (formato 2).
// O app calcula os períodos (26 a 25 e o mês anterior fechado); aqui só conferimos o formato.
const MAX_DIAS_COMISSAO = 62;
function periodoSeguro(inicio, fim, rotulo) {
  const dias = serialQlik(fim) - serialQlik(inicio);
  if (dias < 0) throw new ErroQlik(`${rotulo}: o fim está antes do início.`, { status: 400 });
  if (dias > MAX_DIAS_COMISSAO) throw new ErroQlik(`${rotulo}: período longo demais (máximo ${MAX_DIAS_COMISSAO} dias).`, { status: 400 });
  return { inicio, fim };
}

export async function tratarComissoes(request, env, { conectar = conectarQlik } = {}) {
  const corpo = await lerCorpo(request);
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return json({ erro: 'Pedido inválido.' }, 400);
  const apuracao = periodoSeguro(corpo.apuracao_inicio, corpo.apuracao_fim, 'Apuração');
  // { base: true }: só as vendas linha a linha do período, para a aba "Base Qlik" do Excel.
  if (corpo.base === true) {
    const ws = await conectar(env);
    const engine = abrirEngine(ws, { tempoMs: 60000 });
    try {
      const r = await consultarBaseComissoes(engine, { appId: env.QLIK_APP_ID, config: configDoEnv(env), apuracao });
      return json({ base: r, consultado_em: new Date().toISOString() });
    } finally {
      engine.fechar();
    }
  }
  const contrato = periodoSeguro(corpo.contrato_inicio, corpo.contrato_fim, 'Contrato de Resultado');
  const ws = await conectar(env);
  const engine = abrirEngine(ws, { tempoMs: 40000 });
  try {
    const r = await consultarComissoes(engine, { appId: env.QLIK_APP_ID, config: configDoEnv(env), apuracao, contrato });
    return json({ ...r, consultado_em: new Date().toISOString() });
  } finally {
    engine.fechar();
  }
}

// Rotas do Qlik. soAdmin: só administrador ativo (dados de remuneração).
const ROTAS_QLIK = {
  '/api/qlik/compras':   { tratar: tratarCompras },
  '/api/qlik/comissoes': { tratar: tratarComissoes, soAdmin: true },
};

export default {
  async fetch(request, env, _ctx, { conectar = conectarQlik, conferir = usuarioAtivo } = {}) {
    const url = new URL(request.url);
    const rota = ROTAS_QLIK[url.pathname];
    if (!rota && url.pathname !== '/api/usuarios/convidar') return json({ erro: 'Não encontrado.' }, 404);
    if (request.method !== 'POST') return json({ erro: 'Use POST.' }, 405, { Allow: 'POST' });
    // Só o próprio app chama a API (o navegador manda Origin em todo POST).
    const origem = request.headers.get('Origin');
    if (origem && origem !== url.origin) return json({ erro: 'Origem não permitida.' }, 403);
    if (url.pathname === '/api/usuarios/convidar') {
      try { return await tratarConvite(request, env, url.origin); }
      catch (e) {
        if (e instanceof ErroQlik) return json({ erro: e.message }, e.status);
        console.error('Falha no convite', e);
        return json({ erro: 'Não foi possível enviar o convite agora.' }, 502);
      }
    }
    try {
      // conferir devolve { id, papel } (ou só o id, em testes antigos).
      const u = await conferir(request, env);
      const id = typeof u === 'string' ? u : u?.id;
      if (!id) return json({ erro: 'Entre no app para consultar o Qlik.' }, 401);
      if (rota.soAdmin && u?.papel !== 'aprovador') return json({ erro: 'Só administradores consultam as comissões.' }, 403);
      if (!(await dentroDoLimite(env, id))) return json({ erro: 'Muitas consultas seguidas. Aguarde um minuto.' }, 429, { 'Retry-After': '60' });
      return await rota.tratar(request, env, { conectar });
    } catch (e) {
      if (e instanceof ErroQlik && !e.interno && e.status < 500) return json({ erro: e.message }, e.status);
      console.error('Falha na consulta ao Qlik', e);
      // Mensagens de configuração (campo inexistente etc.) ajudam quem mantém; o texto cru do Qlik não vai para a tela.
      const msg = e instanceof ErroQlik && !e.interno ? e.message : 'Não foi possível consultar o Qlik agora.';
      return json({ erro: msg }, e instanceof ErroQlik ? e.status : 502);
    }
  },
};
