// Comissões → Premiações: premiações de campanha e ajustes (com motivo) do mês, CLT e PJ.
// Os dois são lançamentos do mês por pessoa: premiação (valor positivo, campanha) e ajuste (+/−, motivo).
import { html, $, ao } from '../../lib/dom.js';
import { lerValor } from '../../lib/regras.js';
import { ROTULO_REGIME } from '../../lib/comissoes.js';
import { comissoes } from '../../dados/comissoes.js';
import { detalhar } from '../../dados/erros.js';
import { icone } from '../../ui/icones.js';
import { vazio } from '../../ui/pecas.js';
import { confirmar } from '../../ui/avisos.js';
import { campo, selecao, aplicarErros } from '../../ui/campos.js';
import { s, r$, mesMinusculo, ativos, fechado, avisoFechado, redesenhar, recalcular } from './comum.js';

const LANC = {
  premio: { tabela: 'premiacoes', texto: x => x.descricao, rotuloTexto: 'Campanha', titulo: 'Premiações do mês' },
  ajuste: { tabela: 'ajustes', texto: x => x.motivo, rotuloTexto: 'Motivo', titulo: 'Ajustes do mês' },
};

function tabelaLancamentos(tipo, lista, travado) {
  const k = LANC[tipo];
  const porId = new Map(comissoes.cadastro().map(c => [c.id, c]));
  const total = lista.reduce((t, x) => t + Number(x.valor), 0);
  const sinal = v => (tipo === 'ajuste' ? (v < 0 ? '−' : '+') : '') + r$(Math.abs(v));
  return html`<section aria-labelledby="cm-t-${tipo}">
    <h2 class="secao-titulo" id="cm-t-${tipo}">${k.titulo} <span class="contador-texto">${lista.length}</span></h2>
    <div class="tabela-caixa"><table class="tabela cm-tabela">
      <thead><tr><th scope="col">Quem recebe</th><th scope="col">${k.rotuloTexto}</th><th scope="col" class="num">Valor</th>${travado ? '' : html`<th scope="col"><span class="sr-only">Ações</span></th>`}</tr></thead>
      <tbody>${lista.map(x => { const c = porId.get(x.comissionado_id); return html`<tr>
        <td data-rotulo="Quem recebe" class="principal"><strong>${c?.nome || '—'}</strong><small class="cm-sub">${c ? ROTULO_REGIME[c.regime] : ''}</small></td>
        <td data-rotulo="${k.rotuloTexto}">${k.texto(x)}</td>
        <td data-rotulo="Valor" class="num tabular">${sinal(x.valor)}</td>
        ${travado ? '' : html`<td data-rotulo="" class="cm-acao"><button type="button" class="btn btn-texto btn-pequeno" data-remover="${tipo}:${x.id}" aria-label="Remover ${k.texto(x)} de ${c?.nome || ''}">${icone('lixeira')} Remover</button></td>`}
      </tr>`; })}</tbody>
      <tfoot><tr><th scope="row" colspan="2">Total</th><td class="num tabular cm-pagar">${sinal(total)}</td>${travado ? '' : html`<td></td>`}</tr></tfoot>
    </table></div></section>`;
}

export function desenhar() {
  const travado = fechado();
  const premios = comissoes.premiacoes(s.mes);
  const ajustes = comissoes.ajustes(s.mes);
  const pessoas = ativos().map(c => ({ valor: c.id, rotulo: `${c.nome} (${ROTULO_REGIME[c.regime]})` }));
  return html`
    ${travado ? avisoFechado() : html`<div class="cm-lancar">
      <form class="painel cm-premiar" id="cm-form-premio" novalidate aria-labelledby="cm-t-premio">
        <h2 class="painel-titulo" id="cm-t-premio">Lançar premiação de ${mesMinusculo(s.mes)}</h2>
        <div class="painel-corpo">
          ${selecao({ id: 'pr-pessoa', rotulo: 'Quem recebe', opcoes: pessoas, vazio: 'Escolha a pessoa', obrigatorio: true })}
          ${campo({ id: 'pr-desc', rotulo: 'Campanha', obrigatorio: true, atributos: { maxlength: 120, autocomplete: 'off' } })}
          ${campo({ id: 'pr-valor', rotulo: 'Valor', obrigatorio: true, mascara: 'valor' })}
          <div class="acoes acoes-fim"><button type="submit" class="btn btn-primario">${icone('mais')} Lançar premiação</button></div>
        </div>
      </form>
      <form class="painel cm-premiar" id="cm-form-ajuste" novalidate aria-labelledby="cm-t-ajuste">
        <h2 class="painel-titulo" id="cm-t-ajuste">Lançar ajuste</h2>
        <div class="painel-corpo">
          ${selecao({ id: 'aj-pessoa', rotulo: 'Quem recebe', opcoes: pessoas, vazio: 'Escolha a pessoa', obrigatorio: true })}
          ${campo({ id: 'aj-motivo', rotulo: 'Motivo', obrigatorio: true, dica: 'Entra depois do acordo mínimo e aparece no recibo.', atributos: { maxlength: 200, autocomplete: 'off' } })}
          <div class="cm-duas">
            ${selecao({ id: 'aj-tipo', rotulo: 'Tipo', obrigatorio: true, valor: 'desconto', vazio: 'Escolha', opcoes: [{ valor: 'desconto', rotulo: 'Desconto (−)' }, { valor: 'acrescimo', rotulo: 'Acréscimo (+)' }] })}
            ${campo({ id: 'aj-valor', rotulo: 'Valor', obrigatorio: true, mascara: 'valor' })}
          </div>
          <div class="acoes acoes-fim"><button type="submit" class="btn btn-fantasma">${icone('mais')} Lançar ajuste</button></div>
        </div>
      </form>
    </div>`}
    ${premios.length ? tabelaLancamentos('premio', premios, travado)
      : vazio({ icone: 'moeda', titulo: `Nenhuma premiação em ${mesMinusculo(s.mes)}`, texto: 'As premiações de campanha do mês entram no valor a pagar, no recibo e no Excel.' })}
    ${ajustes.length ? tabelaLancamentos('ajuste', ajustes, travado) : ''}`;
}

