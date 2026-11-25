// Carregando, erro e vazio das listas: estadoLista() devolve o HTML ou null quando há itens para desenhar.
import { html } from '../lib/dom.js';
import { icone } from './icones.js';
import { carregando } from './pecas.js';

export function estadoLista({ carregado, erro, vazioSe = false, vazioConteudo = '' }) {
  if (erro) {
    return html`<div class="estado-erro" role="alert">
      ${icone('alerta')}
      <div class="estado-erro-texto">
        <p class="estado-titulo">Não foi possível carregar</p>
        <p class="estado-texto">${erro}</p>
      </div>
      <button type="button" class="btn btn-fantasma" data-tentar-de-novo>${icone('repetir')} Tentar de novo</button>
    </div>`;
  }
  if (!carregado) return carregando(4);
  if (vazioSe) return vazioConteudo;
  return null;
}
