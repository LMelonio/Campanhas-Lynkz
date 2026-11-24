// ============================================================
//  ADP — AUTORIZAÇÃO DE PAGAMENTO das campanhas pagas pela Swile (PDF).
//  Uma página A4 deitada (mais páginas se a lista for grande):
//  cabeçalho com as logos, faixa com os dados fixos (empresa pagadora,
//  loja, departamento, forma, vencimento, total), tabela das campanhas,
//  tabela dos recebedores (com CPF, nascimento e e-mail) e o quadro da
//  assinatura, com margem livre em cima e embaixo para o carimbo do SignZoo.
//
//  A parte pura (quem entra, de quem são os dados, linhas) não toca no
//  navegador e tem teste em tests/adp.test.mjs. O PDF usa o pdf-lib
//  (public/vendor/, módulo ES), carregado só quando alguém gera a ADP.
// ============================================================
import { calc, dataCivil, dataBR, maskCPF, soDigitos, hojeCivil } from './lib/regras.js';
import { ErroApp } from './dados/erros.js';

// Textos fixos da ADP. Mudam no config.js (ADP: { ... }) sem mexer aqui.
const PADRAO = {
  EMPRESA_PAGADORA: 'LYNKZ DIST S.A - MATRIZ',
  LOJA: 'LYNKZ - MATRIZ',
  DEPARTAMENTO: 'COMERCIAL',
  FORMA: 'SWILE',
  TIPO_SEM_TIPO: 'PREMIAÇÃO CAMPANHA',
};
export const textosAdp = () => ({ ...PADRAO, ...(globalThis.CONFIG?.ADP || {}) });

export const MESES = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];

// "2026-10" → "OUTUBRO 2026".
export function rotuloMes(mes) {
  const [a, m] = String(mes).split('-').map(Number);
  return MESES[m - 1] ? `${MESES[m - 1]} ${a}` : '';
}

// Mês de referência da campanha: o mês em que terminou (é quando se apura e paga).
// Sem data de fim, o mês da aprovação.
export const mesDaCampanha = c => dataCivil(c.data_fim || c.data_decisao).slice(0, 7);

export const entraNaAdp = c => c.status === 'Aprovada' && c.forma_pagamento === 'Swile';

// Meses com campanhas para a ADP, do mais recente para o mais antigo: [{ mes, total }].
export function mesesAdp(campanhas) {
  const conta = new Map();
  for (const c of campanhas) {
    if (!entraNaAdp(c)) continue;
    const m = mesDaCampanha(c);
    if (m) conta.set(m, (conta.get(m) || 0) + 1);
  }
  return [...conta].map(([mes, total]) => ({ mes, total })).sort((a, b) => b.mes.localeCompare(a.mes));
}

// Mês sugerido ao abrir: o mês passado (o que costuma ser pago agora), se tiver campanha;
// senão o mais recente que tiver.
export function mesSugerido(meses, hoje) {
  const [a, m] = String(hoje).split('-').map(Number);
  const passado = m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
  return meses.some(x => x.mes === passado) ? passado : meses[0]?.mes || '';
}

// Quem recebe: os dados Swile gravados na campanha (aprovador e quem pediu enxergam);
// senão o cadastro do balconista (todos enxergam). Sem nenhum dos dois → null.
export function recebedorAdp(c, cad) {
  if (c.swile_visivel !== false && c.swile_nome_completo) {
    return { nome: c.swile_nome_completo, cpf: c.swile_cpf, email: c.swile_email, nascimento: c.swile_data_nascimento, origem: 'campanha' };
  }
  const b = c.balconista_id ? cad.balconista(c.balconista_id) : null;
  if (b) return { nome: b.nome_completo, cpf: b.cpf, email: b.email, nascimento: b.data_nascimento, origem: 'cadastro' };
  return null;
}

