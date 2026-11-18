// ============================================================
//  PEÇAS — selo, régua de custo, cartão, vazio, carregando.
// ============================================================
import { html, bruto } from '../lib/dom.js';
import { calc, banda, posRegua, brl, pct, dataBR, ESCALA_REGUA, STATUS } from '../lib/regras.js';
import { icone } from './icones.js';

const C = window.CONFIG;
export const FAIXAS = { verde: C.FAIXA_VERDE, amarela: C.FAIXA_AMARELA };

const CLASSE_STATUS = {
  [STATUS.PENDENTE]: 'selo-pendente',
  [STATUS.APROVADA]: 'selo-aprovada',
  [STATUS.REPROVADA]: 'selo-reprovada',
};
const ICONE_STATUS = { [STATUS.PENDENTE]: 'historico', [STATUS.APROVADA]: 'check', [STATUS.REPROVADA]: 'x' };

export const selo = status => html`<span class="selo ${CLASSE_STATUS[status] || 'selo-neutro'}">${ICONE_STATUS[status] ? icone(ICONE_STATUS[status]) : ''}${status}</span>`;
export const seloNeutro = texto => html`<span class="selo selo-neutro">${texto}</span>`;

const largura = p => bruto(`style="width:${Math.max(0, Math.min(100, p)).toFixed(2)}%"`);
const esquerda = p => bruto(`style="left:${Math.max(0, Math.min(100, p)).toFixed(2)}%"`);

// Régua: composição do custo (LYNKZ + indústria + rebate) e o custo sobre a
// meta num trilho com as faixas do config.js. c = campanha (ou campos do form).
export function regua(c, { titulo = 'Custo total', compacta = false } = {}) {
  const k = calc(c);
  const b = banda(k.pctMeta, FAIXAS);
  const partes = [
    { cls: 'c-lynkz', rotulo: 'LYNKZ', v: k.invL },
    { cls: 'c-industria', rotulo: 'Indústria', v: k.invI },
    { cls: 'c-rebate', rotulo: 'Rebate', v: k.reb },
  ];
  const verde = posRegua(FAIXAS.verde), ambar = posRegua(FAIXAS.amarela);
  const textoMedidor = k.pctMeta == null ? 'Sem meta informada' : `${pct(k.pctMeta)} da meta — ${b.txt}`;

  return html`<div class="regua${compacta ? ' compacta' : ''}">
    <div class="regua-topo">
      <span class="regua-rotulo">${titulo}</span>
      <strong class="regua-total num-display"><small>R$ </small>${brl(k.total)}</strong>
    </div>
    ${k.total > 0 ? html`<div class="regua-comp" aria-hidden="true">
      ${partes.filter(p => p.v > 0).map(p => html`<i class="${p.cls}" ${largura(p.v / k.total * 100)}></i>`)}
    </div>` : ''}
    <ul class="regua-legenda">
      ${partes.map(p => html`<li><span class="legenda-ponto ${p.cls}" aria-hidden="true"></span>${p.rotulo} <b>R$ ${brl(p.v)}</b>${p.cls === 'c-rebate' && k.limitado ? html` <span class="tag-teto">no teto</span>` : ''}</li>`)}
    </ul>
    <div class="regua-meta">
      <div class="regua-meta-topo">
        <span>Custo sobre a meta${c.tipo_meta ? ` (${String(c.tipo_meta).toLowerCase()})` : ''}</span>
        <b class="num-display nivel-${b.nivel}">${k.pctMeta == null ? '—' : pct(k.pctMeta)}</b>
      </div>
      <div class="regua-trilho" role="meter" aria-label="Custo sobre a meta"
           aria-valuemin="0" aria-valuemax="${ESCALA_REGUA * 100}"
           aria-valuenow="${k.pctMeta == null ? 0 : Math.min(k.pctMeta, ESCALA_REGUA) * 100}"
           aria-valuetext="${textoMedidor}">
        <span class="faixa faixa-verde" ${largura(verde)}></span>
        <span class="faixa faixa-ambar" ${largura(ambar - verde)}></span>
        <span class="faixa faixa-vermelha" ${largura(100 - ambar)}></span>
        ${k.pctMeta != null ? html`<span class="regua-marca" ${esquerda(posRegua(k.pctMeta))}></span>` : ''}
      </div>
      <div class="regua-escala" aria-hidden="true">
        <span ${esquerda(0)}>0%</span>
        <span ${esquerda(verde)}>${pct(FAIXAS.verde, 0)}</span>
        <span ${esquerda(ambar)}>${pct(FAIXAS.amarela, 0)}</span>
        <span ${esquerda(100)}>${pct(ESCALA_REGUA, 0)}+</span>
      </div>
      <p class="regua-nota nivel-${b.nivel}">${b.nivel === 'vermelho' ? icone('alerta') : ''}${k.pctMeta == null ? 'Informe a meta do cliente para ver a faixa.' : b.txt[0].toUpperCase() + b.txt.slice(1)}</p>
    </div>
  </div>`;
}

// Mini régua do cartão.
export function miniRegua(c) {
  const k = calc(c), b = banda(k.pctMeta, FAIXAS);
  return html`<div class="mini nivel-${b.nivel}">
    <span class="mini-trilho" aria-hidden="true"><i class="nivel-${b.nivel}" ${largura(posRegua(k.pctMeta))}></i></span>
    <span>${k.pctMeta == null ? 'sem meta' : `${pct(k.pctMeta)} da meta`}</span>
  </div>`;
}

export function cartao(c, { ativo = false } = {}) {
  const k = calc(c);
  return html`<a class="cartao" href="#/campanhas/${c.id}" data-id="${c.id}"${ativo ? bruto(' aria-current="true"') : ''}>
    <div class="cartao-topo">
      <p class="cartao-nome">${c.cliente}</p>
      ${selo(c.status)}
    </div>
    <p class="cartao-sub">${c.campanha} · ${c.laboratorio}</p>
    ${miniRegua(c)}
    <div class="cartao-pe">
      <span class="cartao-valor num-display">R$ ${brl(k.total)}</span>
      <span class="cartao-quando">${icone('historico')}${dataBR(c.criado_em)} · ${c.codigo}</span>
    </div>
  </a>`;
}

export function vazio({ icone: ic = 'campanhas', titulo, texto = '', acao = null }) {
  return html`<div class="vazio">
    <span class="vazio-icone">${icone(ic)}</span>
    <p class="vazio-titulo">${titulo}</p>
    ${texto ? html`<p class="vazio-texto">${texto}</p>` : ''}
    ${acao ? html`<a class="btn btn-primario" href="${acao.href}">${acao.rotulo}</a>` : ''}
  </div>`;
}

export function carregando(n = 3) {
  return html`<div aria-busy="true" aria-label="Carregando">${Array.from({ length: n }, () => html`<div class="esqueleto"></div>`)}</div>`;
}
