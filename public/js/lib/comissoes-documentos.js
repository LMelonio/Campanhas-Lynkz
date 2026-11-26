// ============================================================
//  COMISSÕES — o que vai no recibo, na ADP dos PJ e no Excel do mês (funções puras).
//  Recebem o resultado de apurarMes() (lib/comissoes.js) e o cadastro; não desenham nada.
//  Quem desenha: comissoes-pdf.js (recibo e ADP) e comissoes-excel.js (SheetJS).
//  Testes: tests/comissoes-documentos.test.mjs.
// ============================================================
import { ehPJ, rotuloMesComissao, arred, centavos, reais } from './comissoes.js';

const soDigitos = v => String(v ?? '').replace(/\D/g, '');
export function documentoFormatado(v) {
  const d = soDigitos(v);
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return String(v ?? '');
}
const mesMinusculo = mes => rotuloMesComissao(mes).replace(/^\S+/, m => m.toLowerCase());

// O que falta no cadastro de um PJ para sair no recibo e na ADP.
export function pendenciasPj(c) {
  const falta = [];
  if (!String(c?.pj_razao_social || '').trim()) falta.push('razão social');
  if (!/^(\d{11}|\d{14})$/.test(soDigitos(c?.pj_documento))) falta.push('CNPJ');
  if (!String(c?.pj_pix || '').trim()) falta.push('chave PIX');
  if (!String(c?.pj_banco || '').trim()) falta.push('banco');
  return falta;
}

// ---------- recibo ----------
// Linhas do recibo de um PJ: [{ descricao, base, pct, valor }] (base e pct só nas comissões sobre venda).
// contratoMes: mês avaliado no Contrato de Resultado ("2026-09").
export function itensRecibo(l, { contratoMes = '' } = {}) {
  const itens = [{ descricao: 'Comissão sobre a venda principal', base: l.venda_principal, pct: l.pct_principal, valor: l.comissao_principal }];
  if (l.venda_farelo || l.comissao_farelo) itens.push({ descricao: 'Comissão sobre o Farelo', base: l.venda_farelo, pct: l.pct_farelo, valor: l.comissao_farelo });
  if (l.contrato_valor) {
    itens.push({ descricao: `Premiação Contrato de Resultado${contratoMes ? ` (meta de ${mesMinusculo(contratoMes)})` : ''}`, base: null, pct: null, valor: l.contrato_valor });
  }
  for (const p of l.premiacoes_lista || []) itens.push({ descricao: `Premiação de campanha: ${p.descricao}`, base: null, pct: null, valor: p.valor });
  for (const a of l.ajustes_lista || []) itens.push({ descricao: `${a.valor < 0 ? 'Desconto' : 'Acréscimo'}: ${a.motivo}`, base: null, pct: null, valor: a.valor });
  return itens;
}

// Recibos do mês: um por PJ com valor a pagar. → [{ linha, cadastro, itens, total, falta }]
export function recibosDoMes(resultado, cadastro) {
  const porId = new Map(cadastro.map(c => [c.id, c]));
  return resultado.linhas
    .filter(l => ehPJ(l) && l.valor_pagar > 0)
    .map(l => {
      const c = porId.get(l.id) || {};
      return { linha: l, cadastro: c, cnpj: documentoFormatado(c.pj_documento), itens: itensRecibo(l, { contratoMes: resultado.contrato_periodo?.mes }), total: l.valor_pagar, falta: pendenciasPj(c) };
    });
}

// ---------- ADP dos PJ (documentos diversos / NF) ----------
// Uma linha por PJ com valor a pagar. nfs: { [comissionado_id]: { numero, valor } } (digitado na hora; vence o gravado).
// → [{ id, nome, fornecedor, cnpj, nf, nf_valor, diferenca, valor, observacao, favorecido, chave, banco, falta: [] }]
// diferenca: o valor da NF não bate com o valor a pagar (só avisa; quem gera decide).
export function linhasAdpPj(resultado, cadastro, { nfs = {}, observacaoPadrao = '' } = {}) {
  return recibosDoMes(resultado, cadastro).map(({ linha: l, cadastro: c, falta }) => {
    const nf = String(nfs[l.id]?.numero ?? l.nf_numero ?? '').trim();
    const nfValor = nfs[l.id]?.valor ?? l.nf_valor ?? null;
    const faltando = [...falta];
    if (nfValor == null) faltando.unshift('valor da NF');
    if (!nf) faltando.unshift('número da NF');
    return {
      id: l.id, nome: l.nome,
      fornecedor: String(c.pj_razao_social || l.nome).toUpperCase(),
      cnpj: documentoFormatado(c.pj_documento),
      nf, nf_valor: nfValor == null ? null : arred(nfValor), valor: l.valor_pagar,
      diferenca: nfValor != null && centavos(nfValor) !== centavos(l.valor_pagar),
      observacao: c.adp_observacao || observacaoPadrao,
      favorecido: String(c.pj_razao_social || l.nome).toUpperCase(),
      chave: c.pj_pix || '', banco: String(c.pj_banco || '').toUpperCase(),
      falta: faltando,
    };
  });
}
export const totalLinhas = ls => reais(ls.reduce((s, l) => s + centavos(l.valor), 0));
export const NF_RE = /^[0-9A-Za-z./-]{1,20}$/;