// Campanhas do mês para o diálogo: { c, recebedor, valor, motivo }. motivo ≠ '' → não pode entrar (fica no fim).
export function itensAdp(campanhas, cad, mes) {
  return campanhas
    .filter(c => entraNaAdp(c) && mesDaCampanha(c) === mes)
    .sort((a, b) => String(a.cliente).localeCompare(String(b.cliente), 'pt-BR') || String(a.codigo).localeCompare(String(b.codigo)))
    .map(c => {
      const recebedor = recebedorAdp(c, cad);
      return {
        c, recebedor,
        valor: calc(c).invL,
        motivo: recebedor ? '' : 'Os dados de quem recebe ficam visíveis só para o Administrador e para quem pediu a campanha.',
      };
    })
    .sort((a, b) => Number(!!a.motivo) - Number(!!b.motivo));
}

// Texto inicial de cada linha da ADP (o diálogo deixa editar tudo antes de gerar).
export function linhaAdp({ c, recebedor, valor }) {
  const t = textosAdp();
  return {
    cliente: String(c.cliente || '').toUpperCase(),
    tipo: c.tipo || t.TIPO_SEM_TIPO,
    observacao: String(c.mecanica || '').trim() || c.campanha || '',
    favorecido: recebedor.nome || '',
    cpf: soDigitos(recebedor.cpf).length === 11 ? maskCPF(recebedor.cpf) : String(recebedor.cpf || ''),
    email: recebedor.email || '',
    nascimento: dataCivil(recebedor.nascimento) || '',
    valor: Math.round((+valor || 0) * 100) / 100,
  };
}

