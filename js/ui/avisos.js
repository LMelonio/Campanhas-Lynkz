// ============================================================
//  AVISOS — toast (com ação opcional) e diálogo nativo <dialog>.
// ============================================================
import { html, pintar, $ } from '../lib/dom.js';
import { icone } from './icones.js';

function regiao() {
  let r = document.getElementById('avisos');
  if (!r) {
    r = document.createElement('div');
    r.id = 'avisos';
    document.body.append(r);
  }
  r.className = 'avisos';
  r.setAttribute('role', 'status');
  r.setAttribute('aria-live', 'polite');
  return r;
}

// toast('Enviada.', { acao: { rotulo: 'Desfazer', aoClicar }, duracao: 5000, tom: 'sucesso' | 'erro', aoFechar })
// Devolve { fechar() }.
export function toast(msg, { acao = null, duracao = 4000, tom = '', aoFechar = null } = {}) {
  const r = regiao();
  const el = document.createElement('div');
  el.className = 'toast' + (tom ? ' toast-' + tom : '');
  pintar(el, html`<span>${msg}</span>
    ${acao ? html`<button type="button" class="toast-acao">${acao.rotulo}</button>` : ''}
    <button type="button" class="btn-icone toast-fechar" aria-label="Fechar aviso">${icone('x')}</button>`);
  if (tom === 'erro') el.setAttribute('role', 'alert');

  let fechado = false, timer = null;
  const fechar = (motivo = 'tempo') => {
    if (fechado) return;
    fechado = true;
    clearTimeout(timer);
    el.remove();
    if (aoFechar) aoFechar(motivo);
  };
  if (acao) $('.toast-acao', el).addEventListener('click', () => { acao.aoClicar?.(); fechar('acao'); });
  $('.toast-fechar', el).addEventListener('click', () => fechar('fechar'));
  // Mais de 3 avisos: some o mais antigo.
  while (r.children.length >= 3) r.firstElementChild.remove();
  r.append(el);
  if (duracao > 0) timer = setTimeout(() => fechar('tempo'), duracao);
  return { fechar, el };
}

// abrirDialogo({
//   titulo, descricao, corpo: html``,
//   acoes: [{ rotulo, valor, tipo: 'primario'|'fantasma'|'perigo', principal: true }],
//   aoAbrir(dialogo), antesDeFechar(valor, dialogo) → false | Promise<false> mantém aberto
// }) → Promise<valor | null>   (null = cancelado por Esc, fundo ou fechar)
export function abrirDialogo({ titulo, descricao = '', corpo = '', acoes = [], aoAbrir = null, antesDeFechar = null }) {
  return new Promise(resolve => {
    const anterior = document.activeElement;
    const d = document.createElement('dialog');
    d.className = 'dialogo';
    const idT = 'dlg-t-' + Math.random().toString(36).slice(2, 8);
    d.setAttribute('aria-labelledby', idT);
    if (descricao) d.setAttribute('aria-describedby', idT + '-d');
    const principal = acoes.find(a => a.principal) || acoes[acoes.length - 1];

    pintar(d, html`<form class="dialogo-form" method="dialog" novalidate>
      <div class="dialogo-cabeca">
        <div>
          <h2 class="dialogo-titulo" id="${idT}">${titulo}</h2>
          ${descricao ? html`<p class="dialogo-desc" id="${idT}-d">${descricao}</p>` : ''}
        </div>
        <button type="button" class="btn-icone" data-fechar aria-label="Fechar">${icone('x')}</button>
      </div>
      <div class="dialogo-corpo">${corpo}</div>
      <div class="dialogo-erro" hidden></div>
      <div class="dialogo-acoes">
        ${acoes.map((a, i) => html`<button type="${a === principal ? 'submit' : 'button'}" class="btn btn-${a.tipo || 'fantasma'}" data-acao="${i}">${a.rotulo}</button>`)}
      </div>
    </form>`);
    document.body.append(d);

    let ocupado = false;
    const terminar = valor => {
      if (d.open) d.close();
      d.remove();
      if (anterior && anterior.isConnected) anterior.focus();
      resolve(valor);
    };
    const tentar = async (valor, botao) => {
      if (ocupado) return;
      if (antesDeFechar && valor !== null) {
        ocupado = true;
        if (botao) { botao.setAttribute('aria-busy', 'true'); botao.disabled = true; }
        let ok;
        try { ok = await antesDeFechar(valor, d); }
        finally {
          ocupado = false;
          if (botao) { botao.removeAttribute('aria-busy'); botao.disabled = false; }
        }
        if (ok === false) return;
      }
      terminar(valor);
    };

    const form = $('form', d);
    form.addEventListener('submit', e => {
      e.preventDefault();
      const i = acoes.indexOf(principal);
      tentar(principal ? principal.valor ?? true : true, $(`[data-acao="${i}"]`, d));
    });
    d.addEventListener('click', e => {
      if (e.target === d) { if (!ocupado) terminar(null); return; }      // clique no fundo
      if (e.target.closest('[data-fechar]')) { if (!ocupado) terminar(null); return; }
      const b = e.target.closest('button[type="button"][data-acao]');
      if (b) tentar(acoes[+b.dataset.acao].valor ?? null, b);
    });
    d.addEventListener('cancel', e => { e.preventDefault(); if (!ocupado) terminar(null); });  // Esc

    d.showModal();
    if (aoAbrir) aoAbrir(d);
    const foco = d.querySelector('[autofocus]') || d.querySelector('.dialogo-corpo input, .dialogo-corpo textarea, .dialogo-corpo select');
    (foco || $(`[data-acao]`, d))?.focus();
  });
}

// Mostra erro dentro do diálogo aberto (região de alerta acima dos botões).
export function erroNoDialogo(d, msg) {
  const r = $('.dialogo-erro', d);
  if (!msg) { r.hidden = true; pintar(r, ''); return; }
  pintar(r, html`<p class="nota nota-alerta" role="alert">${icone('alerta')}<span>${msg}</span></p>`);
  r.hidden = false;
}

export async function confirmar({ titulo, descricao = '', confirmar: rotulo = 'Confirmar', cancelar = 'Voltar', perigo = false }) {
  const v = await abrirDialogo({
    titulo, descricao,
    acoes: [
      { rotulo: cancelar, valor: false, tipo: 'fantasma' },
      { rotulo, valor: true, tipo: perigo ? 'perigo' : 'primario', principal: true },
    ],
  });
  return v === true;
}
