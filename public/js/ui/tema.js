// Tema da interface: automático (segue o aparelho), claro, escuro ou daltônico. Salvo no aparelho.
import { armazenamento } from '../lib/dom.js';

const CHAVE = 'lynkz_tema';
export const TEMAS = Object.freeze([
  { valor: 'auto', rotulo: 'Automático', dica: 'Segue o claro ou escuro do aparelho', ico: 'auto' },
  { valor: 'claro', rotulo: 'Claro', dica: 'Fundo claro', ico: 'sol' },
  { valor: 'escuro', rotulo: 'Escuro', dica: 'Fundo escuro, para pouca luz', ico: 'lua' },
  { valor: 'daltonico', rotulo: 'Daltônico', dica: 'Azul e laranja no lugar de verde e vermelho', ico: 'olho' },
]);
const CICLO = ['claro', 'escuro', 'daltonico'];
const sistema = matchMedia('(prefers-color-scheme: dark)');
const ouvintes = new Set();

export const temaEscolhido = () => {
  const t = armazenamento.ler(CHAVE);
  return TEMAS.some(x => x.valor === t) ? t : 'auto';
};
export const temaAplicado = () => document.documentElement.dataset.tema;

function aplicar() {
  const e = temaEscolhido();
  const t = e === 'auto' ? (sistema.matches ? 'escuro' : 'claro') : e;
  document.documentElement.dataset.tema = t;
  const cor = getComputedStyle(document.documentElement).getPropertyValue('--card').trim();
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', cor));
  ouvintes.forEach(fn => fn(t, e));
}

export function escolherTema(valor) {
  armazenamento.gravar(CHAVE, valor);
  aplicar();
}

// Próximo tema do botão da barra lateral: claro → escuro → daltônico → claro.
export const proximoTema = () => CICLO[(CICLO.indexOf(temaAplicado()) + 1) % CICLO.length];
export const rotuloTema = valor => TEMAS.find(t => t.valor === valor)?.rotulo || valor;

export function aoMudarTema(fn) {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

sistema.addEventListener('change', () => { if (temaEscolhido() === 'auto') aplicar(); });
aplicar();
