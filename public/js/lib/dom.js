// ============================================================
//  DOM — o único jeito de montar HTML no app.
//  html`...` escapa TODA interpolação, exceto outro html`` ou bruto().
//  Proibido montar HTML com concatenação de string.
// ============================================================

class Html {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

function render(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Html) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}

export function html(partes, ...valores) {
  let out = partes[0];
  for (let i = 0; i < valores.length; i++) out += render(valores[i]) + partes[i + 1];
  return new Html(out);
}

// Conteúdo já confiável (ícones SVG fixos do próprio código). Nunca dado do banco.
export const bruto = s => new Html(String(s));

// Atributos a partir de um objeto: { min: '2026-01-01', disabled: true } → ' min="…" disabled'.
export function atributos(obj = {}) {
  let s = '';
  for (const [k, v] of Object.entries(obj)) {
    if (v === false || v === null || v === undefined) continue;
    s += v === true ? ` ${esc(k)}` : ` ${esc(k)}="${esc(v)}"`;
  }
  return new Html(s);
}

// Filtros segmentados que rolam de lado no celular: traz o ativo para a vista (só a rolagem do grupo, v2.9).
export function mostrarFiltroAtivo(grupo) {
  const b = grupo?.querySelector('[aria-pressed="true"]');
  if (!b || grupo.scrollWidth <= grupo.clientWidth) return;
  const g = grupo.getBoundingClientRect(), r = b.getBoundingClientRect();
  if (r.left < g.left) grupo.scrollLeft -= g.left - r.left + 8;
  else if (r.right > g.right) grupo.scrollLeft += r.right - g.right + 8;
}

export function pintar(el, conteudo) {
  el.innerHTML = conteudo instanceof Html ? conteudo.s : esc(conteudo);
}

export const $  = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));

// Delegação: um ouvinte na raiz para todos os elementos que casam com o seletor.
// Devolve a função que desliga o ouvinte.
export function ao(raiz, evento, seletor, fn, opcoes) {
  const h = e => {
    const alvo = e.target instanceof Element ? e.target.closest(seletor) : null;
    if (alvo && raiz.contains(alvo)) fn(e, alvo);
  };
  raiz.addEventListener(evento, h, opcoes);
  return () => raiz.removeEventListener(evento, h, opcoes);
}

// debounce(fn, ms) → função atrasada, com .agora() (roda já o pendente) e .cancelar().
export function debounce(fn, ms) {
  let timer = null, args = null;
  const atrasada = (...a) => {
    args = a;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, ms);
  };
  atrasada.agora = () => { if (timer) { clearTimeout(timer); timer = null; fn(...args); } };
  atrasada.cancelar = () => { clearTimeout(timer); timer = null; };
  return atrasada;
}

// localStorage que nunca derruba o app (aba anônima, cota cheia, bloqueio).
export const armazenamento = {
  ler(chave, padrao = null) {
    try { const v = localStorage.getItem(chave); return v === null ? padrao : JSON.parse(v); }
    catch { return padrao; }
  },
  gravar(chave, valor) {
    try { localStorage.setItem(chave, JSON.stringify(valor)); return true; }
    catch { return false; }
  },
  remover(chave) {
    try { localStorage.removeItem(chave); } catch { /* sem armazenamento */ }
  },
};
