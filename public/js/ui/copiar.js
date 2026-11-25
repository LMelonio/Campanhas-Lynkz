// Botão de copiar (44 px) com confirmação por toast.
import { html, ao } from '../lib/dom.js';
import { icone } from './icones.js';

export const botaoCopiar = (texto, rotulo, aviso = `${rotulo} copiado`) =>
  html`<button type="button" class="btn-icone btn-copiar" data-copiar="${texto}" data-copiar-aviso="${aviso}" aria-label="Copiar ${rotulo}">${icone('copiar')}</button>`;

export async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    // Alternativa para navegador sem permissão de área de transferência.
    const t = document.createElement('textarea');
    t.value = texto;
    t.setAttribute('readonly', '');
    t.style.position = 'fixed';
    t.style.opacity = '0';
    document.body.append(t);
    t.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    t.remove();
    return ok;
  }
}

export function ligarCopiar(raiz, toast) {
  return ao(raiz, 'click', '[data-copiar]', async (e, b) => {
    const ok = await copiarTexto(b.dataset.copiar);
    toast(ok ? b.dataset.copiarAviso : 'Não foi possível copiar. Selecione o texto e copie à mão.',
      { tom: ok ? 'sucesso' : 'erro', duracao: 2500 });
  });
}
