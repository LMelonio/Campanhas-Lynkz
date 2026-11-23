// ============================================================
//  INÍCIO — fila do aprovador (ou as campanhas do coordenador em
//  análise), números do mês e as enviadas por último.
// ============================================================
import { html, pintar } from '../lib/dom.js';
import { calc, brl, brl0, dataCivil, hojeCivil, STATUS } from '../lib/regras.js';
import { icone } from '../ui/icones.js';
import { cartao, vazio } from '../ui/pecas.js';
import { estadoLista } from '../ui/estado.js';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function desenhar(el, ctx) {
  const est = estadoLista({ carregado: ctx.campanhas.carregado, erro: ctx.campanhas.erro });
  if (est) { pintar(el, est); return; }
  const todas = ctx.campanhas.todas();
  const eu = ctx.perfil.id;
  const filaTodas = ctx.campanhas.pendentes();
  const fila = ctx.ehAprovador ? filaTodas : filaTodas.filter(c => c.solicitante_id === eu);
  const valorFila = fila.reduce((s, c) => s + calc(c).total, 0);

  const mes = hojeCivil().slice(0, 7);
  const nomeMes = MESES[+mes.slice(5, 7) - 1];
  const aprovMes = todas.filter(c => c.status === STATUS.APROVADA && dataCivil(c.data_decisao).startsWith(mes));
  const custoMes = aprovMes.reduce((s, c) => s + calc(c).total, 0);
  const rebateMes = aprovMes.reduce((s, c) => s + calc(c).reb, 0);

  const recentes = (ctx.ehAprovador ? todas : todas.filter(c => c.solicitante_id === eu)).slice(0, 5);
  const primeiroNome = String(ctx.perfil.nome || '').split(/\s+/)[0];

  pintar(el, html`
    <p class="saudacao">Olá, ${primeiroNome}.</p>

    ${ctx.ehAprovador
      ? (fila.length
        ? html`<section class="destaque" aria-labelledby="fila-t">
            <p class="destaque-rotulo" id="fila-t">Aguardando sua decisão</p>
            <p class="destaque-valor num-display">${fila.length} ${fila.length === 1 ? 'campanha' : 'campanhas'}</p>
            <p class="destaque-custo"><span class="valor">R$ ${brl0(valorFila)}</span> em custo total</p>
            <p class="destaque-sub">A mais antiga é de ${fila[0].cliente}, enviada por ${fila[0].solicitante_nome || '—'}.</p>
            <a class="btn btn-primario" href="#/campanhas/${fila[0].id}">Revisar a mais antiga ${icone('seta')}</a>
          </section>`
        : html`<section class="destaque destaque-ok">
            <p class="destaque-rotulo">Fila limpa</p>
            <p class="destaque-valor">Nenhuma campanha esperando você</p>
            <a class="btn btn-fantasma" href="#/historico">Ver o histórico</a>
          </section>`)
      : html`<section class="destaque${fila.length ? '' : ' destaque-ok'}" aria-labelledby="fila-t">
          <p class="destaque-rotulo" id="fila-t">Suas campanhas em análise</p>
          <p class="destaque-valor num-display">${fila.length ? `${fila.length} ${fila.length === 1 ? 'campanha' : 'campanhas'}` : 'Nenhuma no momento'}</p>
          ${fila.length ? html`<p class="destaque-custo"><span class="valor">R$ ${brl0(valorFila)}</span> em custo total</p>` : ''}
          <div class="acoes">
            <a class="btn btn-primario" href="#/nova">${icone('mais')} Nova campanha</a>
            ${fila.length ? html`<a class="btn btn-fantasma" href="#/campanhas">Ver situação</a>` : ''}
          </div>
        </section>`}

    <h2 class="secao-titulo">Números de ${nomeMes}</h2>
    <ul class="numeros">
      ${[
        ['Aprovadas', `${aprovMes.length}`, '#/campanhas?status=Aprovada&mes=atual'],
        ['Custo aprovado', `R$ ${brl0(custoMes)}`, '#/campanhas?status=Aprovada&mes=atual'],
        ['Rebate comprometido', `R$ ${brl0(rebateMes)}`, '#/campanhas?status=Aprovada&mes=atual&rebate=1'],
        ['Pendentes', `${filaTodas.length}`, '#/campanhas?status=Pendente'],
      ].map(([rotulo, valor, href]) => html`<li><a class="numero numero-link" href="${href}">
        <span class="numero-rotulo">${rotulo}</span>
        <strong class="num-display valor">${valor}</strong>
        ${icone('seta')}</a></li>`)}
    </ul>
    <p class="secao-nota">Custo = verba LYNKZ + indústria + rebate estimado se o cliente bater a meta. Aprovadas pela data da decisão.</p>

    <div class="secao-cabeca">
      <h2 class="secao-titulo">${ctx.ehAprovador ? 'Enviadas por último' : 'Suas últimas campanhas'}</h2>
      ${recentes.length ? html`<a class="btn btn-texto" href="#/campanhas">Ver todas</a>` : ''}
    </div>
    ${recentes.length
      ? html`<div class="grade-cartoes">${recentes.map(c => cartao(c))}</div>`
      : vazio({ titulo: 'Nenhuma campanha ainda', texto: 'Cadastre a primeira e ela aparece aqui.', acao: { href: '#/nova', rotulo: 'Nova campanha' } })}
    <p class="secao-nota">Total no sistema: ${todas.length} ${todas.length === 1 ? 'campanha' : 'campanhas'} · R$ ${brl(todas.filter(c => c.status === STATUS.APROVADA).reduce((s, c) => s + calc(c).total, 0))} aprovados.</p>
  `);
}

export function montar(el, ctx) {
  ctx.cabecalho({ titulo: 'Início' });
  desenhar(el, ctx);
  // Atualização ao vivo: a tela não tem campo, pode redesenhar inteira.
  const desligar = ctx.campanhas.assinar(() => desenhar(el, ctx));
  return desligar;
}
