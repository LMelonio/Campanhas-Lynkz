// Comissões → Histórico: meses fechados (cópia do que foi pago). Abrir um mês leva à Apuração com a cópia.
import { html, ao } from '../../lib/dom.js';
import { dataBR } from '../../lib/regras.js';
import { rotuloMesComissao } from '../../lib/comissoes.js';
import { comissoes } from '../../dados/comissoes.js';
import { detalhar } from '../../dados/erros.js';
import { icone } from '../../ui/icones.js';
import { vazio, carregando } from '../../ui/pecas.js';
import { s, r$, redesenhar } from './comum.js';

export function desenhar() {
  if (!s.historico) {
    const meu = s;
    comissoes.historico().then(h => { if (s === meu) { s.historico = h; redesenhar(); } })
      .catch(e => { if (s === meu) { s.historico = []; s.ctx.toast(detalhar(e).mensagem, { tom: 'erro' }); redesenhar(); } });
    return carregando(2);
  }
  if (!s.historico.length) return vazio({ icone: 'historico', titulo: 'Nenhum mês fechado ainda', texto: 'Depois de gerar a ADP e os recibos, use "Fechar mês" na Apuração. O mês entra aqui com a cópia do que foi pago.' });
  return html`<div class="tabela-caixa"><table class="tabela cm-tabela">
    <thead><tr><th scope="col">Mês</th><th scope="col" class="num">CLT</th><th scope="col" class="num">PJ</th><th scope="col" class="num">Total</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead>
    <tbody>${s.historico.map(f => html`<tr>
      <td data-rotulo="Mês" class="principal"><strong>${rotuloMesComissao(f.mes)}</strong>
        <small class="cm-sub">${f.status === 'fechado' ? `Fechado em ${dataBR(f.fechado_em)}` : `Reaberto em ${dataBR(f.reaberto_em)}: ${f.motivo_reabertura || ''}`}</small></td>
      <td data-rotulo="CLT" class="num tabular">${r$(f.total_clt)}</td>
      <td data-rotulo="PJ" class="num tabular">${r$(f.total_pj)}</td>
      <td data-rotulo="Total" class="num tabular cm-pagar">${r$(f.total)}</td>
      <td data-rotulo="" class="cm-acao"><button type="button" class="btn btn-fantasma btn-pequeno" data-abrir-mes="${f.mes}" aria-label="Abrir ${rotuloMesComissao(f.mes)}">${icone('seta')} Abrir</button></td>
    </tr>`)}</tbody></table></div>`;
}

export function ligar(el) {
  return [ao(el, 'click', '[data-abrir-mes]', (e, b) => { s.aba = 'apuracao'; s.trocarMes(b.dataset.abrirMes); })];
}
