// Ícones SVG fixos do app (traço 2 px, herdam a cor do texto).
import { bruto } from '../lib/dom.js';

const P = {
  menu:      '<path d="M4 6h16M4 12h16M4 18h16"/>',
  voltar:    '<path d="M15 18l-6-6 6-6"/>',
  inicio:    '<path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  campanhas: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  mais:      '<path d="M12 5v14M5 12h14"/>',
  gestao:    '<path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-5h6v5"/><path d="M9 10h.01M15 10h.01"/>',
  historico: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 1.9"/>',
  perfil:    '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c1.4-3.6 4.2-5.4 7.5-5.4s6.1 1.8 7.5 5.4"/>',
  check:     '<path d="M4 12.5l5.5 5.5L20 7"/>',
  x:         '<path d="M6 6l12 12M18 6L6 18"/>',
  alerta:    '<path d="M12 3.5L21.5 20h-19L12 3.5z"/><path d="M12 9.5v5"/><path d="M12 17.3v.1"/>',
  cadeado:   '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 018 0V11"/>',
  baixar:    '<path d="M12 3v12"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M4 20h16"/>',
  busca:     '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/>',
  sair:      '<path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/>',
  editar:    '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  pessoa:    '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.4 3.6-5.2 6.5-5.2s5.5 1.8 6.5 5.2"/><path d="M16 4.5a3.5 3.5 0 010 7M18.5 14.9c1.6.8 2.6 2.4 3 5.1"/>',
  offline:   '<path d="M2 8.8a15 15 0 0120 0"/><path d="M5 12.6a10 10 0 0114 0"/><path d="M8.5 16.4a5 5 0 017 0"/><path d="M12 20h.01"/><path d="M3 3l18 18"/>',
  rascunho:  '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  seta:      '<path d="M9 18l6-6-6-6"/>',
  repetir:   '<path d="M4 12a8 8 0 0113.7-5.7L20 8.6"/><path d="M20 3v5.6h-5.6"/><path d="M20 12a8 8 0 01-13.7 5.7L4 15.4"/><path d="M4 21v-5.6h5.6"/>',
  info:      '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5v.1"/>',
};

export function icone(nome, rotulo = '') {
  const a11y = rotulo ? `role="img" aria-label="${rotulo.replace(/"/g, '')}"` : 'aria-hidden="true" focusable="false"';
  return bruto(`<svg class="ico ico-${nome}" viewBox="0 0 24 24" ${a11y}>${P[nome] || ''}</svg>`);
}
