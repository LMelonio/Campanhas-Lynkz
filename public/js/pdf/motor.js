// Motor de desenho dos PDFs (ADP de campanhas, ADP dos PJ e recibos). Um lugar só para:
// abrir o PDF (pdf-lib, carregado só ao gerar), fontes, cores, logos, cortar e quebrar texto, e baixar.
//
//   const P = await abrirPdf('título');
//   const g = P.pagina(A4_EM_PE, x, largura)     página solta: g.texto, g.caixa, g.linha, g.logos
//   const F = P.fluxo({ tamanho, x, topo, base }) páginas em sequência, com quebra automática:
//     F.cabecalho(titulo, subtitulo) · F.faixa(celulas, total) · F.tabela(titulo, cols, itens, { total })
//     F.assinatura(emitidoEm) · F.numerarPaginas()
//   await P.baixar('arquivo.pdf')
import { dataBR } from '../lib/regras.js';
import { ErroApp } from '../dados/erros.js';

export const MM = 2.835;   // pontos por milímetro
export const A4_EM_PE = [595.28, 841.89];
export const A4_DEITADA = [841.89, 595.28];

// As fontes padrão do PDF (Helvetica) só têm o alfabeto latino (WinAnsi):
// troca o que não cabe (aspas curvas, traços, emoji…) por um equivalente.
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
export function textoPdf(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim()
    .replace(/[‐-‒−]/g, '-')
    .replace(/[^ -~ -ÿ]/gu, ch => (WIN_ANSI_EXTRA.has(ch) ? ch : '?'));
}

