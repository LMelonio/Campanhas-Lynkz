// ============================================================
//  PLANILHAS ANTIGAS → linhas para importar_historico_planilha()
//
//  Função pura: recebe as linhas de uma planilha (objetos com o cabeçalho
//  como chave) e devolve { linhas, avisos, erros }. Não lê arquivo nem
//  grava nada — isso fica em scripts/importar-planilhas.mjs.
//
//  Entende os dois formatos usados em 2026:
//   - setembro: Solicitante, Cliente, Laboratório, Nome da Campanha, Tipo,
//     Descrição, Forma de Pagamento, Data Início/Fim, Meta, Custo Total,
//     Aprovador, Observações e os 5 dados do recebedor Swile;
//   - outubro: Data Solicitação, Solicitante, Cliente, Laboratório, Tipo,
//     Descrição, Forma de Pagamento, Valor a ser pago, Observações e recebedor.
//  Regras de validação: as mesmas do app (public/js/lib/regras.js).
// ============================================================
import { normaliza, soDigitos, errosRecebedor } from '../../public/js/lib/regras.js';

// Cabeçalho → campo. A comparação é sem acento, caixa e pontuação.
const COLUNAS = [
  ['data_solicitacao', /^data solicitacao$/],
  ['solicitante',      /^solicitante$/],
  ['cliente',          /^cliente$/],
  ['laboratorio',      /^laboratorio$/],
  ['campanha',         /^nome da campanha$/],
  ['tipo',             /^tipo de campanha$/],
  ['mecanica',         /^descricao$/],
  ['forma_pagamento',  /^forma de pagamento$/],
  ['data_inicio',      /^data inicio$/],
  ['data_fim',         /^data fim$/],
  ['meta',             /^meta do cliente/],
  ['valor',            /^(custo total|valor a ser pago)/],
  ['aprovador',        /^aprovador$/],
  ['observacoes',      /^observacoes$/],
  ['rec_nome',         /^nome do recebedor/],
  ['rec_cpf',          /^cpf do recebedor/],
  ['rec_nascimento',   /^data de nascimento do recebedor/],
  ['rec_email',        /^e ?mail do recebedor/],
  ['rec_telefone',     /^telefone do recebedor/],
];
const chave = s => normaliza(s).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export function mapearColunas(cabecalho) {
  const mapa = {};
  for (const h of cabecalho) {
    const c = COLUNAS.find(([, re]) => re.test(chave(h)));
    if (c && !mapa[c[0]]) mapa[c[0]] = h;
  }
  return mapa;
}

// Nome para comparar empresas — mesma regra de normalizar_nome() no banco.
export const nomeComparavel = s => chave(s).toUpperCase()
  .replace(/\b(LTDA|ME|EPP|EIRELI|SA|S A)\b/g, ' ').replace(/\s+/g, ' ').trim();

// ---------- datas ----------
// Excel guarda data como número de dias desde 30/12/1899. A conta é em UTC
// de propósito: o resultado é uma data civil (AAAA-MM-DD), sem fuso.
export function dataCivilDe(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return d.toISOString().slice(0, 10);
  }
  if (v instanceof Date && !Number.isNaN(+v)) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

export const ultimoDiaDoMes = mes => {   // "2026-09" → "2026-09-30"
  const [a, m] = mes.split('-').map(Number);
  return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

const numero = v => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[R$\s]/g, '');
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : 0;
};
const texto = v => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());

