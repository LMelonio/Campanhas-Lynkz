// ============================================================
//  QLIK — compras de um cliente num laboratório (fornecedor) e período.
//  Usado pelo Worker do Cloudflare (worker/index.js) e testado no Node.
//
//  Não conhece WebSocket de nenhuma plataforma: recebe um objeto "soquete"
//  com send(texto), addEventListener('message'|'close'|'error', fn) e close().
//
//  Tudo que depende do app do Qlik (nomes de campos, filtros fixos e a
//  expressão do valor) vem de "config" e pode ser trocado por variável do
//  Worker, sem mexer no código. Para descobrir os nomes certos:
//  node scripts/descobrir-campos-qlik.mjs
// ============================================================

export const CONFIG_PADRAO = {
  campos: {
    cliente:    'Cód. Cliente',
    fornecedor: 'Nome Fantasia Fornecedor',
    marca:      'Marca do Produto',   // laboratórios que no Qlik são marca, não fornecedor ("marca:CATLIFE")
    data:       'Data Venda',         // conferido no app: tem vendas até o dia; 'Data Emissão' não serve
    nota:       'Núm. Nota Fiscal Vendas',
    serie:      'Série Nota Fiscal Vendas',
  },
  // Filtros fixos das vendas da LYNKZ (os mesmos do Painel Vendedor).
  filtros: [
    { campo: 'Unidade de Negócio', valor: 'ATACADO' },
    { campo: 'Intercompany Geral', valor: 'REGULAR' },
  ],
  // {SET} vira o filtro (cliente, laboratório, período e filtros fixos). É o mesmo campo da medida
  // v_receita_sem_devolucao do app (a medida em si não aceita filtro extra).
  expressaoValor: 'Sum({SET} [Valor Faturamento Bruto s/ Devolução Vendas])',
};

export class ErroQlik extends Error {
  constructor(msg, { status = 502 } = {}) { super(msg); this.status = status; }
}

// ---------- valores seguros para dentro de uma expressão do Qlik ----------
// Nada de aspas, chaves, <, >, $ ou ; vindo do usuário: vira expressão solta.
const PERIGOSO = /["'`{}<>$;\\\n\r]/;
export function valorSeguro(v, rotulo) {
  const s = String(v ?? '').trim();
  if (!s || s.length > 80 || PERIGOSO.test(s)) throw new ErroQlik(`${rotulo} inválido.`, { status: 400 });
  return s;
}
const nomeCampo = n => `[${String(n).replace(/\]/g, '')}]`;

// Data civil "AAAA-MM-DD" → número de série do Qlik (dias desde 30/12/1899).
export function serialQlik(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) throw new ErroQlik('Data inválida.', { status: 400 });
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if (new Date(t).toISOString().slice(0, 10) !== iso) throw new ErroQlik('Data inválida.', { status: 400 });
  return Math.round(t / 86400000) + 25569;
}
export const dataDoSerial = n => new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);

// O laboratório do app pode ser fornecedor (padrão) ou marca do produto ("marca:CATLIFE").
export function alvoLaboratorio(config, padrao) {
  const seguro = valorSeguro(padrao, 'Laboratório');
  const m = /^marca:\s*(.+)$/i.exec(seguro);
  return m ? { campo: config.campos.marca, padrao: m[1].trim() } : { campo: config.campos.fornecedor, padrao: seguro };
}

// Modificador de conjunto: <[Cód. Cliente]={'123'}, [Fornecedor]={"OURO*"}, [Data Venda]={"=Num(..)>=A and Num(..)<=B"}, …>
// A data usa expressão: a busca numérica (">=46000<=46030") não casa neste app do Qlik.
export function montarConjunto({ config = CONFIG_PADRAO, codigoCliente, padraoFornecedor, inicio, fim }) {
  const c = config.campos;
  const alvo = alvoLaboratorio(config, padraoFornecedor);
  const dt = `Num(${nomeCampo(c.data)})`;
  const partes = [
    `${nomeCampo(c.cliente)}={'${valorSeguro(codigoCliente, 'Código do cliente')}'}`,
    `${nomeCampo(alvo.campo)}={"${alvo.padrao}"}`,
    `${nomeCampo(c.data)}={"=${dt}>=${serialQlik(inicio)} and ${dt}<=${serialQlik(fim)}"}`,
    ...(config.filtros || []).map(f => `${nomeCampo(f.campo)}={'${valorSeguro(f.valor, 'Filtro')}'}`),
  ];
  return `<${partes.join(', ')}>`;
}
export const expressao = (config, conjunto) => config.expressaoValor.replaceAll('{SET}', `{${conjunto}}`);

