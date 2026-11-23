// ============================================================
//  QLIK CLOUD — leitura do cadastro de clientes pela Engine API.
//
//  lerClientesQlik(op)          → linhas brutas [{campo: texto, _medida: número}]
//  converterClientesQlik(linhas, campos) → [{codigo, nome, fantasia, documento, cidade, uf, vendedor}]
//
//  A Engine API fala JSON-RPC por WebSocket. A chave de API vai no
//  cabeçalho Authorization (por isso usamos o pacote "ws": o WebSocket
//  nativo do Node não aceita cabeçalho). Montamos um hipercubo com uma
//  dimensão por campo e lemos em páginas de até 10.000 células.
// ============================================================
import WebSocket from 'ws';

// Campos do .env → nome do campo no app do Qlik. Os padrões são os da
// base de vendas usada no Painel Vendedor.
export const CAMPOS_PADRAO = {
  codigo:    'Cód. Cliente',
  nome:      'Razão Social Cliente',
  fantasia:  'Nome Cliente',
  documento: 'CPF CNPJ Cliente',
  cidade:    'Município Cliente',
  uf:        'UF Cliente',
  vendedor:  'Vendedor B2B',
};

export function camposDoEnv(env) {
  const c = {};
  for (const [k, padrao] of Object.entries(CAMPOS_PADRAO)) {
    const v = env['QLIK_CAMPO_' + k.toUpperCase()];
    c[k] = (v ?? padrao).trim();
  }
  return c;
}

const vazio = t => t == null || t === '' || t === '-';

export async function lerClientesQlik({ tenant, apiKey, appId, campos, medida = 'Count(1)', aoProgresso = () => {} }) {
  const usados = Object.entries(campos).filter(([, f]) => f);
  // "terrazoo.us.qlikcloud.com" → wss://…  (ws:// só nos testes, com o Qlik simulado)
  const base = /^wss?:\/\//.test(tenant) ? tenant : 'wss://' + tenant.replace(/^https?:\/\//, '');
  const url = `${base.replace(/\/+$/, '')}/app/${encodeURIComponent(appId)}`;
  const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  const pendentes = new Map();
  let seq = 0;

  const aberto = new Promise((ok, falha) => {
    ws.once('open', ok);
    ws.once('error', e => falha(new Error(`Não conectou no Qlik (${tenant}): ${e.message}. Confira QLIK_TENANT e QLIK_API_KEY.`)));
    ws.once('unexpected-response', (_req, res) => falha(new Error(`Qlik recusou a conexão (HTTP ${res.statusCode}). ${res.statusCode === 401 ? 'A QLIK_API_KEY está errada ou expirou.' : ''}`)));
  });
  ws.on('message', dados => {
    const m = JSON.parse(dados);
    const p = m.id != null && pendentes.get(m.id);
    if (!p) return;              // avisos do Qlik sem id (OnConnected etc.)
    pendentes.delete(m.id);
    if (m.error) p.falha(new Error(`Qlik: ${m.error.message}${m.error.parameter ? ' (' + m.error.parameter + ')' : ''}`));
    else p.ok(m.result);
  });
  const chamar = (handle, method, params) => new Promise((ok, falha) => {
    const id = ++seq;
    pendentes.set(id, { ok, falha });
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, handle, method, params }));
  });

  try {
    await aberto;
    const doc = await chamar(-1, 'OpenDoc', { qDocName: appId });
    const hDoc = doc.qReturn.qHandle;
    const obj = await chamar(hDoc, 'CreateSessionObject', { qProp: {
      qInfo: { qType: 'lynkz-campanhas-clientes' },
      qHyperCubeDef: {
        qDimensions: usados.map(([k, f], i) => ({ qDef: { qFieldDefs: [f] }, qNullSuppression: i === 0 || k === 'codigo' })),
        qMeasures: [{ qDef: { qDef: medida } }],
        qSuppressZero: false, qSuppressMissing: true, qInitialDataFetch: [],
      },
    } });
    const hObj = obj.qReturn.qHandle;
    const { qLayout } = await chamar(hObj, 'GetLayout', {});
    const cubo = qLayout.qHyperCube;
    cubo.qDimensionInfo.forEach((d, i) => {
      if (d.qError) throw new Error(`O campo "${usados[i][1]}" não existe no app do Qlik. Ajuste QLIK_CAMPO_${usados[i][0].toUpperCase()} no .env.`);
    });
    if (cubo.qMeasureInfo[0]?.qError) throw new Error(`A medida "${medida}" deu erro no Qlik. Ajuste QLIK_MEDIDA no .env.`);

    const total = cubo.qSize.qcy;
    const largura = usados.length + 1;
    const altura = Math.max(1, Math.floor(10000 / largura));
    const linhas = [];
    for (let topo = 0; topo < total; topo += altura) {
      const [pagina] = await chamar(hObj, 'GetHyperCubeData', {
        qPath: '/qHyperCubeDef',
        qPages: [{ qTop: topo, qLeft: 0, qWidth: largura, qHeight: Math.min(altura, total - topo) }],
      }).then(r => r.qDataPages);
      for (const celulas of pagina.qMatrix) {
        const l = {};
        usados.forEach(([k], i) => { l[k] = vazio(celulas[i].qText) ? '' : celulas[i].qText; });
        l._medida = Number.isFinite(celulas[largura - 1].qNum) ? celulas[largura - 1].qNum : 0;
        linhas.push(l);
      }
      aoProgresso(Math.min(topo + altura, total), total);
    }
    return linhas;
  } finally {
    ws.close();
  }
}

// Um cliente pode aparecer em mais de uma linha (ex.: dois vendedores ou
// duas cidades ao longo do tempo). Fica a combinação com a maior medida;
// campo vazio é completado por outra linha do mesmo cliente.
export function converterClientesQlik(linhas) {
  const porCodigo = new Map();
  for (const l of linhas) {
    const codigo = String(l.codigo ?? '').trim();
    if (!codigo) continue;
    const lista = porCodigo.get(codigo) || [];
    lista.push(l);
    porCodigo.set(codigo, lista);
  }
  const limpa = v => String(v ?? '').replace(/\s+/g, ' ').trim();
  const clientes = [];
  for (const [codigo, lista] of porCodigo) {
    lista.sort((a, b) => (b._medida || 0) - (a._medida || 0));
    const pega = k => limpa(lista.find(l => limpa(l[k]))?.[k] ?? '');
    clientes.push({
      codigo,
      nome: pega('nome') || pega('fantasia'),
      fantasia: pega('fantasia'),
      documento: pega('documento').replace(/\D/g, ''),
      cidade: pega('cidade'),
      uf: pega('uf').toUpperCase().slice(0, 2),
      vendedor: pega('vendedor'),
    });
  }
  return clientes.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}