export const nomeArquivoAdp = mes => `ADP - CAMPANHAS - ${rotuloMes(mes)}.pdf`;
export const totalAdp = linhas => Math.round(linhas.reduce((s, l) => s + (+l.valor || 0), 0) * 100) / 100;
const reais = n => 'R$ ' + (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// As fontes padrão do PDF (Helvetica) só têm o alfabeto latino (WinAnsi):
// troca o que não cabe (aspas curvas, traços, emoji…) por um equivalente.
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
export function textoPdf(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim()
    .replace(/[\u2010-\u2012\u2212]/g, '-')
    .replace(/[^\u0020-\u007E\u00A0-\u00FF]/gu, ch => (WIN_ANSI_EXTRA.has(ch) ? ch : '?'));
}

// ---------------- PDF (navegador) ----------------
const PDFLIB = new URL('../vendor/pdf-lib-1.17.1.min.js', import.meta.url).href;
const LOGOS = {
  lynkz: new URL('../assets/adp-logo-lynkz.png', import.meta.url).href,
  terrazoo: new URL('../assets/adp-logo-terrazoo.png', import.meta.url).href,
};

async function bytesDe(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return new Uint8Array(await r.arrayBuffer());
}

// Medidas em pontos (1 mm = 2,835 pt). A4 deitada.
const MM = 2.835;
const PAG = { l: 841.89, a: 595.28, x: 13 * MM, topo: 14 * MM, base: 11 * MM };

// linhas: [{ cliente, tipo, observacao, favorecido, cpf, email, nascimento, valor }] já conferidas.
// opcoes: { mes: '2026-10', vencimento: '2026-11-06', emitidoEm }
// Sem nomes no PDF: quem autoriza se identifica na assinatura (SignZoo).
export async function gerarAdp(linhas, { mes, vencimento, emitidoEm = hojeCivil() }) {
  if (!linhas.length) throw new ErroApp('Marque pelo menos uma campanha para a ADP.');
  let L;
  try { L = await import(PDFLIB); }
  catch { throw new ErroApp('A biblioteca do PDF não carregou. Confira a internet e tente de novo.'); }
  const { PDFDocument, StandardFonts, rgb } = L;
  const cor = hex => rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
  const C = {
    verde: cor('#2E8B57'), verdeEsc: cor('#1F6B42'), verdeCl: cor('#EAF5EE'), verdeTx: cor('#D7EFE0'),
    ink: cor('#1B1E22'), ink2: cor('#555D66'), linha: cor('#DCE1E5'), zebra: cor('#F7F9FA'), branco: rgb(1, 1, 1),
  };
  const t = textosAdp();
  const doc = await PDFDocument.create();
  doc.setTitle(nomeArquivoAdp(mes).replace(/\.pdf$/, ''));
  doc.setAuthor('LYNKZ Campanhas');
  doc.setCreator('LYNKZ Campanhas');
  const R = await doc.embedFont(StandardFonts.Helvetica);
  const B = await doc.embedFont(StandardFonts.HelveticaBold);
  let logos = null;
  try {
    const [a, b] = await Promise.all([bytesDe(LOGOS.lynkz), bytesDe(LOGOS.terrazoo)]);
    logos = { lynkz: await doc.embedPng(a), terrazoo: await doc.embedPng(b) };
  } catch (e) { console.warn('Logos da ADP não carregaram', e); }

  // ---- ferramentas de texto ----
  const larg = (s, f, tam) => f.widthOfTextAtSize(s, tam);
  const cortar = (s, f, tam, w) => {
    s = textoPdf(s);
    if (larg(s, f, tam) <= w) return s;
    while (s.length > 1 && larg(s + '…', f, tam) > w) s = s.slice(0, -1);
    return s.trimEnd() + '…';
  };
  // Quebra em linhas que cabem em w; no máximo max linhas (a última com reticências se sobrar).
  const quebrar = (s, f, tam, w, max = 3) => {
    const palavras = textoPdf(s).split(' ').filter(Boolean);
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

  // ---- páginas ----
  let pag, y;
  const paginas = [];
  const novaPagina = () => {
    pag = doc.addPage([PAG.l, PAG.a]);
    paginas.push(pag);
    y = PAG.a - PAG.topo;
  };
  const largura = PAG.l - 2 * PAG.x;
  const texto = (s, x, yy, { f = R, tam = 8.2, cor: c = C.ink, w = null, alinhar = 'esq' } = {}) => {
    const v = w ? cortar(s, f, tam, w) : textoPdf(s);
    let xx = x;
    if (alinhar === 'dir') xx = x + (w ?? 0) - larg(v, f, tam);
    else if (alinhar === 'centro') xx = x + ((w ?? 0) - larg(v, f, tam)) / 2;
    pag.drawText(v, { x: xx, y: yy, size: tam, font: f, color: c });
  };
  const caixa = (x, yy, w, h, opc) => pag.drawRectangle({ x, y: yy, width: w, height: h, ...opc });

  const cabecalho = () => {
    const h = 30;
    if (logos) {
      const lz = logos.lynkz.scaleToFit(70, 23);
      pag.drawImage(logos.lynkz, { x: PAG.x, y: y - h / 2 - lz.height / 2, ...lz });
      const tz = logos.terrazoo.scaleToFit(30, 29);
      pag.drawImage(logos.terrazoo, { x: PAG.x + largura - tz.width, y: y - h / 2 - tz.height / 2, ...tz });
    }
    texto('AUTORIZAÇÃO DE PAGAMENTO', PAG.x, y - 14, { f: B, tam: 15.5, w: largura, alinhar: 'centro' });
    texto(`CAMPANHAS  ·  ${rotuloMes(mes)}`, PAG.x, y - 29, { tam: 9.5, cor: C.ink2, w: largura, alinhar: 'centro' });
    y -= h + 6;
    pag.drawLine({ start: { x: PAG.x, y }, end: { x: PAG.x + largura, y }, thickness: 1.4, color: C.verde });
    y -= 7;
  };

  const total = totalAdp(linhas);
  const faixa = () => {
    const h = 29;
    const cel = [
      ['EMPRESA PAGADORA', t.EMPRESA_PAGADORA, 1.35], ['LOJA', t.LOJA, 1], ['DEPARTAMENTO', t.DEPARTAMENTO, 1],
      ['FORMA DE PAGAMENTO', t.FORMA, 1], ['VENCIMENTO', dataBR(vencimento), 1],
      [`TOTAL A PAGAR · ${linhas.length} ${linhas.length === 1 ? 'CRÉDITO' : 'CRÉDITOS'}`, reais(total), 1.25],
    ];
    const soma = cel.reduce((s, c) => s + c[2], 0);
    let x = PAG.x;
    cel.forEach(([rot, val, peso], i) => {
      const w = (largura * peso) / soma;
      const ultima = i === cel.length - 1;
      if (ultima) caixa(x, y - h, w, h, { color: C.verde });
      texto(rot, x + 8, y - 10, { tam: 6.4, cor: ultima ? C.verdeTx : C.ink2, w: w - 14 });
      texto(val, x + 8, y - 23, { f: B, tam: ultima ? 11.5 : 9, cor: ultima ? C.branco : C.ink, w: w - 14 });
      if (!ultima) pag.drawLine({ start: { x: x + w, y }, end: { x: x + w, y: y - h }, thickness: 0.6, color: C.linha });
      x += w;
    });
    caixa(PAG.x, y - h, largura, h, { borderColor: C.linha, borderWidth: 0.6 });
    y -= h + 8;
  };

  // Tabela genérica: cols [{ titulo, w (0 = o que sobrar), alinhar, f, cor, valor(l, i), linhas: máx de linhas }].
  const tabela = (titulo, cols, itens, rodapeTabela = null) => {
    const fixa = cols.reduce((s, c) => s + (c.w || 0), 0);
    const livres = cols.filter(c => !c.w).length;
    cols.forEach(c => { c.larg = c.w || (largura - fixa) / livres; });
    const PAD = 6, TAM = 8, ENTRE = 9.6;
    const cabTabela = () => {
      texto(titulo, PAG.x, y - 7, { f: B, tam: 7.4, cor: C.verdeEsc });
      y -= 12;
      const h = 15;
      caixa(PAG.x, y - h, largura, h, { color: C.verdeEsc });
      let x = PAG.x;
      cols.forEach(c => {
        texto(c.titulo, x + PAD, y - 10, { f: B, tam: 6.4, cor: C.branco, w: c.larg - 2 * PAD, alinhar: c.alinhar || 'esq' });
        x += c.larg;
      });
      y -= h;
    };
    cabTabela();
    itens.forEach((l, i) => {
      const celulas = cols.map(c => {
        const f = c.f || R;
        const v = c.valor(l, i);
        return { c, f, linhas: c.linhas > 1 ? quebrar(v, f, TAM, c.larg - 2 * PAD, c.linhas) : [cortar(v, f, TAM, c.larg - 2 * PAD)] };
      });
      const n = Math.max(...celulas.map(x => x.linhas.length));
      const h = n * ENTRE + 4.4;
      if (y - h < PAG.base + 8) { novaPagina(); cabTabela(); }
      if (i % 2 === 1) caixa(PAG.x, y - h, largura, h, { color: C.zebra });
      let x = PAG.x;
      celulas.forEach(({ c, f, linhas: ls }) => {
        const topo = y - (h - ls.length * ENTRE) / 2 - 7.2;
        ls.forEach((s, k) => texto(s, x + PAD, topo - k * ENTRE, { f, tam: TAM, cor: c.cor || C.ink, w: c.larg - 2 * PAD, alinhar: c.alinhar || 'esq' }));
        x += c.larg;
      });
      y -= h;
      pag.drawLine({ start: { x: PAG.x, y }, end: { x: PAG.x + largura, y }, thickness: 0.5, color: C.linha });
    });
    if (rodapeTabela) rodapeTabela();
    y -= 8;
  };

  novaPagina();
  cabecalho();
  faixa();

  tabela('CAMPANHAS', [
    { titulo: 'ITEM', w: 28, alinhar: 'centro', f: B, cor: C.ink2, valor: (l, i) => String(i + 1) },
    { titulo: 'CLIENTE', w: 196, f: B, linhas: 2, valor: l => l.cliente },
    { titulo: 'TIPO', w: 112, cor: C.ink2, linhas: 2, valor: l => l.tipo },
    { titulo: 'OBSERVAÇÃO AO FISCAL - CAMPANHA E RECEBEDOR', w: 0, linhas: 3, valor: l => l.observacao },
    { titulo: 'VALOR', w: 72, alinhar: 'dir', f: B, valor: l => reais(l.valor) },
  ], linhas, () => {
    const h = 17;
    if (y - h < PAG.base + 8) novaPagina();
    caixa(PAG.x, y - h, largura, h, { color: C.verdeCl });
    pag.drawLine({ start: { x: PAG.x, y }, end: { x: PAG.x + largura, y }, thickness: 1, color: C.verde });
    texto('TOTAL GERAL DA CAMPANHA', PAG.x + 6, y - 11.5, { f: B, tam: 8.2 });
    texto(reais(total), PAG.x, y - 12, { f: B, tam: 10.5, cor: C.verdeEsc, w: largura - 6, alinhar: 'dir' });
    y -= h;
  });

  tabela('DADOS DOS RECEBEDORES', [
    { titulo: 'ITEM', w: 28, alinhar: 'centro', f: B, cor: C.ink2, valor: (l, i) => String(i + 1) },
    { titulo: 'EMPRESA PAGADORA', w: 112, valor: () => t.EMPRESA_PAGADORA },
    { titulo: 'FAVORECIDO', w: 158, f: B, valor: l => l.favorecido },
    { titulo: 'FORMA', w: 46, valor: () => t.FORMA },
    { titulo: 'CPF', w: 78, alinhar: 'centro', valor: l => l.cpf },
    { titulo: 'NASCIMENTO', w: 62, alinhar: 'centro', valor: l => (l.nascimento ? dataBR(l.nascimento) : '') },
    { titulo: 'E-MAIL DO RECEBEDOR SWILE', w: 0, valor: l => l.email },
    { titulo: 'R$', w: 72, alinhar: 'dir', f: B, valor: l => reais(l.valor) },
  ], linhas);

  // Assinatura logo depois das tabelas (ou no topo da próxima página, se não couber).
  const hA = 16 * MM;
  if (y - hA - 6 < PAG.base) novaPagina();
  const xA = PAG.x + largura * 0.47, wA = largura * 0.53, yA = y - 6 - hA;
  caixa(xA, yA, wA, hA, { borderColor: C.verde, borderWidth: 0.8 });
  texto('ASSINATURA DO AUTORIZANTE DO PAGAMENTO', xA + 10, yA + hA - 12, { f: B, tam: 6.6, cor: C.verdeEsc });
  pag.drawLine({ start: { x: xA + 10, y: yA + 12 }, end: { x: xA + wA - 10, y: yA + 12 }, thickness: 0.7, color: C.ink });
  texto(`Emitido em ${dataBR(emitidoEm)}`, PAG.x, yA + 4, { tam: 7.2, cor: C.ink2, w: largura * 0.44 });

  if (paginas.length > 1) {
    paginas.forEach((p, i) => p.drawText(`Página ${i + 1} de ${paginas.length}`, {
      x: PAG.l - PAG.x - R.widthOfTextAtSize(`Página ${i + 1} de ${paginas.length}`, 7), y: PAG.base - 12, size: 7, font: R, color: C.ink2 }));
  }

  const bytes = await doc.save();
  baixar(new Blob([bytes], { type: 'application/pdf' }), nomeArquivoAdp(mes));
  return { total, quantidade: linhas.length, paginas: paginas.length };
}

function baixar(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nome; a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
