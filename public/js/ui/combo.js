// ============================================================
//  COMBO — combobox ARIA com lista filtrada (busca sem acento).
//  O valor só "assume" um item da lista; texto solto volta ao último item
//  escolhido ao sair do campo. Opção "Cadastrar …" opcional.
// ============================================================
import { html, pintar } from '../lib/dom.js';
import { contem, normaliza } from '../lib/regras.js';

// combo(input, {
//   opcoes: () => [{ valor, rotulo, detalhe? }],
//   valor: valor inicial,
//   aoEscolher(opcao | null),
//   criar: { rotulo: termo => 'Cadastrar a empresa “X”', aoCriar: termo => void },
//   vazio: 'Nenhum resultado',
// }) → { definir(valor), valor(), abrir(), desligar() }
export function combo(input, { opcoes, valor = null, aoEscolher = () => {}, criar = null, vazio = 'Nenhum resultado', limite = 60 }) {
  const id = input.id;
  const lista = document.createElement('ul');
  lista.id = id + '-lista';
  lista.className = 'combo-lista';
  lista.setAttribute('role', 'listbox');
  lista.hidden = true;
  input.after(lista);
  input.parentElement.classList.add('combo');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', lista.id);
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('spellcheck', 'false');

  let atual = null;           // opção escolhida
  let visiveis = [];          // itens da lista aberta (opções + criar)
  let ativo = -1;

  const todas = () => opcoes() || [];
  const acha = v => todas().find(o => String(o.valor) === String(v)) || null;

  function fechar() {
    lista.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    ativo = -1;
  }

  function desenhar() {
    const termo = input.value.trim();
    const filtrar = termo && !(atual && termo === atual.rotulo);
    const ops = (filtrar ? todas().filter(o => contem(termo, o.rotulo + ' ' + (o.busca || ''))) : todas()).slice(0, limite);
    visiveis = ops.map(o => ({ tipo: 'opcao', o }));
    const exato = ops.some(o => normaliza(o.rotulo) === normaliza(termo));
    if (criar && termo && !exato) visiveis.push({ tipo: 'criar', termo });
    if (ativo >= visiveis.length) ativo = visiveis.length - 1;

    pintar(lista, visiveis.length
      ? html`${visiveis.map((v, i) => v.tipo === 'opcao'
          ? html`<li role="option" id="${id}-op-${i}" class="combo-opcao${i === ativo ? ' ativa' : ''}" data-i="${i}"
                aria-selected="${atual && String(atual.valor) === String(v.o.valor) ? 'true' : 'false'}">${v.o.rotulo}${v.o.detalhe ? html`<small>${v.o.detalhe}</small>` : ''}</li>`
          : html`<li role="option" id="${id}-op-${i}" class="combo-opcao combo-criar${i === ativo ? ' ativa' : ''}" data-i="${i}" aria-selected="false">${criar.rotulo(v.termo)}</li>`)}`
      : html`<li class="combo-vazio" role="presentation">${vazio}</li>`);
    if (ativo >= 0) {
      input.setAttribute('aria-activedescendant', `${id}-op-${ativo}`);
      document.getElementById(`${id}-op-${ativo}`)?.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }

  function abrir() {
    lista.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    desenhar();
  }

  function escolher(i) {
    const v = visiveis[i];
    if (!v) return;
    fechar();
    if (v.tipo === 'criar') { criar.aoCriar(v.termo); return; }
    definir(v.o.valor, true);
  }

  function definir(valorNovo, avisarMudanca = false) {
    const o = valorNovo == null || valorNovo === '' ? null : acha(valorNovo);
    const mudou = (o?.valor ?? null) !== (atual?.valor ?? null);
    atual = o;
    input.value = o ? o.rotulo : '';
    input.dataset.valor = o ? String(o.valor) : '';
    if (avisarMudanca && mudou) aoEscolher(o);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Ao digitar, a primeira opção que sobrou fica ativa (Enter escolhe).
  const onInput = () => { ativo = 0; abrir(); };
  const onKey = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (lista.hidden) { abrir(); }
      const n = visiveis.length;
      if (!n) return;
      ativo = e.key === 'ArrowDown' ? (ativo + 1) % n : (ativo <= 0 ? n - 1 : ativo - 1);
      desenhar();
    } else if (e.key === 'Enter') {
      if (!lista.hidden && ativo >= 0) { e.preventDefault(); escolher(ativo); }
    } else if (e.key === 'Escape') {
      if (!lista.hidden) { e.preventDefault(); e.stopPropagation(); fechar(); input.value = atual ? atual.rotulo : ''; }
    } else if (e.key === 'Tab') {
      fechar();
    }
  };
  // Com valor já escolhido a lista abre só no clique, na seta ou ao digitar.
  const onFocus = () => { ativo = -1; if (!atual) abrir(); };
  const onClick = () => { if (lista.hidden) abrir(); };
  const onBlur = () => {
    setTimeout(() => {
      if (document.activeElement === input) return;
      fechar();
      // Texto que não é exatamente um item: tenta casar, senão volta ao escolhido.
      const termo = input.value.trim();
      if (!termo) { if (atual) definir(null, true); return; }
      const exato = todas().find(o => normaliza(o.rotulo) === normaliza(termo));
      if (exato && String(exato.valor) !== String(atual?.valor)) definir(exato.valor, true);
      else input.value = atual ? atual.rotulo : '';
    }, 150);
  };
  const onMouseDown = e => e.preventDefault();      // não tira o foco do campo
  const onListClick = e => {
    const li = e.target.closest('[data-i]');
    if (li) escolher(+li.dataset.i);
  };

  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKey);
  input.addEventListener('focus', onFocus);
  input.addEventListener('click', onClick);
  input.addEventListener('blur', onBlur);
  lista.addEventListener('mousedown', onMouseDown);
  lista.addEventListener('click', onListClick);

  if (valor != null && valor !== '') {
    const o = acha(valor);
    atual = o;
    input.value = o ? o.rotulo : '';
    input.dataset.valor = o ? String(o.valor) : '';
  }

  return {
    definir: v => definir(v, true),
    valor: () => atual?.valor ?? null,
    opcao: () => atual,
    abrir,
    desligar() {
      input.removeEventListener('input', onInput);
      input.removeEventListener('keydown', onKey);
      input.removeEventListener('focus', onFocus);
      input.removeEventListener('click', onClick);
      input.removeEventListener('blur', onBlur);
      lista.remove();
    },
  };
}