// ---------- Excel do mês (mesmo formato da planilha de outubro/2026) ----------
// Célula: { v, f?, z? } (z: 'moeda' | 'pct' | 'data' | 'int' | 'texto'); null = vazia.
// Fórmulas com ROUND em cada parcela, como o app: o valor que o Excel recalcula é o mesmo da tela.
// base: linhas do Qlik ({ data, cod_fornecedor, … , valor }) ou null (sem a aba Base, as vendas vão como valor).
export const ABA_PREMIACOES = 'Campanha mensal';
export const ABA_AJUSTES = 'Ajustes';
export const ABA_CONTRATO = 'Contrato de Resultado - Mês';
export const ABA_ANALISE = 'Análise de comissões';
export const abaBase = diaCorte => `Base Qlik ${Number(diaCorte) + 1} - ${Number(diaCorte)}`;

const t = v => ({ v, z: 'texto' });
const moeda = (v, f) => ({ v: arred(v), z: 'moeda', ...(f ? { f } : {}) });
const pctCel = (v, f) => ({ v, z: 'pct', ...(f ? { f } : {}) });
const ref = aba => `'${aba.replace(/'/g, "''")}'`;
const serial = civil => {
  const [a, m, d] = String(civil).split('-').map(Number);
  return Math.round((Date.UTC(a, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5);
};

export function modeloExcel(resultado, { parametros, cadastro = [], premiacoes = [], ajustes = [], base = null }) {
  const p = parametros;
  const porId = new Map(cadastro.map(c => [c.id, c]));
  const qlikDe = l => l.nome_qlik || (porId.get(l.id)?.nomes_qlik || [])[0] || l.nome;
  const nomeBase = abaBase(p.dia_corte);
  const abas = [];

  // 1) Campanha mensal
  const nomePorId = new Map(resultado.linhas.map(l => [l.id, qlikDe(l)]));
  const prem = premiacoes.filter(x => x.ativo !== false && nomePorId.has(x.comissionado_id));
  abas.push({
    nome: ABA_PREMIACOES, larguras: [38, 40, 16],
    linhas: [[t('PARTICIPANTE'), t('Campanha'), t('Premiação')],
      ...prem.map(x => [t(nomePorId.get(x.comissionado_id)), t(x.descricao), moeda(x.valor)])],
  });

  // 1b) Ajustes (acréscimo +, desconto −), com motivo
  const ajs = ajustes.filter(x => x.ativo !== false && nomePorId.has(x.comissionado_id));
  abas.push({
    nome: ABA_AJUSTES, larguras: [38, 50, 16],
    linhas: [[t('PARTICIPANTE'), t('Motivo'), t('Valor')],
      ...ajs.map(x => [t(nomePorId.get(x.comissionado_id)), t(x.motivo), moeda(x.valor)])],
  });

  // 2) Contrato de Resultado do mês anterior (só PJ)
  const pjs = resultado.linhas.filter(ehPJ);
  const ct = resultado.contrato_periodo;
  const g = n => Number(n) / 100;
  const contratoLinhas = [
    [t(`Contrato de Resultado: metas e realizado de ${mesMinusculo(ct.mes)}, pago na comissão de ${mesMinusculo(resultado.mes)}.`)],
    [t(`Gatilho: faturamento a partir de ${p.contrato_gatilho_faturamento}% da meta e positivação a partir de ${p.contrato_gatilho_positivacao}%. Prêmio de ${String(p.contrato_pct_faixa1).replace('.', ',')}% do realizado; acima de ${p.contrato_limite_faixa}%, ${String(p.contrato_pct_faixa2).replace('.', ',')}%.`)],
    [],
    [t('PARTICIPANTE'), t('PREMIAÇÃO'), t('META FAT.'), t('REALIZADO FAT.'), t('%'), t('META POSITIVAÇÃO'), t('REALIZADO POSITIVAÇÃO'), t('%'), t('ORIGEM DO REALIZADO')],
  ];
  const linhaContrato = new Map();
  pjs.forEach(l => {
    const r = contratoLinhas.length + 1;
    const c = l.contrato || {};
    linhaContrato.set(l.id, r);
    const temMeta = c.meta_faturamento > 0 && c.meta_positivacao > 0;
    contratoLinhas.push([
      t(qlikDe(l)),
      temMeta ? { v: c.atingiu ? arred(c.valor) : 'Sem Premiação', z: 'moeda',
        f: `IF(AND(N(H${r})>=${g(p.contrato_gatilho_positivacao)},N(E${r})>=${g(p.contrato_gatilho_faturamento)}),ROUND(D${r}*IF(E${r}>${g(p.contrato_limite_faixa)},${g(p.contrato_pct_faixa2)},${g(p.contrato_pct_faixa1)}),2),"Sem Premiação")` }
        : t('Sem meta'),
      c.meta_faturamento ? moeda(c.meta_faturamento) : null,
      moeda(c.realizado_faturamento || 0),
      pctCel(c.pct_faturamento != null ? c.pct_faturamento / 100 : '', `IFERROR(D${r}/C${r},"")`),
      c.meta_positivacao ? { v: c.meta_positivacao, z: 'int' } : null,
      { v: c.positivados || 0, z: 'int' },
      pctCel(c.pct_positivacao != null ? c.pct_positivacao / 100 : '', `IFERROR(G${r}/F${r},"")`),
      t(c.informado ? `Informado: ${c.motivo_informado}` : 'Qlik'),
    ]);
  });
  abas.push({ nome: ABA_CONTRATO, larguras: [38, 16, 16, 16, 9, 18, 22, 9, 36], linhas: contratoLinhas });

  // 3) Análise de comissões (CLT e PJ)
  const temBase = Array.isArray(base) && base.length > 0;
  const nBase = temBase ? base.length + 1 : 0;
  const B = col => `${ref(nomeBase)}!$${col}$2:$${col}$${nBase}`;
  const an = [[null, t('Cód. Fornecedor FARELO (parâmetro único da planilha):'), null, null, null, null, { v: Number(p.cod_farelo), z: 'int' }]];
  if (!temBase) an.push([null, t('Sem a aba Base Qlik: as vendas abaixo são os valores consultados no app.')]);
  const cabecalho = pj => [null, t('PERTENCIMENTO'), t('NOME'), t('IDENTIFICAÇÃO'), t('REGIME'), t('% PRINCIPAL'), t('% FARELO'),
    t('Venda Principal'), t('Venda Farelo'), t('Venda Total'), t('Comissão Principal'), t('Comissão Farelo'), t('Comissão Total'),
    t('Campanha mensal'), t(pj ? 'Contrato Resultado' : 'Acordo mínimo'), t('Ajustes'), t('TOTAL A PAGAR')];
  const totais = [];
  const bloco = (titulo, ls, pj) => {
    an.push([], [null, null, null, null, t(titulo)], cabecalho(pj));
    const ini = an.length + 1;
    ls.forEach(l => {
      const r = an.length + 1;
      const c = porId.get(l.id) || {};
      // ""&$G$1: compara como texto (a base traz o código do fornecedor como texto, igual à extração do Qlik).
      const fareloF = temBase ? `SUMIFS(${B('I')},${B('G')},$D${r},${B('B')},""&$G$1)` : null;
      const totalF = temBase ? `SUMIFS(${B('I')},${B('G')},$D${r})-I${r}` : null;
      const premF = `SUMIFS(${ref(ABA_PREMIACOES)}!$C:$C,${ref(ABA_PREMIACOES)}!$A:$A,$D${r})`;
      const extra = pj
        ? moeda(l.contrato_valor, linhaContrato.has(l.id) ? `IFERROR(SUMIFS(${ref(ABA_CONTRATO)}!$B:$B,${ref(ABA_CONTRATO)}!$A:$A,$D${r}),0)` : null)
        : (l.acordo ? moeda(l.acordo.valor) : null);
      const ajF = `SUMIFS(${ref(ABA_AJUSTES)}!$C:$C,${ref(ABA_AJUSTES)}!$A:$A,$D${r})`;
      const somaF = `M${r}+N${r}+${pj ? `O${r}` : '0'}`;
      // Ajustes entram depois do acordo mínimo; o total nunca fica abaixo de zero.
      const pagarF = pj ? `MAX(0,${somaF}+P${r})` : `MAX(0,IF(N(O${r})>0,MAX(${somaF},O${r}),${somaF})+P${r})`;
      an.push([
        null, t(c.equipe || l.equipe || ''), t(l.nome), t(qlikDe(l)),
        t(l.regime === 'TELEVENDAS' ? 'CLT · Televendas' : l.regime),
        pctCel(l.pct_principal / 100), pctCel(l.pct_farelo / 100),
        moeda(l.venda_principal, totalF), moeda(l.venda_farelo, fareloF), moeda(l.venda_total, `H${r}+I${r}`),
        moeda(l.comissao_principal, `ROUND(H${r}*F${r},2)`), moeda(l.comissao_farelo, `ROUND(I${r}*G${r},2)`), moeda(l.comissao_total, `K${r}+L${r}`),
        moeda(l.premiacoes, premF), extra, moeda(l.ajustes, ajF), moeda(l.valor_pagar, pagarF),
      ]);
    });
    const fim = an.length;
    const r = an.length + 1;
    const soma = col => `SUM(${col}${ini}:${col}${Math.max(ini, fim)})`;
    const tot = ls.reduce((o, l) => {
      for (const k of ['venda_principal', 'venda_farelo', 'venda_total', 'comissao_principal', 'comissao_farelo', 'comissao_total', 'premiacoes', 'ajustes', 'valor_pagar']) o[k] += centavos(l[k]);
      o.extra += centavos(pj ? l.contrato_valor : (l.acordo?.valor || 0));
      return o;
    }, { venda_principal: 0, venda_farelo: 0, venda_total: 0, comissao_principal: 0, comissao_farelo: 0, comissao_total: 0, premiacoes: 0, ajustes: 0, valor_pagar: 0, extra: 0 });
    an.push([null, t('TOTAL'), null, null, null, null, null,
      moeda(reais(tot.venda_principal), soma('H')), moeda(reais(tot.venda_farelo), soma('I')), moeda(reais(tot.venda_total), soma('J')),
      moeda(reais(tot.comissao_principal), soma('K')), moeda(reais(tot.comissao_farelo), soma('L')), moeda(reais(tot.comissao_total), soma('M')),
      moeda(reais(tot.premiacoes), soma('N')), pj ? moeda(reais(tot.extra), soma('O')) : null, moeda(reais(tot.ajustes), soma('P')), moeda(reais(tot.valor_pagar), soma('Q'))]);
    totais.push(`Q${r}`);
  };
  bloco('COMISSÃO DE VENDAS CLT', resultado.linhas.filter(l => !ehPJ(l)), false);
  bloco('COMISSÃO DE VENDAS PJ', pjs, true);
  an.push([], [null, t('TOTAL GERAL A PAGAR'), null, null, null, null, null, null, null, null, null, null, null, null, null, null,
    moeda(resultado.totais.geral.valor_pagar, totais.join('+'))]);
  abas.push({ nome: ABA_ANALISE, larguras: [3, 22, 30, 38, 16, 12, 10, 16, 14, 16, 16, 14, 16, 15, 17, 14, 16], linhas: an });

  // 4) Base Qlik do período
  if (temBase) {
    abas.push({
      nome: nomeBase, larguras: [11, 14, 34, 22, 20, 16, 36, 46, 14], filtro: true,
      linhas: [
        ['Data', 'Cód. Fornecedor', 'Nome Fantasia Fornecedor', 'Segmento', 'Marca do Produto', 'Cód. Vendedor B2B', 'Vendedor B2B', 'Produto', 'Receita (- dev.)'].map(t),
        ...base.map(x => [x.data ? { v: serial(x.data), z: 'data' } : null, t(x.cod_fornecedor), t(x.fornecedor), t(x.segmento), t(x.marca),
          t(x.cod_vendedor), t(x.vendedor), t(x.produto), moeda(x.valor)]),
      ],
    });
  }
  // Sem acento no nome do arquivo: alguns navegadores trocam nomes com acento por "download".
  const arquivo = `Comissoes Lynkz - ${rotuloMesComissao(resultado.mes)}.xlsx`.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return { abas, arquivo };
}
