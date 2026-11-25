// Campo de senha: mostrar/ocultar, aviso de Caps Lock e, em senha nova, força e requisitos ao vivo.
import { html, atributos, pintar, ao, $, $$ } from '../lib/dom.js';
import { icone } from './icones.js';

const REQUISITOS = [
  { chave: 'tamanho', texto: '8 caracteres ou mais', ok: v => v.length >= 8 },
  { chave: 'mistura', texto: 'letras e números', ok: v => /\p{L}/u.test(v) && /\d/.test(v) },
  { chave: 'email', texto: 'diferente do e-mail', ok: (v, email) => !!v && v.toLowerCase() !== String(email || '').trim().toLowerCase() },
];
const NIVEIS = { 1: 'fraca', 2: 'média', 3: 'forte' };

export function campoSenha({ id, rotulo, novo = false, autocomplete = 'current-password', extraRotulo = '', classe = '' }) {
  const descr = `${id}-caps ${novo ? `${id}-forca ` : ''}${id}-erro`;
  return html`<div class="campo campo-senha ${classe}" data-campo="${id}">
    <div class="campo-rotulo-linha"><label for="${id}">${rotulo}</label>${extraRotulo}</div>
    <div class="senha-caixa">
      <input${atributos({
        id, name: id, type: 'password', autocomplete: novo ? 'new-password' : autocomplete,
        'aria-describedby': descr, 'data-senha': true, 'data-senha-nova': novo, spellcheck: 'false', autocapitalize: 'off',
      })}>
      <button type="button" class="btn-icone senha-olho" data-olho="${id}" aria-controls="${id}" aria-pressed="false" aria-label="Mostrar senha">${icone('olho')}</button>
    </div>
    <p class="senha-caps" id="${id}-caps" role="status"></p>
    ${novo ? html`<div class="senha-forca" id="${id}-forca" data-forca="${id}" data-nivel="0">
      <div class="forca-barra" aria-hidden="true"><i></i><i></i><i></i></div>
      <p class="forca-texto" aria-live="polite"></p>
      <ul class="forca-req">${REQUISITOS.map(r => html`<li data-req="${r.chave}" data-texto="${r.texto}"></li>`)}</ul>
    </div>` : ''}
    <p class="campo-erro" id="${id}-erro" hidden></p>
  </div>`;
}

function alternarOlho(botao, mostrar) {
  const input = document.getElementById(botao.dataset.olho);
  if (!input) return;
  input.type = mostrar ? 'text' : 'password';
  botao.setAttribute('aria-pressed', String(mostrar));
  botao.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
  pintar(botao, icone(mostrar ? 'olho-fechado' : 'olho'));
}

function atualizarForca(input, email) {
  const caixa = document.getElementById(input.id + '-forca');
  if (!caixa) return;
  const v = input.value;
  let n = 0;
  for (const r of REQUISITOS) {
    const ok = r.ok(v, email);
    if (ok) n++;
    const li = $(`[data-req="${r.chave}"]`, caixa);
    li.classList.toggle('ok', ok);
    pintar(li, html`${icone(ok ? 'check' : 'x')}<span>${li.dataset.texto}</span><span class="so-leitor">${ok ? ' (atendido)' : ' (falta)'}</span>`);
  }
  // Barra de 3 segmentos: 1 = fraca, 2 = média, 3 = forte.
  const nivel = v ? Math.max(1, n) : 0;
  caixa.dataset.nivel = String(nivel);
  pintar($('.forca-texto', caixa), v ? `Força: ${NIVEIS[nivel]}` : '');
}

export function ligarSenha(raiz, { email = () => '' } = {}) {
  const caps = (input, ligado) => {
    const p = document.getElementById(input.id + '-caps');
    if (!p) return;
    p.classList.toggle('ligado', ligado);
    pintar(p, ligado ? html`${icone('alerta')}<span>Caps Lock está ligado</span>` : '');
  };
  const desligar = [
    // Não tira o foco do campo ao tocar no olho.
    ao(raiz, 'mousedown', '[data-olho]', e => e.preventDefault()),
    ao(raiz, 'click', '[data-olho]', (e, b) => {
      alternarOlho(b, b.getAttribute('aria-pressed') !== 'true');
      const input = document.getElementById(b.dataset.olho);
      input.focus();
      const fim = input.value.length;
      try { input.setSelectionRange(fim, fim); } catch { /* sem seleção */ }
    }),
    ao(raiz, 'keydown', 'input[data-senha]', (e, i) => { if (e.getModifierState) caps(i, e.getModifierState('CapsLock')); }),
    ao(raiz, 'keyup', 'input[data-senha]', (e, i) => { if (e.getModifierState) caps(i, e.getModifierState('CapsLock')); }),
    ao(raiz, 'focusout', 'input[data-senha]', (e, i) => caps(i, false)),
    ao(raiz, 'input', 'input[data-senha-nova]', (e, i) => atualizarForca(i, email())),
    // Ao enviar, volta tudo para "password" (o gerenciador de senhas e o
    // histórico do navegador nunca recebem a senha como texto comum).
    ao(raiz, 'submit', 'form', () => $$('[data-olho]', raiz).forEach(b => alternarOlho(b, false)), true),
  ];
  $$('input[data-senha-nova]', raiz).forEach(i => atualizarForca(i, email()));
  return () => desligar.forEach(fn => fn());
}
