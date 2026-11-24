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
    // Devoluções (v2.9): linhas com Tipo de Venda = "Devolução", sem número de nota.
    // No atacado "Nota Fiscal Origem" vem vazio; só a série da nota de origem vem preenchida.
    tipoVenda:   'Tipo de Venda',
    serieOrigem: 'Série Nota Fiscal Origem',
  },
  devolucao: 'Devolução',   // valor de tipoVenda nas linhas de devolução
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
  // interno = mensagem que veio do próprio Qlik: vai para o log, nunca para a tela.
  constructor(msg, { status = 502, interno = false } = {}) { super(msg); this.status = status; this.interno = interno; }
}

// ---------- valores seguros para dentro de uma expressão do Qlik ----------
// Nada de aspas, chaves, <, >, $ ou ; vindo do usuário: vira expressão solta.
const PERIGOSO = /["'`{}<>$;\\\n\r]/;
export function valorSeguro(v, rotulo) {
  const s = String(v ?? '').trim();
  if (!s || s.length > 80 || PERIGOSO.test(s)) throw new ErroQlik(`${rotulo} inválido.`, { status: 400 });
  return s;
}

// Código do cliente: só letras, números, ponto e hífen (é comparado entre aspas simples).
export function codigoSeguro(v) {
  const s = String(v ?? '').trim();
  if (!/^[A-Za-z0-9.\-]{1,20}$/.test(s)) throw new ErroQlik('Código do cliente inválido.', { status: 400 });
  return s;
}

// Padrão de busca do Qlik (laboratório ou marca), que vai entre aspas duplas.
// Só letras, números, espaço, . & / - + , ( ) % # e o curinga * — nada de "="
// (busca por expressão) nem < > (busca numérica). Precisa ter pelo menos
// 3 letras/números fora do curinga, para "*" sozinho não puxar todos os fornecedores.
export function padraoSeguro(v, rotulo) {
  const s = valorSeguro(v, rotulo);
  const semPrefixo = s.replace(/^marca:\s*/i, '');
  if (!/^[\p{L}\p{N} .&\/+\-*,()%#ºª°]+$/u.test(semPrefixo) || (semPrefixo.match(/[\p{L}\p{N}]/gu) || []).length < 3) {
    throw new ErroQlik(`${rotulo} inválido.`, { status: 400 });
  }
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
  const seguro = padraoSeguro(padrao, 'Laboratório');
  const m = /^marca:\s*(.+)$/i.exec(seguro);
  return m ? { campo: config.campos.marca, padrao: m[1].trim() } : { campo: config.campos.fornecedor, padrao: seguro };
}

// Vários laboratórios (v2.12): agrupa os padrões pelo campo do Qlik (fornecedor ou marca do produto).
export const MAX_PADROES = 5;
export function alvosLaboratorios(config, padroes) {
  const lista = (Array.isArray(padroes) ? padroes : [padroes]);
  if (!lista.length || lista.length > MAX_PADROES) throw new ErroQlik('Laboratório inválido.', { status: 400 });
  const porCampo = new Map();
  for (const p of lista) {
    const a = alvoLaboratorio(config, p);
    const atual = porCampo.get(a.campo) || [];
    if (!atual.includes(a.padrao)) atual.push(a.padrao);
    porCampo.set(a.campo, atual);
  }
  return [...porCampo].map(([campo, ps]) => ({ campo, padroes: ps }));
}

// Modificador de conjunto (vai dentro de {1…}, ver expressao()): <[Cód. Cliente]={'123'}, [Fornecedor]={"OURO*"}, [Data Venda]={"=Num(..)>=A and Num(..)<=B"}, …>
// A data usa expressão: a busca numérica (">=46000<=46030") não casa neste app do Qlik.
// padraoFornecedor: um padrão ou uma lista (vários laboratórios, v2.12). Os do mesmo campo vão juntos
// ([Fornecedor]={"OURO FINO*","*Avert*"}); fornecedor + marca do produto viram a união de dois conjuntos
// ("<…>+1<…>", que expressao() embrulha em {1…}).
// semLaboratorio: o mesmo filtro sem fornecedor nem marca (tudo o que o cliente comprou no período).
// extras: filtros a mais em todos os conjuntos (ex.: só as linhas de devolução).
export function montarConjunto({ config = CONFIG_PADRAO, codigoCliente, padraoFornecedor, marca = null, inicio, fim, semLaboratorio = false, extras = [] }) {
  const c = config.campos;
  const alvos = alvosLaboratorios(config, padraoFornecedor);
  const marcaSegura = marca && !semLaboratorio ? padraoSeguro(marca, 'Marca') : null;
  // Only({1} …): a busca por expressão é avaliada nas seleções salvas do app; sem o {1},
  // só as datas do mês selecionado (ex.: jul/2026) passavam no filtro (conferido no Qlik real, v2.8.1).
  const dt = `Only({1} Num(${nomeCampo(c.data)}))`;
  const lista = ps => ps.map(p => `"${p}"`).join(',');
  const parte = alvo => {
    // Laboratório que no Qlik é marca + marca escolhida: interseção no mesmo campo ({"CATLIFE"}*{"X"}).
    const marcaNoAlvo = marcaSegura && alvo && alvo.campo === c.marca;
    const partes = [
      `${nomeCampo(c.cliente)}={'${codigoSeguro(codigoCliente)}'}`,
      ...(alvo ? [`${nomeCampo(alvo.campo)}={${lista(alvo.padroes)}}${marcaNoAlvo ? `*{"${marcaSegura}"}` : ''}`] : []),
      // "< fim + 1": inclui o último dia inteiro, mesmo se a data vier com hora.
      `${nomeCampo(c.data)}={"=${dt}>=${serialQlik(inicio)} and ${dt}<${serialQlik(fim) + 1}"}`,
      // Marca (opcional): uma linha de produtos do laboratório, ex.: WELLPET dentro da Ouro Fino.
      ...(marcaSegura && !marcaNoAlvo ? [`${nomeCampo(c.marca)}={"${marcaSegura}"}`] : []),
      ...(config.filtros || []).map(f => `${nomeCampo(f.campo)}={'${valorSeguro(f.valor, 'Filtro')}'}`),
      ...extras,
    ];
    return `<${partes.join(', ')}>`;
  };
  if (semLaboratorio) return parte(null);
  return alvos.map(parte).join('+1');
}
// "{1<…>}" e não "{<…>}": o app do Qlik abre com as seleções salvas de quem usou por último
// (ex.: jul/2026 + PLANTAS NATURAIS), e "{<…>}" partiria delas — tudo dava R$ 0,00 (v2.8.1).
// O "1" parte do app inteiro e aplica só os nossos filtros.
export const conjuntoSemSelecoes = conjunto => `{1${conjunto}}`;
export const expressao = (config, conjunto) => config.expressaoValor.replaceAll('{SET}', conjuntoSemSelecoes(conjunto));

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
    if (m.error) p.falha(new ErroQlik(`Qlik: ${m.error.message}${m.error.parameter ? ` (${m.error.parameter})` : ''}`, { interno: true }));
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
const centavos = n => Math.round(n * 100);

/**
 * Quais notas provavelmente foram devolvidas. O Qlik não diz (no atacado "Nota Fiscal Origem" vem
 * vazio), só quanto foi devolvido em cada série. Para cada série, procura 1, 2 ou 3 notas cuja soma seja
 * EXATAMENTE o valor devolvido (das mais recentes para as mais antigas). Sem combinação exata, nenhuma.
 * As notas continuam na lista: a tela as mostra riscadas, fora da soma (v2.9).
 * @param {{numero,serie,data,valor}[]} notas
 * @param {Map<string, number>} devolvidoPorSerie  série → valor devolvido (positivo)
 * @returns {Set<number>} índices das notas na lista recebida
 */
export function acharDevolvidas(notas, devolvidoPorSerie) {
  const fora = new Set();
  for (const [serie, devolvido] of devolvidoPorSerie) {
    const alvo = centavos(devolvido);
    if (alvo <= 0) continue;
    const da = notas.map((n, i) => ({ i, c: centavos(n.valor), data: String(n.data) }))
      .filter(x => notas[x.i].serie === serie && !fora.has(x.i) && x.c > 0 && x.c <= alvo)
      .sort((a, b) => b.data.localeCompare(a.data));
    const achar = () => {
      for (const a of da) if (a.c === alvo) return [a];
      for (let x = 0; x < da.length; x++) for (let y = x + 1; y < da.length; y++) {
        if (da[x].c + da[y].c === alvo) return [da[x], da[y]];
      }
      for (let x = 0; x < da.length; x++) for (let y = x + 1; y < da.length; y++) {
        const r = alvo - da[x].c - da[y].c;
        if (r <= 0) continue;
        for (let z = y + 1; z < da.length; z++) if (da[z].c === r) return [da[x], da[y], da[z]];
      }
      return null;
    };
    (achar() || []).forEach(a => fora.add(a.i));
  }
  return fora;
}
const limpa = t => (t == null || t === '-' ? '' : String(t).trim());

/**
 * Quanto o cliente comprou do fornecedor no período e quais notas compõem isso.
 * @returns {{ total:number, notas:{numero,serie,data,valor,provavel_devolucao?}[], devolucoes:number, fornecedores:string[], marcas:{nome,valor}[] }}
 */
export async function consultarCompras(engine, { appId, config = CONFIG_PADRAO, codigoCliente, padraoFornecedor, marca = null, inicio, fim }) {
  const conjunto = montarConjunto({ config, codigoCliente, padraoFornecedor, marca, inicio, fim });
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
  const medidaData = { qDef: { qDef: `Min(${conjuntoSemSelecoes(conjunto)} ${nomeCampo(c.data)})` } };
  const n = await criarCubo(engine, hDoc, {
    qDimensions: [
      { qDef: { qFieldDefs: [c.nota] }, qNullSuppression: true },
      { qDef: { qFieldDefs: [c.serie] }, qNullSuppression: false },
    ],
    qMeasures: [medida, medidaData], qSuppressZero: true, qInitialDataFetch: [],
  }, 'nota fiscal');
  const linhas = await lerLinhas(engine, n.h, n.cubo.qSize.qcy, 4);
  let notas = linhas.map(l => ({
    numero: limpa(l[0].qText), serie: limpa(l[1].qText),
    valor: arredonda(l[2].qNum),
    data: Number.isFinite(l[3].qNum) ? dataDoSerial(l[3].qNum) : null,
  })).filter(x => x.numero)
     .sort((a, b) => String(a.data).localeCompare(String(b.data)) || a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }));

  // 2b) devoluções (v2.9): o total já desconta, mas a nota devolvida vem com o valor cheio.
  // devolucoes = soma das notas − total, para a conta fechar sempre: soma das notas − devoluções = total.
  // Só quando há diferença: quanto foi devolvido em cada série → marca as notas de provável devolução.
  let devolucoes = 0;
  const diferenca = centavos(notas.reduce((s, x) => s + x.valor, 0)) - centavos(total);
  if (diferenca > 0) devolucoes = diferenca / 100;
  if (diferenca > 0 && c.tipoVenda && c.serieOrigem) {
    try {
      const soDevolucoes = montarConjunto({ config, codigoCliente, padraoFornecedor, marca, inicio, fim,
        extras: [`${nomeCampo(c.tipoVenda)}={'${valorSeguro(config.devolucao ?? CONFIG_PADRAO.devolucao, 'Devolução')}'}`] });
      const d = await criarCubo(engine, hDoc, {
        qDimensions: [{ qDef: { qFieldDefs: [c.serieOrigem] }, qNullSuppression: false }],
        qMeasures: [{ qDef: { qDef: expressao(config, soDevolucoes) } }], qSuppressZero: true, qInitialDataFetch: [],
      }, 'devolução');
      const porSerie = new Map((await lerLinhas(engine, d.h, d.cubo.qSize.qcy, 2))
        .map(l => [limpa(l[0].qText), -arredonda(l[1].qNum)]));
      const devolvidas = acharDevolvidas(notas, porSerie);
      notas = notas.map((x, i) => (devolvidas.has(i) ? { ...x, provavel_devolucao: true } : x));
    } catch (e) {
      if (!(e instanceof ErroQlik)) throw e;   // campo de devolução sumiu do app: segue com as notas cheias
    }
  }

  // 3) quais fornecedores os padrões dos laboratórios pegaram (o usuário confere).
  // Com algum laboratório por fornecedor, lista os fornecedores; só por marca, as marcas.
  const alvos = alvosLaboratorios(config, padraoFornecedor);
  const campoConferir = alvos.some(a => a.campo === c.fornecedor) ? c.fornecedor : alvos[0].campo;
  const f = await criarCubo(engine, hDoc, {
    qDimensions: [{ qDef: { qFieldDefs: [campoConferir] }, qNullSuppression: true }],
    qMeasures: [medida], qSuppressZero: true, qInitialDataFetch: [],
  }, 'fornecedor');
  const fornecedores = (await lerLinhas(engine, f.h, f.cubo.qSize.qcy, 2)).map(l => limpa(l[0].qText)).filter(Boolean).sort();

  // 4) marcas do laboratório que o cliente comprou no período. Sempre SEM o filtro de marca,
  // para a lista continuar completa depois que o usuário escolhe uma.
  const sem = montarConjunto({ config, codigoCliente, padraoFornecedor, inicio, fim });
  const mc = await criarCubo(engine, hDoc, {
    qDimensions: [{ qDef: { qFieldDefs: [c.marca], qSortCriterias: [{ qSortByAscii: 1 }] }, qNullSuppression: true }],
    qMeasures: [{ qDef: { qDef: expressao(config, sem) } }], qSuppressZero: true, qInitialDataFetch: [],
  }, 'marca');
  const marcas = (await lerLinhas(engine, mc.h, mc.cubo.qSize.qcy, 2))
    .map(l => ({ nome: limpa(l[0].qText), valor: arredonda(l[1].qNum) })).filter(m => m.nome)
    .sort((a, b) => b.valor - a.valor);

  // Total zero: quanto o cliente comprou de TODOS os fornecedores no mesmo período e filtros.
  // Separa "não comprou deste laboratório" (> 0) de "o Qlik não devolve nada deste cliente" (0),
  // que costuma ser chave de API sem acesso aos dados ou filtro fixo que não existe mais.
  let clienteTotal = null;
  if (total === 0) {
    const tudo = expressao(config, montarConjunto({ config, codigoCliente, padraoFornecedor, inicio, fim, semLaboratorio: true }));
    const ct = await criarCubo(engine, hDoc, { qDimensions: [], qMeasures: [{ qDef: { qDef: tudo } }], qInitialDataFetch: [] }, 'valor');
    clienteTotal = arredonda(ct.cubo.qGrandTotalRow?.[0]?.qNum);
  }

  return { total, notas, devolucoes, fornecedores, marcas, cliente_total: clienteTotal };
}
