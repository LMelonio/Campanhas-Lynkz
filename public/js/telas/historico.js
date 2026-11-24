// ============================================================
//  HISTÓRICO — campanhas decididas, pela data da decisão.
//  Tabela a partir de 700 px; no celular, os mesmos cartões da lista de
//  Campanhas, com a data da decisão e quem decidiu no rodapé (v2.9).
// ============================================================
import { mostrarFiltroAtivo, html, pintar, $, ao, debounce } from '../lib/dom.js';
import { calc, brl, dataBR, contem, STATUS } from '../lib/regras.js';
import { icone } from '../ui/icones.js';
import { selo, vazio, cartao } from '../ui/pecas.js';
import { estadoLista } from '../ui/estado.js';
import { dialogoGerarAdp } from '../ui/adp-dialogo.js';
import { exportarExcel } from '../exportar.js';
import { campoBusca, ligarBusca } from '../ui/campos.js';

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

const buscadas = ctx => decididas(ctx).filter(c => !filtros.busca ||
  contem(filtros.busca, `${c.cliente} ${c.campanha} ${c.laboratorio} ${c.codigo} ${c.aprovador_nome || ''} ${c.solicitante_nome || ''}`));
const daTela = ctx => buscadas(ctx).filter(c => filtros.status === 'Todas' || c.status === filtros.status);

function desenhar(el, ctx) {
  const base = buscadas(ctx);
  const conta = s => (s === 'Todas' ? base.length : base.filter(c => c.status === s).length);
  const lista = daTela(ctx);
  const vis = lista.slice(0, filtros.limite);

  pintar($('#hs-status', el), html`${OPCOES.map(o => html`<button type="button" class="filtro" data-status="${o.valor}" aria-pressed="${filtros.status === o.valor}">${o.rotulo}<span class="n">${conta(o.valor)}</span></button>`)}`);
  mostrarFiltroAtivo($('#hs-status', el));
  const est = estadoLista({ carregado: ctx.campanhas.carregado, erro: ctx.campanhas.erro });
  if (est) { pintar($('#hs-resumo', el), ''); $('#hs-excel', el).hidden = true; pintar($('#hs-itens', el), est); return; }
  $('#hs-excel', el).hidden = !lista.length;
  pintar($('#hs-resumo', el), `${lista.length} ${lista.length === 1 ? 'decisão registrada' : 'decisões registradas'}`);
  pintar($('#hs-itens', el), lista.length ? html`
    <div class="tabela-caixa"><table class="tabela">
      <thead><tr><th scope="col">Decisão</th><th scope="col">Empresa</th><th scope="col">Campanha</th><th scope="col">Laboratório</th><th scope="col" class="num">Custo</th><th scope="col">Status</th><th scope="col">Decidida por</th></tr></thead>
      <tbody>${vis.map(c => html`<tr data-id="${c.id}">
        <td data-rotulo="Decisão" class="tabular">${dataBR(c.data_decisao)}</td>
        <td data-rotulo="Empresa" class="principal"><a href="#/campanhas/${c.id}">${c.cliente}</a></td>
        <td data-rotulo="Campanha">${c.campanha}${c.importada ? html` <small class="campo-dica">(importada)</small>` : ''}</td>
        <td data-rotulo="Laboratório">${c.laboratorio}</td>
        <td data-rotulo="Custo" class="num"><span class="valor">R$ ${brl(calc(c).total)}</span></td>
        <td data-rotulo="Status">${selo(c.status)}</td>
        <td data-rotulo="Decidida por">${c.aprovador_nome || '—'}</td>
      </tr>`)}</tbody>
    </table></div>
    <div class="hs-cartoes">${vis.map(c => cartao(c, { rodape: html`<span class="cartao-acoes-info">${icone('historico')} ${c.status === STATUS.APROVADA ? 'Aprovada' : 'Reprovada'} em ${dataBR(c.data_decisao)} · ${c.aprovador_nome || '—'}</span>` }))}</div>
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
      ${campoBusca({ id: 'hs-busca', rotulo: 'Buscar no histórico', valor: filtros.busca, placeholder: 'Buscar no histórico', dica: 'Procura empresa, campanha, código e quem aprovou ou reprovou.' })}
      <div class="filtros" id="hs-status" role="group" aria-label="Filtrar por decisão"></div>
    </div>
    <div class="lista-cabeca">
      <p class="lista-resumo" id="hs-resumo" role="status"></p>
      <div class="lista-acoes">
          <button type="button" class="btn btn-texto btn-pequeno" id="hs-excel" hidden>${icone('baixar')} Baixar Excel desta lista</button>
          <button type="button" class="btn btn-texto btn-pequeno" id="hs-adp">${icone('baixar')} Gerar ADP</button>
        </div>
    </div>
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
    ligarBusca(el),
    ao(el, 'click', '#hs-adp', () => dialogoGerarAdp(ctx)),
    ao(el, 'click', '#hs-excel', async (e, b) => {
      b.disabled = true; b.setAttribute('aria-busy', 'true');
      const nome = { Todas: 'Decididas', Aprovada: 'Aprovadas', Reprovada: 'Reprovadas' }[filtros.status];
      try {
        await exportarExcel(daTela(ctx), ctx.cadastros, { prefixo: `Campanhas_${nome}` });
        ctx.toast('Planilha gerada.', { tom: 'sucesso' });
      } catch (err) { ctx.toast(err.message, { tom: 'erro', duracao: 8000 }); }
      finally { b.disabled = false; b.removeAttribute('aria-busy'); }
    }),
  ];
  desenhar(el, ctx);
  return () => desligar.forEach(fn => fn());
}
