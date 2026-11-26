// Recibos dos PJ (A4 em pé, uma página por representante) e ADP dos PJ (A4 deitada,
// "documentos diversos / NF") em PDF. O conteúdo vem de lib/comissoes-documentos.js
// (recibosDoMes, linhasAdpPj); o desenho, de pdf/motor.js (o mesmo da ADP de campanhas).
import { textosAdp } from './adp.js';
import { abrirPdf, dinheiro, A4_EM_PE, A4_DEITADA, MM } from './pdf/motor.js';
import { dataBR, hojeCivil } from './lib/regras.js';
import { rotuloMesComissao } from './lib/comissoes.js';
import { totalLinhas } from './lib/comissoes-documentos.js';
import { ErroApp } from './dados/erros.js';

// Pagadora = tomador das NF dos PJ (recibo e ADP de comissões). A ADP de campanhas usa CONFIG.ADP.
const PADRAO = {
  EMPRESA_PAGADORA: 'LYNKZ DISTRIBUIDORA LTDA',
  CNPJ_PAGADORA: '27.095.555/0001-10',
  CIDADE: 'São Luís',
  DEPARTAMENTO_PJ: 'SERVIÇOS PRESTADOS PJ',
  FORMA_PJ: 'PIX',
  OBSERVACAO_PJ: 'Pagamento dos representantes comerciais da Lynkz',
};
export const textosComissao = () => ({ ...PADRAO, ...(globalThis.CONFIG?.COMISSOES || {}) });

