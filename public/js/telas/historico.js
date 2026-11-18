// ============================================================
//  HISTÓRICO — campanhas decididas, pela data da decisão.
//  Tabela no desktop, blocos no celular.
// ============================================================
import { html, pintar, $, ao, debounce } from '../lib/dom.js';
import { calc, brl, dataBR, contem, STATUS } from '../lib/regras.js';
import { icone } from '../ui/icones.js';
import { selo, vazio } from '../ui/pecas.js';
import { estadoLista } from '../ui/estado.js';

const PASSO = 40;
const filtros = { busca: '', status: 'Todas', limite: PASSO };
const OPCOES = [
  { valor: 'Todas', rotulo: 'Todas' },
  { valor: STATUS.APROVADA, rotulo: 'Aprovadas' },
  { valor: STATUS.REPROVADA, rotulo: 'Reprovadas' },
];

function decididas(ctx) {
  return ctx.campanhas.todas()
    .filter(c => c.status !== STATUS.PENDENTE)
    .sort((a, b) => String(b.data_decisao || '').localeCompare(String(a.data_decisao || ''))
      || String(b.criado_em).localeCompare(String(a.criado_em)));
}

function desenhar(el, ctx) {
  const base = decididas(ctx).filter(c => !filtros.busca ||
    contem(filtros.busca, `${c.cliente} ${c.campanha} ${c.laboratorio} ${c.codigo} ${c.aprovador_nome || ''} ${c.solicitante_nome || ''}`));
  const conta = s => (s === 'Todas' ? base.length : base.filter(c => c.status === s).length);
  const lista = base.filter(c => filtros.status === 'Todas' || c.status === filtros.status);
  const vis = lista.slice(0, filtros.limite);

  pintar($('#hs-status', el), html`${OPCOES.map(o => html`<button type="button" class="filtro" data-status="${o.valor}" aria-pressed="${filtros.status === o.valor}">${o.rotulo}<span class="n">${conta(o.valor)}</span></button>`)}`);
  const est = estadoLista({ carregado: ctx.campanhas.carregado, erro: ctx.campanhas.erro });
  if (est) { pintar($('#hs-resumo', el), ''); pintar($('#hs-itens', el), est); return; }
  pintar($('#hs-resumo', el), `${lista.length} ${lista.length === 1 ? 'decisão registrada' : 'decisões registradas'}`);
  pintar($('#hs-itens', el), lista.length ? html`
    <div class="tabela-caixa"><table class="tabela">
      <thead><tr><th scope="col">Decisão</th><th scope="col">Empresa</th><th scope="col">Campanha</th><th scope="col">Laboratório</th><th scope="col" class="num">Custo</th><th scope="col">Status</th><th scope="col">Decidida por</th></tr></thead>
      <tbody>${vis.map(c => html`<tr data-id="${c.id}">
        <td data-rotulo="Decisão" class="tabular">${dataBR(c.data_decisao)}</td>
        <td data-rotulo="Empresa" class="principal"><a href="#/campanhas/${c.id}">${c.cliente}</a></td>
        <td data-rotulo="Campanha">${c.campanha}</td>
        <td data-rotulo="Laboratório">${c.laboratorio}</td>
        <td data-rotulo="Custo" class="num">R$ ${brl(calc(c).total)}</td>
        <td data-rotulo="Status">${selo(c.status)}</td>
        <td data-rotulo="Decidida por">${c.aprovador_nome || '—'}</td>
      </tr>`)}</tbody>
    </table></div>
    ${lista.length > vis.length ? html`<button type="button" class="btn btn-fantasma btn-largo mais" id="hs-mais">Mostrar mais (${lista.length - vis.length} restantes)</button>` : ''}`
    : vazio({
        icone: 'historico',
        titulo: filtros.busca ? 'Nada encontrado' : 'Sem histórico ainda',
        texto: filtros.busca ? 'Tente outro nome ou código.' : 'Toda campanha aprovada ou reprovada fica arquivada aqui, para sempre.',
      }));
}

export function montar(el, ctx) {
  ctx.cabecalho({ titulo: 'Histórico' });
  pintar(el, html`
    <div class="ferramentas ferramentas-linha-larga">
      <div class="campo busca">
        <label class="so-leitor" for="hs-busca">Buscar no histórico</label>
        ${icone('busca')}
        <input id="hs-busca" type="search" value="${filtros.busca}" placeholder="Empresa, campanha, código ou aprovador" autocomplete="off">
      </div>
      <div class="filtros" id="hs-status" role="group" aria-label="Filtrar por decisão"></div>
    </div>
    <p class="lista-resumo" id="hs-resumo" role="status"></p>
    <div id="hs-itens"></div>`);

  const buscar = debounce(v => { filtros.busca = v; filtros.limite = PASSO; desenhar(el, ctx); }, 200);
  const desligar = [
    ao(el, 'input', '#hs-busca', (e, i) => buscar(i.value)),
    ao(el, 'click', '[data-status]', (e, b) => { filtros.status = b.dataset.status; filtros.limite = PASSO; desenhar(el, ctx); $(`[data-status="${b.dataset.status}"]`, el)?.focus(); }),
    ao(el, 'click', '#hs-mais', () => { filtros.limite += PASSO; desenhar(el, ctx); }),
    // Linha inteira clicável (o link da empresa continua sendo o caminho pelo teclado).
    ao(el, 'click', 'tr[data-id]', (e, tr) => { if (!e.target.closest('a')) ctx.navegar(`#/campanhas/${tr.dataset.id}`); }),
    ctx.campanhas.assinar(() => desenhar(el, ctx)),
    () => buscar.cancelar(),
  ];
  desenhar(el, ctx);
  return () => desligar.forEach(fn => fn());
}
