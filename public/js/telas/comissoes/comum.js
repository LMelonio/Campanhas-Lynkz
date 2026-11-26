// Comissões: o estado da tela (um lugar só) e o que todas as abas usam.
// `s` é uma ligação viva: index.js troca o estado ao montar e ao desmontar, e as abas sempre veem o atual.
// Uma tarefa assíncrona guarda `const meu = s` e confere `s === meu` antes de mexer na tela.
import { html } from '../../lib/dom.js';
import { brl, dataBR, horaBR } from '../../lib/regras.js';
import { rotuloMesComissao } from '../../lib/comissoes.js';
import { comissoes } from '../../dados/comissoes.js';
import { detalhar } from '../../dados/erros.js';
import { icone } from '../../ui/icones.js';

// { el, ctx, aba, pronto, erro, mes, resultado, buscando, erroQlik, busca, inativos, gerando, lote, historico,
//   desligar[], pintar(), trocarMes(mes) }
export let s = null;
export const iniciar = novo => { s = novo; return novo; };
export const encerrar = meu => { if (s === meu) s = null; };

export const r$ = n => `R$ ${brl(n)}`;
export const pctTxt = n => `${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
export const pct1 = n => (n == null ? '—' : `${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
export const valorPct = n => (n == null || n === '' ? '' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
export const mesMinusculo = mes => rotuloMesComissao(mes).replace(/^\S+/, m => m.toLowerCase());
export const ativos = () => comissoes.cadastro().filter(c => c.ativo !== false);
export const fechado = () => comissoes.fechado(s.mes);
export const quemFechou = f => `${dataBR(f.fechado_em)} às ${horaBR(f.fechado_em)}`;
export const avisoFechado = () => html`<p class="nota cm-fechado">${icone('cadeado')}<span>${mesMinusculo(s.mes).replace(/^./, c => c.toUpperCase())} está fechado e no histórico
  (fechado em ${quemFechou(comissoes.fechamento(s.mes))}). Para mudar, reabra o mês na Apuração.</span></p>`;
export const sufixo = html`<span class="cm-sufixo" aria-hidden="true">%</span>`;

// Redesenha a tela inteira (a casca fica em index.js).
export const redesenhar = () => s?.pintar();

// Recalcula com a consulta já feita (depois de mexer no cadastro, nas premiações ou no contrato).
export async function recalcular() {
  if (!s.resultado) return;
  s.resultado = await comissoes.apurar(s.mes, { buscar: false });
}

// Uma tarefa por vez nos botões do mês (documentos, fechar, lote): os outros ficam desligados enquanto isso.
export async function ocupar(tipo, fn) {
  if (s.gerando) return;
  const meu = s;
  s.gerando = tipo; redesenhar();
  try { await fn(); }
  catch (e) { if (e?.name !== 'AbortError') meu.ctx.toast(detalhar(e).mensagem, { tom: 'erro', duracao: 7000 }); }
  finally { if (s === meu) { s.gerando = null; redesenhar(); } }
}