const MESES_EXTENSO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const dataExtenso = civil => {
  const [a, m, d] = String(civil).split('-').map(Number);
  return `${d} de ${MESES_EXTENSO[m - 1]} de ${a}`;
};
const pctTxt = n => `${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
// Nome de arquivo sem acento: alguns navegadores trocam nomes com acento por "download".
const semAcento = t => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '');
export const nomeArquivoRecibos = (mes, nome = '') => semAcento(`Recibo${nome ? ` ${nome}` : 's'} - Comissao ${rotuloMesComissao(mes)}.pdf`);
export const nomeArquivoAdpPj = mes => semAcento(`ADP - COMISSOES PJ - ${rotuloMesComissao(mes).toUpperCase()}.pdf`);

// ---------- recibo (A4 em pé) ----------
// recibos: de recibosDoMes() · opcoes: { mes, periodo: { inicio, fim }, emitidoEm }
export async function gerarRecibos(recibos, { mes, periodo, emitidoEm = hojeCivil(), arquivo = null }) {
  if (!recibos.length) throw new ErroApp('Nenhum representante PJ com valor a pagar neste mês.');
  const t = textosComissao();
  const P = await abrirPdf(arquivo ? arquivo.replace(/\.pdf$/, '') : `Recibos - Comissão ${rotuloMesComissao(mes)}`);
  const { R, B, C } = P;
  const A = A4_EM_PE[1], X = 18 * MM, W = A4_EM_PE[0] - 2 * X;

  for (const rc of recibos) {
    const l = rc.linha, c = rc.cadastro;
    const g = P.pagina(A4_EM_PE, X, W);
    let y = A - 16 * MM;
    g.logos(y, 30);
    g.texto('RECIBO DE PAGAMENTO', X, y - 13, { f: B, tam: 15, w: W, alinhar: 'centro' });
    g.texto(`Comissão de vendas  ·  ${rotuloMesComissao(mes)}`, X, y - 28, { tam: 9.5, cor: C.ink2, w: W, alinhar: 'centro' });
    y -= 40;
    g.linha(X, y, X + W, y, 1.4, C.verde);
    y -= 24;

    // Quem paga e quem recebe.
    const meia = (W - 12) / 2;
    const bloco = (x, rot, linhas) => {
      g.texto(rot, x, y, { f: B, tam: 7, cor: C.verdeEsc });
      linhas.forEach(([s, f], i) => g.texto(s, x, y - 14 - i * 12, { f: f || R, tam: 9.5, w: meia }));
    };
    bloco(X, 'PAGADOR', [[t.EMPRESA_PAGADORA, B], [`CNPJ: ${t.CNPJ_PAGADORA}`]]);
    bloco(X + meia + 12, 'RECEBEDOR', [
      [String(c.pj_razao_social || l.nome).toUpperCase(), B],
      [`CNPJ: ${rc.cnpj || '—'}`],
      [`Representante: ${l.nome}`],
    ]);
    y -= 60;

    const decl = `Declaro ter recebido de ${t.EMPRESA_PAGADORA}, CNPJ ${t.CNPJ_PAGADORA}, a importância de ${dinheiro(rc.total)}, referente à comissão de vendas de ${rotuloMesComissao(mes).toLowerCase()}, conforme o detalhamento abaixo.`;
    P.quebrar(decl, R, 10, W, 3).forEach((s, i) => g.texto(s, X, y - i * 14, { tam: 10 }));
    y -= 46;

    // Tabela: descrição, venda, %, valor.
    const cols = [{ t: 'DESCRIÇÃO', w: W - 230 }, { t: 'VENDA', w: 100, d: true }, { t: '%', w: 50, d: true }, { t: 'VALOR', w: 80, d: true }];
    const h = 16;
    g.caixa(X, y - h, W, h, { color: C.verdeEsc });
    let x = X;
    cols.forEach(k => { g.texto(k.t, x + 6, y - 11, { f: B, tam: 7, cor: C.branco, w: k.w - 12, alinhar: k.d ? 'dir' : 'esq' }); x += k.w; });
    y -= h;
    rc.itens.forEach((it, i) => {
      const hl = 18;
      if (i % 2) g.caixa(X, y - hl, W, hl, { color: C.zebra });
      const vals = [it.descricao, it.base == null ? '' : dinheiro(it.base), it.pct == null ? '' : pctTxt(it.pct), dinheiro(it.valor)];
      x = X;
      cols.forEach((k, j) => { g.texto(vals[j], x + 6, y - 12.5, { tam: 9, f: j === 3 ? B : R, w: k.w - 12, alinhar: k.d ? 'dir' : 'esq' }); x += k.w; });
      y -= hl;
      g.linha(X, y, X + W, y, 0.5);
    });
    const ht = 22;
    g.caixa(X, y - ht, W, ht, { color: C.verdeCl });
    g.linha(X, y, X + W, y, 1, C.verde);
    g.texto('TOTAL GERAL A PAGAR', X + 6, y - 14.5, { f: B, tam: 9.5 });
    g.texto(dinheiro(rc.total), X, y - 15, { f: B, tam: 12, cor: C.verdeEsc, w: W - 6, alinhar: 'dir' });
    y -= ht + 26;

    // Dados para o pagamento.
    g.texto('DADOS PARA O PAGAMENTO', X, y, { f: B, tam: 7, cor: C.verdeEsc });
    [[`Favorecido: ${String(c.pj_razao_social || l.nome).toUpperCase()}`], [`Chave PIX: ${c.pj_pix || '—'}`], [`Banco: ${String(c.pj_banco || '—').toUpperCase()}`]]
      .forEach(([s], i) => g.texto(s, X, y - 14 - i * 12, { tam: 9.5, w: W }));
    y -= 70;

    g.texto(`${t.CIDADE}, ${dataExtenso(emitidoEm)}.`, X, y, { tam: 10 });
    y -= 64;
    const wa = W * 0.6, xa = X + (W - wa) / 2;
    g.linha(xa, y, xa + wa, y, 0.7, C.ink);
    g.texto(String(c.pj_razao_social || l.nome).toUpperCase(), xa, y - 12, { f: B, tam: 9, w: wa, alinhar: 'centro' });
    g.texto(`CNPJ ${rc.cnpj || '—'}`, xa, y - 24, { tam: 8.5, cor: C.ink2, w: wa, alinhar: 'centro' });

    g.texto(`Vendas de ${dataBR(periodo.inicio)} a ${dataBR(periodo.fim)}, receita menos devoluções.`, X, 12 * MM, { tam: 7.2, cor: C.ink2, w: W });
  }
  const nome = arquivo || nomeArquivoRecibos(mes, recibos.length === 1 ? recibos[0].linha.nome : '');
  await P.baixar(nome);
  return { quantidade: recibos.length, arquivo: nome };
}

// ---------- ADP dos PJ (A4 deitada) ----------
// linhas: de linhasAdpPj() já conferidas (todas com NF) · opcoes: { mes, vencimento, emitidoEm }
export async function gerarAdpPj(linhas, { mes, vencimento, emitidoEm = hojeCivil() }) {
  if (!linhas.length) throw new ErroApp('Marque pelo menos um representante para a ADP.');
  const ta = textosAdp(), tc = textosComissao();
  const P = await abrirPdf(nomeArquivoAdpPj(mes).replace(/\.pdf$/, ''));
  const { B, C } = P;
  const F = P.fluxo({ tamanho: A4_DEITADA, x: 13 * MM, topo: 14 * MM, base: 11 * MM });
  const total = totalLinhas(linhas);

  F.cabecalho('AUTORIZAÇÃO DE PAGAMENTO', `DOCUMENTOS DIVERSOS / NF  ·  COMISSÕES PJ  ·  ${rotuloMesComissao(mes).toUpperCase()}`);
  F.faixa([
    [`EMPRESA PAGADORA · CNPJ ${tc.CNPJ_PAGADORA}`, tc.EMPRESA_PAGADORA, 1.6], ['LOJA', ta.LOJA, 1], ['DEPARTAMENTO', tc.DEPARTAMENTO_PJ, 1.55],
    ['FORMA DE PAGAMENTO', tc.FORMA_PJ, 0.85], ['VENCIMENTO', dataBR(vencimento), 0.8],
    [`TOTAL A PAGAR · ${linhas.length} ${linhas.length === 1 ? 'NOTA' : 'NOTAS'}`, dinheiro(total), 1.25],
  ]);
  F.tabela('NOTAS FISCAIS DOS REPRESENTANTES', [
    { titulo: 'ITEM', w: 28, alinhar: 'centro', f: B, cor: C.ink2, valor: (l, i) => String(i + 1) },
    { titulo: 'CNPJ', w: 96, alinhar: 'centro', valor: l => l.cnpj },
    { titulo: 'FORNECEDOR', w: 190, f: B, linhas: 2, valor: l => l.fornecedor },
    { titulo: 'TIPO', w: 34, alinhar: 'centro', valor: () => 'NF' },
    { titulo: 'NF', w: 52, alinhar: 'centro', f: B, valor: l => l.nf },
    { titulo: 'OBSERVAÇÃO AO FISCAL - SERVIÇO REALIZADO', w: 0, linhas: 2, valor: l => l.observacao || tc.OBSERVACAO_PJ },
    { titulo: 'VALOR', w: 76, alinhar: 'dir', f: B, valor: l => dinheiro(l.valor) },
  ], linhas, { total: { rotulo: 'TOTAL GERAL', valor: total } });
  F.tabela('DADOS BANCÁRIOS DOS FAVORECIDOS', [
    { titulo: 'ITEM', w: 28, alinhar: 'centro', f: B, cor: C.ink2, valor: (l, i) => String(i + 1) },
    { titulo: 'FAVORECIDO', w: 0, f: B, valor: l => l.favorecido },
    { titulo: 'CESSÃO DE CRÉDITO', w: 92, alinhar: 'centro', valor: () => 'NÃO' },
    { titulo: 'FORMA', w: 46, alinhar: 'centro', valor: () => tc.FORMA_PJ },
    { titulo: 'CHAVE', w: 150, alinhar: 'centro', valor: l => l.chave },
    { titulo: 'BANCO', w: 96, alinhar: 'centro', valor: l => l.banco },
    { titulo: 'VENC.', w: 58, alinhar: 'centro', valor: () => dataBR(vencimento) },
    { titulo: 'R$', w: 76, alinhar: 'dir', f: B, valor: l => dinheiro(l.valor) },
  ], linhas);
  F.assinatura(emitidoEm);
  F.numerarPaginas();

  const nome = nomeArquivoAdpPj(mes);
  await P.baixar(nome);
  return { total, quantidade: linhas.length, paginas: F.paginas, arquivo: nome };
}
