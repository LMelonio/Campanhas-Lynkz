// Campos de formulário acessíveis (label, aria-describedby, erro com ícone e texto) e máscaras.
import { html, atributos, pintar, ao, $, $$ } from '../lib/dom.js';
import { maskCPF, maskCNPJ, maskTelefone, lerValor, valorCampo } from '../lib/regras.js';
import { icone } from './icones.js';

const MASCARAS = {
  cpf: { fn: maskCPF, attrs: { inputmode: 'numeric', maxlength: 14, autocomplete: 'off', placeholder: '000.000.000-00' } },
  cnpj: { fn: maskCNPJ, attrs: { inputmode: 'numeric', maxlength: 18, autocomplete: 'off', placeholder: '00.000.000/0000-00' } },
  tel: { fn: maskTelefone, attrs: { inputmode: 'tel', maxlength: 15, autocomplete: 'off', placeholder: '(00) 00000-0000' } },
  valor: { fn: v => v.replace(/[^\d.,]/g, ''), attrs: { inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00' } },
  decimal: { fn: v => v.replace(/[^\d.,]/g, ''), attrs: { inputmode: 'decimal', autocomplete: 'off', placeholder: '0,0' } },
};

function rotuloHtml({ id, rotulo, obrigatorio, opcional }) {
  return html`<label for="${id}">${rotulo}${obrigatorio ? html`<span class="campo-obrig" aria-hidden="true">*</span>` : ''}${opcional ? html`<span class="campo-opcional">(opcional)</span>` : ''}</label>`;
}

function rodape(id, dica) {
  return html`${dica ? html`<p class="campo-dica" id="${id}-dica">${dica}</p>` : ''}
    <p class="campo-erro" id="${id}-erro" hidden></p>`;
}

const descr = (id, dica) => (dica ? `${id}-dica ` : '') + `${id}-erro`;

// campo({ id, rotulo, tipo, valor, dica, obrigatorio, opcional, mascara, atributos, classe })
export function campo({ id, rotulo, tipo = 'text', valor = '', dica = '', obrigatorio = false, opcional = false,
  mascara = '', atributos: extra = {}, classe = '', depois = '' }) {
  const m = MASCARAS[mascara];
  const attrs = {
    id, name: id, type: tipo, value: valor ?? '',
    'aria-describedby': descr(id, dica),
    'aria-required': obrigatorio ? 'true' : false,
    'data-mascara': mascara || false,
    ...(m ? m.attrs : {}), ...extra,
  };
  return html`<div class="campo ${classe}" data-campo="${id}">
    ${rotuloHtml({ id, rotulo, obrigatorio, opcional })}
    <input${atributos(attrs)}>
    ${depois}
    ${rodape(id, dica)}
  </div>`;
}

// opcoes: ['A', 'B'] ou [{ valor, rotulo }]
// opcoes: ['A', 'B'] ou [{ valor, rotulo, grupo? }]. Com grupo, as opções vão em <optgroup>, na ordem em que aparecem.
export function selecao({ id, rotulo, opcoes = [], valor = '', vazio = 'Selecione', dica = '', obrigatorio = false, opcional = false, classe = '' }) {
  const ops = opcoes.map(o => (typeof o === 'string' ? { valor: o, rotulo: o } : o));
  const opcao = o => html`<option value="${o.valor}"${atributos({ selected: String(o.valor) === String(valor ?? '') })}>${o.rotulo}</option>`;
  const grupos = [...new Set(ops.map(o => o.grupo).filter(Boolean))];
  return html`<div class="campo ${classe}" data-campo="${id}">
    ${rotuloHtml({ id, rotulo, obrigatorio, opcional })}
    <select id="${id}" name="${id}" aria-describedby="${descr(id, dica)}"${atributos({ 'aria-required': obrigatorio ? 'true' : false })}>
      <option value="">${vazio}</option>
      ${grupos.length ? grupos.map(g => html`<optgroup label="${g}">${ops.filter(o => o.grupo === g).map(opcao)}</optgroup>`) : ops.map(opcao)}
    </select>
    ${rodape(id, dica)}
  </div>`;
}

export function areaTexto({ id, rotulo, valor = '', dica = '', obrigatorio = false, opcional = false, atributos: extra = {}, classe = '' }) {
  return html`<div class="campo ${classe}" data-campo="${id}">
    ${rotuloHtml({ id, rotulo, obrigatorio, opcional })}
    <textarea${atributos({ id, name: id, 'aria-describedby': descr(id, dica), 'aria-required': obrigatorio ? 'true' : false, ...extra })}>${valor ?? ''}</textarea>
    ${rodape(id, dica)}
  </div>`;
}

// Busca com botão "limpar" (×) de 44 px, visível só com texto. Esc também limpa.
// placeholder curto (cabe em 360 px); a explicação completa vai em dica, lida pelo leitor de tela.
export function campoBusca({ id, rotulo, valor = '', placeholder = '', dica = '' }) {
  return html`<div class="campo busca">
    <label class="so-leitor" for="${id}">${rotulo}</label>
    ${dica ? html`<span class="so-leitor" id="${id}-dica">${dica}</span>` : ''}
    ${icone('busca')}
    <input${atributos({ id, type: 'search', value: valor ?? '', placeholder, autocomplete: 'off', 'data-busca': true, 'aria-describedby': dica ? `${id}-dica` : false })}>
    <button type="button" class="btn-icone busca-limpar" data-limpar-busca="${id}" aria-label="Limpar busca"${atributos({ hidden: !valor })}>${icone('x')}</button>
  </div>`;
}

export function ligarBusca(raiz) {
  const limpar = input => {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  };
  const d1 = ao(raiz, 'input', 'input[data-busca]', (e, i) => {
    const b = $(`[data-limpar-busca="${CSS.escape(i.id)}"]`, raiz);
    if (b) b.hidden = !i.value;
  });
  const d2 = ao(raiz, 'click', '[data-limpar-busca]', (e, b) => limpar(document.getElementById(b.dataset.limparBusca)));
  const d3 = ao(raiz, 'keydown', 'input[data-busca]', (e, i) => {
    if (e.key === 'Escape' && i.value) { e.preventDefault(); e.stopPropagation(); limpar(i); }
  });
  return () => { d1(); d2(); d3(); };
}

// Interruptor liga/desliga (checkbox com role=switch).
export function interruptor({ id, rotulo, marcado = false, dica = '', classe = '' }) {
  return html`<label class="interruptor ${classe}" for="${id}">
    <input type="checkbox" role="switch" id="${id}" name="${id}"${atributos({ checked: !!marcado })}>
    <span class="interruptor-trilho" aria-hidden="true"></span>
    <span class="interruptor-texto">${rotulo}${dica ? html`<small>${dica}</small>` : ''}</span>
  </label>`;
}

// Máscaras: um ouvinte só na raiz para todos os campos com data-mascara.
// Valor monetário é reformatado ao sair do campo ("2000" → "2.000,00").
export function ligarMascaras(raiz) {
  const d1 = ao(raiz, 'input', '[data-mascara]', (e, el) => {
    const m = MASCARAS[el.dataset.mascara];
    if (!m) return;
    const antes = el.value, novo = m.fn(antes);
    if (novo !== antes) {
      const fimAntes = antes.length - (el.selectionEnd ?? antes.length);
      el.value = novo;
      const pos = Math.max(0, novo.length - fimAntes);
      try { el.setSelectionRange(pos, pos); } catch { /* tipo sem seleção */ }
    }
  });
  const d2 = ao(raiz, 'focusout', '[data-mascara="valor"]', (e, el) => {
    const n = lerValor(el.value);
    if (el.value.trim() && Number.isFinite(n)) el.value = valorCampo(n);
  });
  return () => { d1(); d2(); };
}

// ---------- erros ----------
export function limparErro(raiz, id) {
  const c = $(`[data-campo="${CSS.escape(id)}"]`, raiz);
  if (!c) return;
  c.classList.remove('tem-erro');
  const e = $('.campo-erro', c);
  if (e) { e.hidden = true; pintar(e, ''); }
  const ctl = $('input, select, textarea', c);
  if (ctl) ctl.removeAttribute('aria-invalid');
}

export function marcarErro(raiz, id, msg) {
  const c = $(`[data-campo="${CSS.escape(id)}"]`, raiz);
  if (!c) return false;
  c.classList.add('tem-erro');
  const e = $('.campo-erro', c);
  if (e) { pintar(e, html`${icone('alerta')}<span>${msg}</span>`); e.hidden = false; }
  const ctl = $('input, select, textarea', c);
  if (ctl) ctl.setAttribute('aria-invalid', 'true');
  // Assim que o valor muda, o erro some (volta se salvar de novo e ainda estiver errado).
  if (!c._limpaErro) {
    c._limpaErro = true;
    const limpa = () => { if (c.classList.contains('tem-erro')) limparErro(raiz, id); };
    c.addEventListener('input', limpa);
    c.addEventListener('change', limpa);
  }
  return true;
}

// aplicarErros(raiz, { idDoCampo: 'mensagem' }) — limpa os anteriores, marca
// os novos, rola até o primeiro e põe o foco nele. Devolve quantos marcou.
export function aplicarErros(raiz, erros = {}) {
  $$('.campo.tem-erro', raiz).forEach(c => limparErro(raiz, c.dataset.campo));
  const ids = Object.keys(erros).filter(id => marcarErro(raiz, id, erros[id]));
  if (ids.length) {
    // O primeiro na ordem da tela, não na ordem do objeto.
    const primeiro = $$('.campo.tem-erro', raiz)[0];
    const ctl = primeiro && $('input:not([type="hidden"]), select, textarea', primeiro);
    if (primeiro) {
      const calmo = matchMedia('(prefers-reduced-motion: reduce)').matches;
      primeiro.scrollIntoView({ behavior: calmo ? 'auto' : 'smooth', block: 'center' });
      ctl?.focus({ preventScroll: true });
    }
  }
  return ids.length;
}