async function lancar(form, tipo) {
  const v = k => $(`#${k}`, form).value;
  const premio = tipo === 'premio';
  const p = premio ? 'pr' : 'aj';
  const texto = v(premio ? 'pr-desc' : 'aj-motivo').trim().replace(/\s+/g, ' ');
  const valor = lerValor(v(`${p}-valor`));
  const erros = {};
  if (!v(`${p}-pessoa`)) erros[`${p}-pessoa`] = 'Escolha quem recebe.';
  if (texto.length < (premio ? 2 : 3)) erros[premio ? 'pr-desc' : 'aj-motivo'] = premio ? 'Informe a campanha.' : 'Escreva o motivo (3 letras ou mais).';
  if (!(valor >= 0.01 && valor <= 1000000)) erros[`${p}-valor`] = 'Valor de R$ 0,01 a R$ 1.000.000,00.';
  if (Object.keys(erros).length) { aplicarErros(form, erros); return; }
  const botao = $('button[type="submit"]', form);
  botao.disabled = true; botao.setAttribute('aria-busy', 'true');
  const comissionado_id = v(`${p}-pessoa`);
  const c = comissoes.cadastro().find(x => String(x.id) === String(comissionado_id));
  try {
    if (premio) await comissoes.lancarPremiacao({ mes: s.mes, comissionado_id, descricao: texto, valor });
    else await comissoes.lancarAjuste({ mes: s.mes, comissionado_id, motivo: texto, valor: v('aj-tipo') === 'acrescimo' ? valor : -valor });
    await recalcular();
    s.ctx.toast(premio ? `Premiação de ${r$(valor)} lançada para ${c?.nome || ''}.` : `Ajuste de ${v('aj-tipo') === 'acrescimo' ? '+' : '−'}${r$(valor)} lançado para ${c?.nome || ''}.`, { tom: 'sucesso' });
    redesenhar();
    $(`#${p}-pessoa`, s.el)?.focus();
  } catch (e) {
    s.ctx.toast(detalhar(e).mensagem, { tom: 'erro' });
    botao.disabled = false; botao.removeAttribute('aria-busy');
  }
}

async function remover(chave) {
  const [tipo, id] = chave.split(':');
  const k = LANC[tipo];
  const x = (tipo === 'premio' ? comissoes.premiacoes(s.mes) : comissoes.ajustes(s.mes)).find(p => String(p.id) === id);
  if (!x) return;
  const ok = await confirmar({ titulo: `Remover ${k.texto(x)}?`, descricao: `${r$(Math.abs(x.valor))} deixam de entrar na comissão de ${mesMinusculo(s.mes)}. O lançamento fica no histórico de alterações.`, confirmar: 'Remover', perigo: true });
  if (!ok) return;
  try {
    if (tipo === 'premio') await comissoes.removerPremiacao(s.mes, x.id);
    else await comissoes.removerAjuste(s.mes, x.id);
    await recalcular();
    s.ctx.toast(tipo === 'premio' ? 'Premiação removida.' : 'Ajuste removido.', { tom: 'sucesso' });
    redesenhar();
  } catch (e) { s.ctx.toast(detalhar(e).mensagem, { tom: 'erro' }); }
}

export function ligar(el) {
  return [
    ao(el, 'submit', '#cm-form-premio', (e, f) => { e.preventDefault(); lancar(f, 'premio'); }),
    ao(el, 'submit', '#cm-form-ajuste', (e, f) => { e.preventDefault(); lancar(f, 'ajuste'); }),
    ao(el, 'click', '[data-remover]', (e, b) => remover(b.dataset.remover)),
  ];
}