// "MARIONE SOUSA SILVA" → "Marione Sousa Silva" (só quando vem tudo maiúsculo ou minúsculo).
const PARTICULAS = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
export function nomeProprio(s) {
  const t = texto(s);
  if (t !== t.toUpperCase() && t !== t.toLowerCase()) return t;
  return t.toLowerCase().split(' ')
    .map((p, i) => (i > 0 && PARTICULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(' ');
}

// Acha o item da lista do config.js (LABORATORIOS, TIPOS, PAGTO) sem acento e caixa.
function daLista(valor, lista, apelidos = {}) {
  const v = texto(valor);
  if (!v) return { valor: null, achou: true };
  const k = chave(v);
  const apelido = Object.entries(apelidos).find(([a]) => chave(a) === k);
  const alvo = apelido ? apelido[1] : v;
  const item = (lista || []).find(x => chave(x) === chave(alvo));
  return { valor: item || alvo, achou: !!item };
}

// Nomes de laboratório usados nas planilhas que têm outro nome no app.
// Mundo Animal é a pasta da Biogénesis Bagó na Lynkz.
export const APELIDOS_LAB = {
  'Ourofino': 'Ouro Fino',
  'Ouro Fino Saúde Animal': 'Ouro Fino',
  'Mundo Animal': 'Biogénesis Bagó Pet',
  'Biogénesis Bagó': 'Biogénesis Bagó Pet',
};

/**
 * @param {object[]} registros  linhas da planilha (chave = texto do cabeçalho)
 * @param {object}   op
 *   mes          "AAAA-MM" de referência da planilha (data da decisão quando ela não tem "Data Solicitação")
 *   prefixo      começo do código (padrão "H" + AAMM)
 *   config       window.CONFIG do app (listas)
 *   dePara       { "nome na planilha": "nome oficial" } para empresas escritas de outro jeito
 *   hoje         "AAAA-MM-DD"
 *   arquivo      nome do arquivo, só para as mensagens
 */
export function converterPlanilha(registros, { mes, prefixo, config = {}, dePara = {}, hoje, arquivo = 'planilha' }) {
  const linhas = [], avisos = [], erros = [];
  if (!registros.length) return { linhas, avisos, erros };
  const col = mapearColunas(Object.keys(registros[0]));
  const faltam = ['cliente', 'laboratorio', 'forma_pagamento', 'valor'].filter(c => !col[c]);
  if (faltam.length) {
    erros.push(`${arquivo}: não achei as colunas ${faltam.join(', ')}. Confira o cabeçalho da primeira linha.`);
    return { linhas, avisos, erros };
  }
  const pre = prefixo || 'H' + mes.slice(2, 4) + mes.slice(5, 7);
  const deParaNorm = Object.fromEntries(Object.entries(dePara).map(([a, b]) => [nomeComparavel(a), b]));
  const pega = (r, c) => (col[c] ? r[col[c]] : null);

  registros.forEach((r, i) => {
    const n = i + 2;   // número da linha no Excel (1 = cabeçalho)
    const onde = `${arquivo}, linha ${n}`;
    let empresa = texto(pega(r, 'cliente'));
    if (!empresa) { if (Object.values(r).some(v => texto(v))) erros.push(`${onde}: sem cliente.`); return; }
    if (deParaNorm[nomeComparavel(empresa)]) empresa = deParaNorm[nomeComparavel(empresa)];

    const lab = daLista(pega(r, 'laboratorio'), config.LABORATORIOS, APELIDOS_LAB);
    if (!lab.achou) avisos.push(`${onde}: laboratório "${lab.valor}" não está na lista do app; entra como está.`);
    const tipo = daLista(pega(r, 'tipo'), config.TIPOS);
    if (!tipo.achou) avisos.push(`${onde}: tipo "${tipo.valor}" não está na lista do app; entra como está.`);
    const pagto = daLista(pega(r, 'forma_pagamento'), config.PAGTO);

    const dataSol = dataCivilDe(pega(r, 'data_solicitacao'));
    const decisao = dataSol || ultimoDiaDoMes(mes);
    let inicio = dataCivilDe(pega(r, 'data_inicio'));
    let fim = dataCivilDe(pega(r, 'data_fim'));
    if (inicio && fim && fim < inicio) { avisos.push(`${onde}: data fim antes do início; as datas ficaram de fora.`); inicio = fim = null; }

    const nomeCampanha = texto(pega(r, 'campanha'))
      || [tipo.valor, lab.valor ? `(${lab.valor})` : ''].filter(Boolean).join(' ') || 'Campanha importada';

    // Recebedor: só quando há algum dado. Com Swile, os 5 são obrigatórios (regra do banco).
    const rec = {
      nome_completo: nomeProprio(pega(r, 'rec_nome')),
      cpf: soDigitos(pega(r, 'rec_cpf')),
      data_nascimento: dataCivilDe(pega(r, 'rec_nascimento')),
      email: texto(pega(r, 'rec_email')).toLowerCase(),
      telefone: soDigitos(pega(r, 'rec_telefone')),
    };
    const temRecebedor = Object.values(rec).some(Boolean);
    let recebedor = null;
    if (temRecebedor) {
      const e = errosRecebedor(rec, hoje);
      if (Object.keys(e).length) {
        if (pagto.valor === 'Swile') { erros.push(`${onde} (${empresa}): recebedor Swile com problema — ${Object.values(e).join(' ')}`); return; }
        avisos.push(`${onde}: dados do recebedor incompletos; a campanha entra sem eles.`);
      } else {
        recebedor = { nome: rec.nome_completo, cpf: rec.cpf, nascimento: rec.data_nascimento, email: rec.email, telefone: rec.telefone };
      }
    } else if (pagto.valor === 'Swile') {
      erros.push(`${onde} (${empresa}): pagamento Swile sem os dados de quem recebe.`); return;
    }

    linhas.push({
      codigo: `${pre}${String(i + 1).padStart(3, '0')}`,
      empresa,
      solicitante: texto(pega(r, 'solicitante')) || null,
      laboratorio: lab.valor || 'Não informado',
      campanha: nomeCampanha,
      tipo: tipo.valor,
      mecanica: texto(pega(r, 'mecanica')) || null,
      forma_pagamento: pagto.valor,
      data_inicio: inicio,
      data_fim: fim,
      meta: numero(pega(r, 'meta')),
      valor: numero(pega(r, 'valor')),
      aprovador: texto(pega(r, 'aprovador')) || null,
      observacoes: texto(pega(r, 'observacoes')) || null,
      data_decisao: decisao,
      criado_em: `${decisao}T12:00:00-03:00`,
      recebedor,
    });
  });
  return { linhas, avisos, erros };
}

// Junta várias planilhas: mais recente primeiro (o banco cadastra o balconista
// com os dados da primeira vez que ele aparece) e aponta conflitos de cadastro.
export function juntarPlanilhas(resultados) {
  const linhas = resultados.flatMap(r => r.linhas)
    .sort((a, b) => b.data_decisao.localeCompare(a.data_decisao) || String(b.data_fim || '').localeCompare(String(a.data_fim || '')));
  const avisos = resultados.flatMap(r => r.avisos);
  const erros = resultados.flatMap(r => r.erros);

  // Mesmo CPF na mesma empresa com dados diferentes: vale o mais recente.
  const vistos = new Map();
  for (const l of linhas) {
    if (!l.recebedor) continue;
    const k = nomeComparavel(l.empresa) + '|' + l.recebedor.cpf;
    const ant = vistos.get(k);
    if (!ant) { vistos.set(k, l); continue; }
    const dif = ['nascimento', 'email', 'telefone'].filter(c => ant.recebedor[c] !== l.recebedor[c]);
    if (dif.length) avisos.push(`${l.recebedor.nome} (${l.empresa}): ${dif.join(', ')} diferente(s) em ${l.codigo}. O cadastro usa o de ${ant.codigo}, mais recente; cada campanha guarda o seu.`);
  }

  // Nomes de empresa parecidos que vão virar cadastros separados: conferir.
  const nomes = [...new Set(linhas.map(l => l.empresa))];
  const norm = new Map(nomes.map(n => [n, nomeComparavel(n)]));
  for (const a of nomes) for (const b of nomes) {
    const na = norm.get(a), nb = norm.get(b);
    if (a < b && na !== nb && (nb.startsWith(na + ' ') || na.startsWith(nb + ' '))) {
      avisos.push(`Empresas "${a}" e "${b}" vão ficar separadas. Se forem a mesma, junte em scripts/de-para-empresas.json.`);
    }
  }
  return { linhas, avisos, erros };
}
