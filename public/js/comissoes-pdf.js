// Recibos dos PJ (A4 em pé, uma página por representante) e ADP dos PJ (A4 deitada,
// "documentos diversos / NF") em PDF. O conteúdo vem de lib/comissoes-documentos.js
// (recibosDoMes, linhasAdpPj); aqui só desenha. Mesmo visual da ADP de campanhas (adp.js).
import { textoPdf, textosAdp } from './adp.js';
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
const reais = n => (n < 0 ? '−' : '') + 'R$ ' + Math.abs(Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctTxt = n => `${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
// Nome de arquivo sem acento: alguns navegadores trocam nomes com acento por "download".
const semAcento = t => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '');
export const nomeArquivoRecibos = (mes, nome = '') => semAcento(`Recibo${nome ? ` ${nome}` : 's'} - Comissao ${rotuloMesComissao(mes)}.pdf`);
export const nomeArquivoAdpPj = mes => semAcento(`ADP - COMISSOES PJ - ${rotuloMesComissao(mes).toUpperCase()}.pdf`);

// ---------- motor de desenho (pdf-lib, carregado só ao gerar) ----------
const PDFLIB = new URL('../vendor/pdf-lib-1.17.1.min.js', import.meta.url).href;
const LOGOS = {
  lynkz: new URL('../assets/adp-logo-lynkz.png', import.meta.url).href,
  terrazoo: new URL('../assets/adp-logo-terrazoo.png', import.meta.url).href,
};
const MM = 2.835;

async function abrirPdf(titulo) {
  let L;
  try { L = await import(PDFLIB); }
  catch { throw new ErroApp('A biblioteca do PDF não carregou. Confira a internet e tente de novo.'); }
  const { PDFDocument, StandardFonts, rgb } = L;
  const cor = hex => rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
  const doc = await PDFDocument.create();
  doc.setTitle(titulo); doc.setAuthor('LYNKZ Campanhas'); doc.setCreator('LYNKZ Campanhas');
  const R = await doc.embedFont(StandardFonts.Helvetica);
  const B = await doc.embedFont(StandardFonts.HelveticaBold);
  let logos = null;
  try {
    const bytes = async u => { const r = await fetch(u); if (!r.ok) throw new Error(u); return new Uint8Array(await r.arrayBuffer()); };
    const [a, b] = await Promise.all([bytes(LOGOS.lynkz), bytes(LOGOS.terrazoo)]);
    logos = { lynkz: await doc.embedPng(a), terrazoo: await doc.embedPng(b) };
  } catch (e) { console.warn('Logos do PDF não carregaram', e); }
  const C = {
    verde: cor('#2E8B57'), verdeEsc: cor('#1F6B42'), verdeCl: cor('#EAF5EE'), verdeTx: cor('#D7EFE0'),
    ink: cor('#1B1E22'), ink2: cor('#555D66'), linha: cor('#DCE1E5'), zebra: cor('#F7F9FA'), branco: rgb(1, 1, 1),
  };
  const larg = (s, f, tam) => f.widthOfTextAtSize(s, tam);
  const cortar = (s, f, tam, w) => {
    s = textoPdf(s);
    if (larg(s, f, tam) <= w) return s;
    while (s.length > 1 && larg(s + '…', f, tam) > w) s = s.slice(0, -1);
    return s.trimEnd() + '…';
  };
  const quebrar = (s, f, tam, w, max = 3) => {
    // "R$" fica grudado no número (não quebra a linha entre os dois).
    const palavras = textoPdf(s).split(' ').filter(Boolean).reduce((ps, p) => (ps[ps.length - 1] === 'R$' ? (ps[ps.length - 1] += ' ' + p, ps) : (ps.push(p), ps)), []);
    const out = [];
    let atual = '';
    for (let i = 0; i < palavras.length; i++) {
      const p = palavras[i];
      const teste = atual ? atual + ' ' + p : p;
      if (larg(teste, f, tam) <= w || !atual) { atual = teste; continue; }
      out.push(atual); atual = p;
      if (out.length === max - 1) { atual = palavras.slice(i).join(' '); break; }
    }
    if (atual) out.push(atual);
    return out.map((l, i) => (i === out.length - 1 ? cortar(l, f, tam, w) : l));
  };
  const pagina = (pag, x0, larguraUtil) => ({
    pag,
    texto(s, x, y, { f = R, tam = 9, cor: c = C.ink, w = null, alinhar = 'esq' } = {}) {
      const v = w ? cortar(s, f, tam, w) : textoPdf(s);
      let xx = x;
      if (alinhar === 'dir') xx = x + (w ?? 0) - larg(v, f, tam);
      else if (alinhar === 'centro') xx = x + ((w ?? 0) - larg(v, f, tam)) / 2;
      pag.drawText(v, { x: xx, y, size: tam, font: f, color: c });
    },
    caixa(x, y, w, h, opc) { pag.drawRectangle({ x, y, width: w, height: h, ...opc }); },
    linha(x1, y1, x2, y2, espessura = 0.6, c = C.linha) { pag.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: espessura, color: c }); },
    logos(yTopo, h) {
      if (!logos) return;
      const lz = logos.lynkz.scaleToFit(70, 23);
      pag.drawImage(logos.lynkz, { x: x0, y: yTopo - h / 2 - lz.height / 2, ...lz });
      const tz = logos.terrazoo.scaleToFit(30, 29);
      pag.drawImage(logos.terrazoo, { x: x0 + larguraUtil - tz.width, y: yTopo - h / 2 - tz.height / 2, ...tz });
    },
  });
  const baixar = async nome => {
    const bytes = await doc.save();
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url; a.download = nome; a.hidden = true;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
  return { doc, R, B, C, cortar, quebrar, pagina, baixar };
}

// ---------- recibo (A4 em pé) ----------
// recibos: de recibosDoMes() · opcoes: { mes, periodo: { inicio, fim }, emitidoEm }
export async function gerarRecibos(recibos, { mes, periodo, emitidoEm = hojeCivil(), arquivo = null }) {
  if (!recibos.length) throw new ErroApp('Nenhum representante PJ com valor a pagar neste mês.');
  const t = textosComissao();
  const P = await abrirPdf(arquivo ? arquivo.replace(/\.pdf$/, '') : `Recibos - Comissão ${rotuloMesComissao(mes)}`);
  const { R, B, C } = P;
  const L = 595.28, A = 841.89, X = 18 * MM, W = L - 2 * X;

  for (const rc of recibos) {
    const l = rc.linha, c = rc.cadastro;
    const g = P.pagina(P.doc.addPage([L, A]), X, W);
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

    const decl = `Declaro ter recebido de ${t.EMPRESA_PAGADORA}, CNPJ ${t.CNPJ_PAGADORA}, a importância de ${reais(rc.total)}, referente à comissão de vendas de ${rotuloMesComissao(mes).toLowerCase()}, conforme o detalhamento abaixo.`;
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
      const vals = [it.descricao, it.base == null ? '' : reais(it.base), it.pct == null ? '' : pctTxt(it.pct), reais(it.valor)];
      x = X;
      cols.forEach((k, j) => { g.texto(vals[j], x + 6, y - 12.5, { tam: 9, f: j === 3 ? B : R, w: k.w - 12, alinhar: k.d ? 'dir' : 'esq' }); x += k.w; });
      y -= hl;
      g.linha(X, y, X + W, y, 0.5);
    });
    const ht = 22;
    g.caixa(X, y - ht, W, ht, { color: C.verdeCl });
    g.linha(X, y, X + W, y, 1, C.verde);
    g.texto('TOTAL GERAL A PAGAR', X + 6, y - 14.5, { f: B, tam: 9.5 });
    g.texto(reais(rc.total), X, y - 15, { f: B, tam: 12, cor: C.verdeEsc, w: W - 6, alinhar: 'dir' });
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
  const { R, B, C } = P;
  const L = 841.89, A = 595.28, X = 13 * MM, W = L - 2 * X, BASE = 11 * MM;
  const total = totalLinhas(linhas);
  const paginas = [];
  let g, y;
  const novaPagina = () => { g = P.pagina(P.doc.addPage([L, A]), X, W); paginas.push(g); y = A - 14 * MM; };

  novaPagina();
  g.logos(y, 30);
  g.texto('AUTORIZAÇÃO DE PAGAMENTO', X, y - 14, { f: B, tam: 15.5, w: W, alinhar: 'centro' });
  g.texto(`DOCUMENTOS DIVERSOS / NF  ·  COMISSÕES PJ  ·  ${rotuloMesComissao(mes).toUpperCase()}`, X, y - 29, { tam: 9.5, cor: C.ink2, w: W, alinhar: 'centro' });
  y -= 36;
  g.linha(X, y, X + W, y, 1.4, C.verde);
  y -= 7;

  // Faixa com o que é igual em todas as linhas.
  const hF = 29;
  const cel = [[`EMPRESA PAGADORA · CNPJ ${tc.CNPJ_PAGADORA}`, tc.EMPRESA_PAGADORA, 1.6], ['LOJA', ta.LOJA, 1], ['DEPARTAMENTO', tc.DEPARTAMENTO_PJ, 1.55],
    ['FORMA DE PAGAMENTO', tc.FORMA_PJ, 0.85], ['VENCIMENTO', dataBR(vencimento), 0.8],
    [`TOTAL A PAGAR · ${linhas.length} ${linhas.length === 1 ? 'NOTA' : 'NOTAS'}`, reais(total), 1.25]];
  const soma = cel.reduce((s, c) => s + c[2], 0);
  let x = X;
  cel.forEach(([rot, val, peso], i) => {
    const w = (W * peso) / soma;
    const ultima = i === cel.length - 1;
    if (ultima) g.caixa(x, y - hF, w, hF, { color: C.verde });
    g.texto(rot, x + 8, y - 10, { tam: 6.4, cor: ultima ? C.verdeTx : C.ink2, w: w - 14 });
    g.texto(val, x + 8, y - 23, { f: B, tam: ultima ? 11.5 : 9, cor: ultima ? C.branco : C.ink, w: w - 14 });
    if (!ultima) g.linha(x + w, y, x + w, y - hF);
    x += w;
  });
  g.caixa(X, y - hF, W, hF, { borderColor: C.linha, borderWidth: 0.6 });
  y -= hF + 8;

  const tabela = (titulo, cols, itens, rodape = null) => {
    const fixa = cols.reduce((s, c) => s + (c.w || 0), 0);
    const livres = cols.filter(c => !c.w).length;
    cols.forEach(c => { c.larg = c.w || (W - fixa) / livres; });
    const PAD = 6, TAM = 8, ENTRE = 9.6;
    const cab = () => {
      g.texto(titulo, X, y - 7, { f: B, tam: 7.4, cor: C.verdeEsc });
      y -= 12;
      g.caixa(X, y - 15, W, 15, { color: C.verdeEsc });
      let xx = X;
      cols.forEach(c => { g.texto(c.titulo, xx + PAD, y - 10, { f: B, tam: 6.4, cor: C.branco, w: c.larg - 2 * PAD, alinhar: c.alinhar || 'esq' }); xx += c.larg; });
      y -= 15;
    };
    cab();
    itens.forEach((l, i) => {
      const cels = cols.map(c => {
        const f = c.f || R;
        const v = c.valor(l, i);
        return { c, f, ls: c.linhas > 1 ? P.quebrar(v, f, TAM, c.larg - 2 * PAD, c.linhas) : [P.cortar(v, f, TAM, c.larg - 2 * PAD)] };
      });
      const h = Math.max(...cels.map(z => z.ls.length)) * ENTRE + 4.4;
      if (y - h < BASE + 8) { novaPagina(); cab(); }
      if (i % 2 === 1) g.caixa(X, y - h, W, h, { color: C.zebra });
      let xx = X;
      cels.forEach(({ c, f, ls }) => {
        const topo = y - (h - ls.length * ENTRE) / 2 - 7.2;
        ls.forEach((s, k) => g.texto(s, xx + PAD, topo - k * ENTRE, { f, tam: TAM, cor: c.cor || C.ink, w: c.larg - 2 * PAD, alinhar: c.alinhar || 'esq' }));
        xx += c.larg;
      });
      y -= h;
      g.linha(X, y, X + W, y, 0.5);
    });
    if (rodape) rodape();
    y -= 8;
  };

  tabela('NOTAS FISCAIS DOS REPRESENTANTES', [
    { titulo: 'ITEM', w: 28, alinhar: 'centro', f: B, cor: C.ink2, valor: (l, i) => String(i + 1) },
    { titulo: 'CNPJ', w: 96, alinhar: 'centro', valor: l => l.cnpj },
    { titulo: 'FORNECEDOR', w: 190, f: B, linhas: 2, valor: l => l.fornecedor },
    { titulo: 'TIPO', w: 34, alinhar: 'centro', valor: () => 'NF' },
    { titulo: 'NF', w: 52, alinhar: 'centro', f: B, valor: l => l.nf },
    { titulo: 'OBSERVAÇÃO AO FISCAL - SERVIÇO REALIZADO', w: 0, linhas: 2, valor: l => l.observacao || tc.OBSERVACAO_PJ },
    { titulo: 'VALOR', w: 76, alinhar: 'dir', f: B, valor: l => reais(l.valor) },
  ], linhas, () => {
    const h = 17;
    if (y - h < BASE + 8) novaPagina();
    g.caixa(X, y - h, W, h, { color: C.verdeCl });
    g.linha(X, y, X + W, y, 1, C.verde);
    g.texto('TOTAL GERAL', X + 6, y - 11.5, { f: B, tam: 8.2 });
    g.texto(reais(total), X, y - 12, { f: B, tam: 10.5, cor: C.verdeEsc, w: W - 6, alinhar: 'dir' });
    y -= h;
  });

  tabela('DADOS BANCÁRIOS DOS FAVORECIDOS', [
    { titulo: 'ITEM', w: 28, alinhar: 'centro', f: B, cor: C.ink2, valor: (l, i) => String(i + 1) },
    { titulo: 'FAVORECIDO', w: 0, f: B, valor: l => l.favorecido },
    { titulo: 'CESSÃO DE CRÉDITO', w: 92, alinhar: 'centro', valor: () => 'NÃO' },
    { titulo: 'FORMA', w: 46, alinhar: 'centro', valor: () => tc.FORMA_PJ },
    { titulo: 'CHAVE', w: 150, alinhar: 'centro', valor: l => l.chave },
    { titulo: 'BANCO', w: 96, alinhar: 'centro', valor: l => l.banco },
    { titulo: 'VENC.', w: 58, alinhar: 'centro', valor: () => dataBR(vencimento) },
    { titulo: 'R$', w: 76, alinhar: 'dir', f: B, valor: l => reais(l.valor) },
  ], linhas);

  const hA = 16 * MM;
  if (y - hA - 6 < BASE) novaPagina();
  const xA = X + W * 0.47, wA = W * 0.53, yA = y - 6 - hA;
  g.caixa(xA, yA, wA, hA, { borderColor: C.verde, borderWidth: 0.8 });
  g.texto('ASSINATURA DO AUTORIZANTE DO PAGAMENTO', xA + 10, yA + hA - 12, { f: B, tam: 6.6, cor: C.verdeEsc });
  g.linha(xA + 10, yA + 12, xA + wA - 10, yA + 12, 0.7, C.ink);
  g.texto(`Emitido em ${dataBR(emitidoEm)}`, X, yA + 4, { tam: 7.2, cor: C.ink2, w: W * 0.44 });
  if (paginas.length > 1) {
    paginas.forEach((p, i) => p.texto(`Página ${i + 1} de ${paginas.length}`, X, BASE - 12, { tam: 7, cor: C.ink2, w: W, alinhar: 'dir' }));
  }
  const nome = nomeArquivoAdpPj(mes);
  await P.baixar(nome);
  return { total, quantidade: linhas.length, paginas: paginas.length, arquivo: nome };
}