export const dinheiro = n => (n < 0 ? '−' : '') + 'R$ ' + Math.abs(Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PDFLIB = new URL('../../vendor/pdf-lib-1.17.1.min.js', import.meta.url).href;
const LOGOS = {
  lynkz: new URL('../../assets/adp-logo-lynkz.png', import.meta.url).href,
  terrazoo: new URL('../../assets/adp-logo-terrazoo.png', import.meta.url).href,
};
const CORES = {
  verde: '#2E8B57', verdeEsc: '#1F6B42', verdeCl: '#EAF5EE', verdeTx: '#D7EFE0',
  ink: '#1B1E22', ink2: '#555D66', linha: '#DCE1E5', zebra: '#F7F9FA', branco: '#FFFFFF',
};

async function bytesDe(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return new Uint8Array(await r.arrayBuffer());
}

export async function abrirPdf(titulo) {
  let L;
  try { L = await import(PDFLIB); }
  catch { throw new ErroApp('A biblioteca do PDF não carregou. Confira a internet e tente de novo.'); }
  const { PDFDocument, StandardFonts, rgb } = L;
  const cor = hex => rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
  const C = Object.fromEntries(Object.entries(CORES).map(([k, v]) => [k, cor(v)]));
  const doc = await PDFDocument.create();
  doc.setTitle(titulo); doc.setAuthor('LYNKZ Campanhas'); doc.setCreator('LYNKZ Campanhas');
  const R = await doc.embedFont(StandardFonts.Helvetica);
  const B = await doc.embedFont(StandardFonts.HelveticaBold);
  let logos = null;
  try {
    const [a, b] = await Promise.all([bytesDe(LOGOS.lynkz), bytesDe(LOGOS.terrazoo)]);
    logos = { lynkz: await doc.embedPng(a), terrazoo: await doc.embedPng(b) };
  } catch (e) { console.warn('Logos do PDF não carregaram', e); }

  // ---- texto ----
  const larg = (s, f, tam) => f.widthOfTextAtSize(s, tam);
  const cortar = (s, f, tam, w) => {
    s = textoPdf(s);
    if (larg(s, f, tam) <= w) return s;
    while (s.length > 1 && larg(s + '…', f, tam) > w) s = s.slice(0, -1);
    return s.trimEnd() + '…';
  };
  // Quebra em linhas que cabem em w; no máximo max linhas (a última com reticências se sobrar).
  // grudarReais: "R$" fica grudado no número (não quebra a linha entre os dois).
  const quebrar = (s, f, tam, w, max = 3, { grudarReais = true } = {}) => {
    let palavras = textoPdf(s).split(' ').filter(Boolean);
    if (grudarReais) palavras = palavras.reduce((ps, p) => (ps[ps.length - 1] === 'R$' ? (ps[ps.length - 1] += ' ' + p, ps) : (ps.push(p), ps)), []);
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

  // ---- página solta ----
  const pagina = (tamanho, x0, larguraUtil) => {
    const pag = doc.addPage(tamanho);
    return {
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
      // Lynkz à esquerda e Terrazoo à direita, centrados numa faixa de altura h que começa em yTopo.
      logos(yTopo, h) {
        if (!logos) return;
        const lz = logos.lynkz.scaleToFit(70, 23);
        pag.drawImage(logos.lynkz, { x: x0, y: yTopo - h / 2 - lz.height / 2, ...lz });
        const tz = logos.terrazoo.scaleToFit(30, 29);
        pag.drawImage(logos.terrazoo, { x: x0 + larguraUtil - tz.width, y: yTopo - h / 2 - tz.height / 2, ...tz });
      },
    };
  };

  // ---- páginas em sequência (as duas ADP) ----
  const fluxo = ({ tamanho, x: X, topo, base: BASE, grudarReais = true }) => {
    const W = tamanho[0] - 2 * X;
    const paginas = [];
    let g, y;
    const novaPagina = () => { g = pagina(tamanho, X, W); paginas.push(g); y = tamanho[1] - topo; };
    const cabe = h => y - h >= BASE + 8;
    const linhaTotal = (rotulo, valor) => {
      const h = 17;
      if (!cabe(h)) novaPagina();
      g.caixa(X, y - h, W, h, { color: C.verdeCl });
      g.linha(X, y, X + W, y, 1, C.verde);
      g.texto(rotulo, X + 6, y - 11.5, { f: B, tam: 8.2 });
      g.texto(dinheiro(valor), X, y - 12, { f: B, tam: 10.5, cor: C.verdeEsc, w: W - 6, alinhar: 'dir' });
      y -= h;
    };
    novaPagina();
    return {
      get paginas() { return paginas.length; },
      cabecalho(titulo, subtitulo) {
        const h = 30;
        g.logos(y, h);
        g.texto(titulo, X, y - 14, { f: B, tam: 15.5, w: W, alinhar: 'centro' });
        g.texto(subtitulo, X, y - 29, { tam: 9.5, cor: C.ink2, w: W, alinhar: 'centro' });
        y -= h + 6;
        g.linha(X, y, X + W, y, 1.4, C.verde);
        y -= 7;
      },
      // O que é igual em todas as linhas: celulas [[rótulo, valor, peso]]; a última (o total) fica em destaque.
      faixa(celulas) {
        const h = 29;
        const soma = celulas.reduce((s, c) => s + c[2], 0);
        let x = X;
        celulas.forEach(([rot, val, peso], i) => {
          const w = (W * peso) / soma;
          const ultima = i === celulas.length - 1;
          if (ultima) g.caixa(x, y - h, w, h, { color: C.verde });
          g.texto(rot, x + 8, y - 10, { tam: 6.4, cor: ultima ? C.verdeTx : C.ink2, w: w - 14 });
          g.texto(val, x + 8, y - 23, { f: B, tam: ultima ? 11.5 : 9, cor: ultima ? C.branco : C.ink, w: w - 14 });
          if (!ultima) g.linha(x + w, y, x + w, y - h);
          x += w;
        });
        g.caixa(X, y - h, W, h, { borderColor: C.linha, borderWidth: 0.6 });
        y -= h + 8;
      },
      // cols: [{ titulo, w (0 = o que sobrar), alinhar, f, cor, valor(l, i), linhas: máximo de linhas }].
      // total: { rotulo, valor } desenha a linha de total no fim. Repete o cabeçalho ao mudar de página.
      tabela(titulo, cols, itens, { total = null } = {}) {
        const fixa = cols.reduce((s, c) => s + (c.w || 0), 0);
        const livres = cols.filter(c => !c.w).length;
        const largs = cols.map(c => c.w || (W - fixa) / livres);
        const PAD = 6, TAM = 8, ENTRE = 9.6;
        const cab = () => {
          g.texto(titulo, X, y - 7, { f: B, tam: 7.4, cor: C.verdeEsc });
          y -= 12;
          g.caixa(X, y - 15, W, 15, { color: C.verdeEsc });
          let x = X;
          cols.forEach((c, j) => { g.texto(c.titulo, x + PAD, y - 10, { f: B, tam: 6.4, cor: C.branco, w: largs[j] - 2 * PAD, alinhar: c.alinhar || 'esq' }); x += largs[j]; });
          y -= 15;
        };
        cab();
        itens.forEach((l, i) => {
          const cels = cols.map((c, j) => {
            const f = c.f || R;
            const v = c.valor(l, i);
            const w = largs[j] - 2 * PAD;
            return { c, f, w, ls: c.linhas > 1 ? quebrar(v, f, TAM, w, c.linhas, { grudarReais }) : [cortar(v, f, TAM, w)] };
          });
          const h = Math.max(...cels.map(z => z.ls.length)) * ENTRE + 4.4;
          if (!cabe(h)) { novaPagina(); cab(); }
          if (i % 2 === 1) g.caixa(X, y - h, W, h, { color: C.zebra });
          let x = X;
          cels.forEach(({ c, f, w, ls }, j) => {
            const alto = y - (h - ls.length * ENTRE) / 2 - 7.2;
            ls.forEach((s, k) => g.texto(s, x + PAD, alto - k * ENTRE, { f, tam: TAM, cor: c.cor || C.ink, w, alinhar: c.alinhar || 'esq' }));
            x += largs[j];
          });
          y -= h;
          g.linha(X, y, X + W, y, 0.5);
        });
        if (total) linhaTotal(total.rotulo, total.valor);
        y -= 8;
      },
      // Assinatura logo depois das tabelas (ou no topo da próxima página, se não couber). Sem nomes:
      // quem autoriza se identifica na assinatura eletrônica.
      assinatura(emitidoEm) {
        const hA = 16 * MM;
        if (y - hA - 6 < BASE) novaPagina();
        const xA = X + W * 0.47, wA = W * 0.53, yA = y - 6 - hA;
        g.caixa(xA, yA, wA, hA, { borderColor: C.verde, borderWidth: 0.8 });
        g.texto('ASSINATURA DO AUTORIZANTE DO PAGAMENTO', xA + 10, yA + hA - 12, { f: B, tam: 6.6, cor: C.verdeEsc });
        g.linha(xA + 10, yA + 12, xA + wA - 10, yA + 12, 0.7, C.ink);
        g.texto(`Emitido em ${dataBR(emitidoEm)}`, X, yA + 4, { tam: 7.2, cor: C.ink2, w: W * 0.44 });
      },
      // "Página 1 de 2" no pé, só quando há mais de uma.
      numerarPaginas() {
        if (paginas.length < 2) return;
        paginas.forEach((p, i) => p.texto(`Página ${i + 1} de ${paginas.length}`, X, BASE - 12, { tam: 7, cor: C.ink2, w: W, alinhar: 'dir' }));
      },
    };
  };

  const baixar = async nome => {
    const bytes = await doc.save();
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url; a.download = nome; a.hidden = true;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };

  return { R, B, C, cortar, quebrar, pagina, fluxo, baixar };
}