// ---------- Engine API (JSON-RPC) ----------
export function abrirEngine(soquete, { tempoMs = 25000 } = {}) {
  const pendentes = new Map();
  let seq = 0, fechado = false;
  const falharTodos = e => { fechado = true; for (const p of pendentes.values()) p.falha(e); pendentes.clear(); };
  soquete.addEventListener('message', ev => {
    let m; try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { return; }
    const p = m.id != null && pendentes.get(m.id);
    if (!p) return;   // avisos do Qlik sem id (OnConnected etc.)
    pendentes.delete(m.id);
    if (m.error) p.falha(new ErroQlik(`Qlik: ${m.error.message}${m.error.parameter ? ` (${m.error.parameter})` : ''}`));
    else p.ok(m.result);
  });
  soquete.addEventListener('close', () => falharTodos(new ErroQlik('O Qlik fechou a conexão.')));
  soquete.addEventListener('error', () => falharTodos(new ErroQlik('Falha na conexão com o Qlik.')));
  return {
    rpc(handle, method, params = {}) {
      if (fechado) return Promise.reject(new ErroQlik('A conexão com o Qlik já estava fechada.'));
      return new Promise((ok, falha) => {
        const id = ++seq;
        const t = setTimeout(() => { pendentes.delete(id); falha(new ErroQlik('O Qlik demorou demais para responder.', { status: 504 })); }, tempoMs);
        pendentes.set(id, { ok: v => { clearTimeout(t); ok(v); }, falha: e => { clearTimeout(t); falha(e); } });
        soquete.send(JSON.stringify({ jsonrpc: '2.0', id, handle, method, params }));
      });
    },
    fechar() { fechado = true; try { soquete.close(); } catch { /* já fechado */ } },
  };
}

async function criarCubo(engine, hDoc, def, rotulo) {
  const obj = await engine.rpc(hDoc, 'CreateSessionObject', { qProp: { qInfo: { qType: 'lynkz-compras' }, qHyperCubeDef: def } });
  const h = obj.qReturn.qHandle;
  const { qLayout } = await engine.rpc(h, 'GetLayout');
  const cubo = qLayout.qHyperCube;
  (cubo.qDimensionInfo || []).forEach(d => {
    if (d.qError) throw new ErroQlik(`O campo de ${rotulo} não existe no app do Qlik. Rode scripts/descobrir-campos-qlik.mjs e ajuste QLIK_CAMPOS.`);
  });
  (cubo.qMeasureInfo || []).forEach(m => {
    if (m.qError) throw new ErroQlik('A expressão do valor deu erro no Qlik. Ajuste QLIK_EXPRESSAO_VALOR (veja scripts/descobrir-campos-qlik.mjs).');
  });
  return { h, cubo };
}

async function lerLinhas(engine, h, total, largura) {
  const altura = Math.max(1, Math.floor(10000 / largura));
  const linhas = [];
  for (let topo = 0; topo < total; topo += altura) {
    const r = await engine.rpc(h, 'GetHyperCubeData', {
      qPath: '/qHyperCubeDef',
      qPages: [{ qTop: topo, qLeft: 0, qWidth: largura, qHeight: Math.min(altura, total - topo) }],
    });
    for (const l of r.qDataPages[0].qMatrix) linhas.push(l);
  }
  return linhas;
}

const arredonda = n => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
const limpa = t => (t == null || t === '-' ? '' : String(t).trim());

/**
 * Quanto o cliente comprou do fornecedor no período e quais notas compõem isso.
 * @returns {{ total:number, notas:{numero,serie,data,valor}[], fornecedores:string[] }}
 */
export async function consultarCompras(engine, { appId, config = CONFIG_PADRAO, codigoCliente, padraoFornecedor, inicio, fim }) {
  const conjunto = montarConjunto({ config, codigoCliente, padraoFornecedor, inicio, fim });
  const expr = expressao(config, conjunto);
  const c = config.campos;
  const medida = { qDef: { qDef: expr } };

  const doc = await engine.rpc(-1, 'OpenDoc', { qDocName: appId });
  const hDoc = doc.qReturn.qHandle;

  // 1) total (inclui devoluções, que não têm número de nota)
  const t = await criarCubo(engine, hDoc, { qDimensions: [], qMeasures: [medida], qInitialDataFetch: [] }, 'valor');
  const total = arredonda(t.cubo.qGrandTotalRow?.[0]?.qNum);

  // 2) notas. A data NÃO pode ser dimensão: o filtro de data do conjunto faz a medida ignorar a data
  // da linha, e a mesma nota apareceria em vários dias com o valor cheio (erro visto no Qlik real).
  // Por isso a data vem como medida: a menor data da nota dentro do período.
  const medidaData = { qDef: { qDef: `Min({${conjunto}} ${nomeCampo(c.data)})` } };
  const n = await criarCubo(engine, hDoc, {
    qDimensions: [
      { qDef: { qFieldDefs: [c.nota] }, qNullSuppression: true },
      { qDef: { qFieldDefs: [c.serie] }, qNullSuppression: false },
    ],
    qMeasures: [medida, medidaData], qSuppressZero: true, qInitialDataFetch: [],
  }, 'nota fiscal');
  const linhas = await lerLinhas(engine, n.h, n.cubo.qSize.qcy, 4);
  const notas = linhas.map(l => ({
    numero: limpa(l[0].qText), serie: limpa(l[1].qText),
    valor: arredonda(l[2].qNum),
    data: Number.isFinite(l[3].qNum) ? dataDoSerial(l[3].qNum) : null,
  })).filter(x => x.numero)
     .sort((a, b) => String(a.data).localeCompare(String(b.data)) || a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }));

  // 3) quais fornecedores o padrão do laboratório pegou (o usuário confere)
  const f = await criarCubo(engine, hDoc, {
    qDimensions: [{ qDef: { qFieldDefs: [alvoLaboratorio(config, padraoFornecedor).campo] }, qNullSuppression: true }],
    qMeasures: [medida], qSuppressZero: true, qInitialDataFetch: [],
  }, 'fornecedor');
  const fornecedores = (await lerLinhas(engine, f.h, f.cubo.qSize.qcy, 2)).map(l => limpa(l[0].qText)).filter(Boolean).sort();

  return { total, notas, fornecedores };
}
