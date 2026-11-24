// ============================================================
//  DECISÃO — aprovar (com 5 s para desfazer) e reprovar (com motivo).
//  Usado pelo detalhe da campanha e pela lista de Campanhas (v2.9):
//  o mesmo comportamento nos dois lugares. Só há uma aprovação em espera
//  por vez; quem desenha botões assina para redesenhar quando ela muda.
// ============================================================
import { html, $, ao } from '../lib/dom.js';
import { calc, brl, STATUS } from '../lib/regras.js';
import { icone } from './icones.js';
import { abrirDialogo, erroNoDialogo } from './avisos.js';
import { areaTexto, aplicarErros } from './campos.js';

const ESPERA_APROVAR = 5000;
const MOTIVOS_RAPIDOS = window.CONFIG?.MOTIVOS_RAPIDOS || [];

let emEspera = null;   // { id, cliente, total, ctx, depois, desfeito, feito, timer, aviso }
const ouvintes = new Set();
const avisar = () => ouvintes.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });

// Quem desenha os botões de decisão redesenha quando a espera começa ou termina.
export function assinarDecisao(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }
export const aprovacaoEmEspera = () => emEspera;
export const esperandoAprovar = id => !!emEspera && String(emEspera.id) === String(id);

async function gravarAprovacao(e) {
  if (e.desfeito || e.feito) return;
  e.feito = true;
  clearTimeout(e.timer);
  e.aviso?.fechar('gravando');
  if (emEspera === e) emEspera = null;
  try {
    await e.ctx.campanhas.decidir(e.id, STATUS.APROVADA);
    e.ctx.toast(`Aprovada · ${e.cliente} · R$ ${brl(e.total)}`, { tom: 'sucesso' });
    e.depois?.(e);
  } catch (err) {
    e.ctx.toast(err.message, { tom: 'erro', duracao: 8000 });
  }
  avisar();
}

/**
 * Aprova com 5 s para desfazer (toast "Aprovando… · Desfazer").
 * depois(e): chamado quando a aprovação foi gravada (o detalhe abre a próxima pendente).
 */
export function aprovarComDesfazer(ctx, c, { depois = null } = {}) {
  if (c.status !== STATUS.PENDENTE) return;
  // Outra aprovação ainda esperando: grava aquela já e começa esta.
  if (emEspera && String(emEspera.id) !== String(c.id)) gravarAprovacao(emEspera);
  if (emEspera) return;
  // Estado novo a cada clique: um "Desfazer" antigo não vale para este.
  const e = { id: c.id, cliente: c.cliente, total: calc(c).total, ctx, depois, desfeito: false, feito: false, timer: null, aviso: null };
  emEspera = e;
  e.aviso = ctx.toast(`Aprovando ${c.cliente}…`, {
    acao: { rotulo: 'Desfazer', aoClicar: () => desfazerAprovacao(e) },
    duracao: ESPERA_APROVAR + 500,
  });
  e.timer = setTimeout(() => gravarAprovacao(e), ESPERA_APROVAR);
  avisar();
}

export function desfazerAprovacao(e = emEspera) {
  if (!e || e.feito || e.desfeito) return;
  e.desfeito = true;
  clearTimeout(e.timer);
  e.aviso?.fechar('desfeito');
  if (emEspera === e) emEspera = null;
  e.ctx.toast('Aprovação desfeita. A campanha continua pendente.');
  avisar();
}

/** Reprova com motivo obrigatório (motivos rápidos do config). depois(): chamado depois de gravar. */
export async function reprovarComMotivo(ctx, c, { depois = null } = {}) {
  if (c.status !== STATUS.PENDENTE) return;
  const corpoDlg = html`
    ${MOTIVOS_RAPIDOS.length ? html`<p class="campo-legenda" id="mr-rot">Motivos rápidos</p>
      <div class="chips" role="group" aria-labelledby="mr-rot">${MOTIVOS_RAPIDOS.map(m => html`<button type="button" class="chip" data-motivo="${m}">${m}</button>`)}</div>` : ''}
    ${areaTexto({ id: 'rp-motivo', rotulo: 'Motivo da reprova', obrigatorio: true, dica: 'O coordenador vai ler isso. Diga o que precisa mudar.', atributos: { maxlength: 1000 } })}`;
  let desligarChips = () => {};
  let reprovada = false;
  await abrirDialogo({
    titulo: 'Reprovar campanha',
    descricao: `${c.cliente} · ${c.campanha} · R$ ${brl(calc(c).total)}`,
    corpo: corpoDlg,
    acoes: [
      { rotulo: 'Voltar', valor: null, tipo: 'fantasma' },
      { rotulo: 'Reprovar', valor: 'reprovar', tipo: 'perigo', principal: true },
    ],
    aoAbrir: d => {
      desligarChips = ao(d, 'click', '[data-motivo]', (ev, b) => {
        const t = $('#rp-motivo', d);
        t.value = b.dataset.motivo;
        d.querySelectorAll('[data-motivo]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        aplicarErros(d, {});
        t.focus();
        t.setSelectionRange(t.value.length, t.value.length);
      });
    },
    antesDeFechar: async (_v, d) => {
      erroNoDialogo(d, '');
      const motivo = $('#rp-motivo', d).value.trim();
      if (!motivo) { aplicarErros(d, { 'rp-motivo': 'Escreva o motivo antes de reprovar.' }); return false; }
      try {
        await ctx.campanhas.decidir(c.id, STATUS.REPROVADA, motivo);
      } catch (err) { erroNoDialogo(d, err.message); return false; }
      reprovada = true;
      return true;
    },
  });
  desligarChips();
  if (reprovada) {
    ctx.toast(`Reprovada · ${c.cliente}`);
    depois?.();
    avisar();
  }
}

// Rodapé do cartão na lista (administrador, campanha Pendente): os dois botões, lado a lado.
// Custo e % da meta já estão no cartão (valor e mini régua), logo acima.
// Fora do link do cartão; alvo de 44 px. O nome acessível começa pelo texto visível (WCAG 2.5.3).
export function botoesDecisao(c) {
  if (esperandoAprovar(c.id)) {
    return html`<span class="cartao-acoes-info" role="status">${icone('historico')} Aprovando em instantes…</span>
      <button type="button" class="btn btn-fantasma" data-lista-desfazer aria-label="Desfazer aprovação de ${c.cliente}">Desfazer</button>`;
  }
  return html`<button type="button" class="btn btn-perigo" data-lista-reprovar="${c.id}" aria-label="Reprovar ${c.cliente}">${icone('x')} Reprovar</button>
    <button type="button" class="btn btn-primario" data-lista-aprovar="${c.id}" aria-label="Aprovar ${c.cliente}">${icone('check')} Aprovar</button>`;
}

// Se o app for para segundo plano durante a espera, grava já (não perde a aprovação).
document.addEventListener('visibilitychange', () => {
  if (document.hidden && emEspera) gravarAprovacao(emEspera);
});
