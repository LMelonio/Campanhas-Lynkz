// ============================================================
//  DETALHE — cabeçalho, régua, painéis e barra de decisão.
//  Aprovar espera 5 s com "Desfazer" e depois abre a próxima pendente.
//  Reprovar abre diálogo com motivos rápidos; motivo é obrigatório.
// ============================================================
import { html, pintar, $, ao } from '../lib/dom.js';
import { calc, banda, pct, brl, dataBR, dias, maskCPF, maskTelefone, soDigitos, STATUS } from '../lib/regras.js';
import { icone } from '../ui/icones.js';
import { selo, seloNeutro, regua, vazio, carregando, FAIXAS } from '../ui/pecas.js';
import { botaoCopiar, ligarCopiar } from '../ui/copiar.js';
import { abrirDialogo, erroNoDialogo } from '../ui/avisos.js';
import { areaTexto, aplicarErros } from '../ui/campos.js';
import { estadoLista } from '../ui/estado.js';

const C = window.CONFIG;
const ESPERA_APROVAR = 5000;
const MOTIVOS_RAPIDOS = C.MOTIVOS_RAPIDOS || [];

// Aprovação em espera. Fica fora da tela montada: se a pessoa sair do
// detalhe durante os 5 s, a aprovação continua e é gravada.
let emEspera = null;   // { id, cliente, total, desfeito, feito, timer, aviso }

let atual = null;      // { el, ctx, id, desligar[] }

const linha = (rotulo, valor, { empilhada = false, classe = '' } = {}) =>
  html`<div class="${empilhada ? 'empilhada' : ''}"><dt>${rotulo}</dt><dd class="${classe}">${valor === '' || valor == null ? '—' : valor}</dd></div>`;

function painel(titulo, conteudo, extra = '') {
  return html`<section class="painel"><h3 class="painel-titulo">${titulo}${extra}</h3><dl class="linhas">${conteudo}</dl></section>`;
}

// Notas fiscais marcadas na campanha (carregadas sob demanda, uma vez por campanha).
const notasCache = new Map();

function painelNotas(c) {
  if (!c.compras_consultado_em) return '';
  const notas = notasCache.get(String(c.id));
  const total = notas ? notas.reduce((t, n) => t + +n.valor, 0) : 0;
  return html`<section class="painel" id="det-notas"><h3 class="painel-titulo">Compras e notas fiscais</h3>
    <dl class="linhas">
      ${linha('Comprou no período', +c.compras_periodo || +c.compras_periodo === 0 ? `R$ ${brl(c.compras_periodo)}` : '')}
      ${linha('Consultado no Qlik em', dataBR(c.compras_consultado_em))}
    </dl>
    ${!notas ? html`<p class="painel-corpo campo-dica">Carregando as notas…</p>`
      : notas.length ? html`<ul class="notas-lista painel-corpo">${notas.map(n => html`<li class="nota-linha">
          <span><strong>NF ${n.numero}${n.serie ? ` · série ${n.serie}` : ''}</strong> <small>${n.data_emissao ? dataBR(n.data_emissao) : ''}</small></span>
          <span class="valor">R$ ${brl(n.valor)}</span></li>`)}
          <li class="nota-linha nota-total"><span>${notas.length} ${notas.length === 1 ? 'nota' : 'notas'} na campanha</span><span class="valor">R$ ${brl(total)}</span></li></ul>`
      : html`<p class="painel-corpo campo-dica">Nenhuma nota foi marcada nesta campanha.</p>`}
  </section>`;
}

async function carregarNotas(ctx, c) {
  if (!c.compras_consultado_em || notasCache.has(String(c.id))) return;
  try {
    notasCache.set(String(c.id), await ctx.campanhas.notasDa(c.id));
  } catch (e) {
    console.warn('Notas fiscais não carregaram', e);
    return;
  }
  if (atual && String(atual.id) === String(c.id)) desenhar();
}

const pctTexto = n => (+n).toLocaleString('pt-BR', { maximumFractionDigits: 3 }) + '%';

function painelRecebedor(c, ctx) {
  const ehSwile = c.forma_pagamento === 'Swile';
  const balc = c.balconista_id ? ctx.cadastros.balconista(c.balconista_id) : null;
  if (!ehSwile && !balc) return '';
  const linkBalc = balc ? linha('Cadastro', html`<a href="#/gestao/empresas/${balc.empresa_id}">${balc.nome_completo}${balc.ativo ? '' : ' (desativado)'}</a>`) : '';

  if (ehSwile && c.swile_visivel === false) {
    return html`<section class="painel"><h3 class="painel-titulo">Quem recebe a premiação</h3>
      <p class="nota painel-nota">${icone('cadeado')}<span>Os dados do pagamento Swile ficam visíveis só para o aprovador e para quem fez a solicitação.</span></p>
      ${balc ? html`<dl class="linhas">${linkBalc}</dl>` : ''}</section>`;
  }
  const d = ehSwile
    ? { nome: c.swile_nome_completo, cpf: c.swile_cpf, nasc: c.swile_data_nascimento, email: c.swile_email, tel: c.swile_telefone }
    : { nome: balc.nome_completo, cpf: balc.cpf, nasc: balc.data_nascimento, email: balc.email, tel: balc.telefone };
  const comCopiar = (texto, valorCopia, rotulo) => (texto ? html`<span class="dd-copiar">${texto}${botaoCopiar(valorCopia, rotulo)}</span>` : '');
  // Tudo o que o financeiro precisa para lançar o pagamento, de uma vez.
  const pagamento = [
    `Nome: ${d.nome || ''}`,
    `CPF: ${d.cpf ? maskCPF(d.cpf) : ''}`,
    `Nascimento: ${d.nasc ? dataBR(d.nasc) : ''}`,
    `E-mail: ${d.email || ''}`,
    `Telefone: ${d.tel ? maskTelefone(d.tel) : ''}`,
    `Valor: R$ ${brl(calc(c).invL)}`,
    `Campanha: ${c.codigo} – ${c.campanha}`,
  ].join('\n');
  return html`<section class="painel">
    <h3 class="painel-titulo">Quem recebe a premiação${ehSwile ? html`<span class="selo selo-neutro">${icone('cadeado')}Swile</span>` : ''}</h3>
    <dl class="linhas">
      ${linha('Nome completo', d.nome)}
      ${linha('CPF', comCopiar(d.cpf ? maskCPF(d.cpf) : '', soDigitos(d.cpf), 'CPF'))}
      ${linha('Nascimento', d.nasc ? dataBR(d.nasc) : '')}
      ${linha('E-mail', comCopiar(d.email, d.email, 'E-mail'))}
      ${linha('Telefone', comCopiar(d.tel ? maskTelefone(d.tel) : '', d.tel ? maskTelefone(d.tel) : '', 'Telefone'))}
      ${ehSwile ? linkBalc : ''}
    </dl>
    <div class="painel-corpo painel-acoes">
      <button type="button" class="btn btn-fantasma btn-pequeno" data-copiar="${pagamento}" data-copiar-aviso="Dados do pagamento copiados">${icone('copiar')} Copiar dados do pagamento</button>
    </div>
  </section>`;
}

function corpo(c, ctx) {
  const k = calc(c);
  const d = dias(c.data_inicio, c.data_fim);
  const minha = c.solicitante_id === ctx.perfil.id;
  const empresa = c.empresa_id ? ctx.cadastros.empresa(c.empresa_id) : null;

  return html`<article class="detalhe">
    <header class="det-cabeca">
      <div class="det-linha">
        ${empresa
          ? html`<a class="det-empresa" href="#/gestao/empresas/${empresa.id}">${icone('gestao')}${c.cliente}</a>`
          : html`<span class="det-empresa">${c.cliente}</span>`}
        <span class="det-selos">${c.importada ? seloNeutro('Importada') : ''}${selo(c.status)}</span>
      </div>
      <h2 class="det-titulo">${c.campanha}</h2>
      <p class="det-sub">${c.laboratorio} · <span class="dd-copiar">${c.codigo}${botaoCopiar(c.codigo, 'código', 'Código copiado')}</span></p>
    </header>

    <section class="painel"><div class="painel-corpo painel-regua">${regua(c)}</div></section>

    ${c.status === STATUS.REPROVADA && c.motivo ? html`<section class="painel painel-motivo">
      <h3 class="painel-titulo">Motivo da reprova</h3><p class="painel-corpo">${c.motivo}</p></section>` : ''}

    <div class="det-paineis">
      ${painel('Campanha', html`
        ${linha('Mecânica', c.tipo)}
        ${c.mecanica ? linha('Como funciona', c.mecanica, { empilhada: true }) : ''}
        ${linha('Período', c.data_inicio || c.data_fim ? `${dataBR(c.data_inicio)} a ${dataBR(c.data_fim)}` : '')}
        ${linha('Duração', d ? `${d} dias` : '')}
        ${linha('Pagamento', c.forma_pagamento)}
        ${linha('Tipo de meta', c.tipo_meta)}
        ${linha('Meta do cliente', +c.meta ? `R$ ${brl(c.meta)}` : '')}
        ${c.observacoes ? linha('Observações', c.observacoes, { empilhada: true }) : ''}`)}

      ${+c.rebate_pct > 0 ? painel('Rebate', html`
        ${linha('Percentual', pctTexto(c.rebate_pct))}
        ${linha('Base de cálculo', c.rebate_base)}
        ${linha('Quando é devido', c.rebate_gatilho)}
        ${linha('Teto', +c.rebate_teto > 0 ? `R$ ${brl(c.rebate_teto)}` : 'sem teto')}
        ${linha('Estimado', html`R$ ${brl(k.reb)}${k.limitado ? html` <span class="tag-teto">no teto</span>` : ''}`)}`) : ''}

      ${painelRecebedor(c, ctx)}

      ${painelNotas(c)}

      ${painel('Solicitação', html`
        ${linha('Solicitante', c.solicitante_nome)}
        ${linha(c.importada ? 'Registrada em' : 'Enviada em', dataBR(c.criado_em))}
        ${c.importada ? linha('Origem', 'Planilha antiga (antes do app)') : ''}
        ${c.status !== STATUS.PENDENTE ? html`
          ${linha('Decidida por', c.aprovador_nome)}
          ${linha('Data da decisão', dataBR(c.data_decisao))}` : ''}`)}
    </div>

    <div class="acoes det-reenviar">
      ${c.status === STATUS.REPROVADA && minha
        ? html`<a class="btn btn-primario" href="#/nova/de/${c.id}">${icone('repetir')} Reenviar com ajustes</a>`
        : html`<a class="btn btn-fantasma" href="#/nova/de/${c.id}" data-modelo>${icone('repetir')} Usar como modelo</a>`}
    </div>
  </article>`;
}

// Custo e faixa ao lado dos botões: quem decide vê o número sem rolar a tela.
function custoDecisao(c) {
  const k = calc(c), b = banda(k.pctMeta, FAIXAS);
  return html`<div class="decisao-custo">
    <strong class="num-display valor">R$ ${brl(k.total)}</strong>
    <span class="decisao-pct nivel-${b.nivel}">${k.pctMeta == null ? 'sem meta informada' : `${pct(k.pctMeta)} da meta · ${b.txt}`}</span>
  </div>`;
}

function barra(c, ctx) {
  if (!ctx.ehAprovador || c.status !== STATUS.PENDENTE) return '';
  if (emEspera && String(emEspera.id) === String(c.id)) {
    return html`<div class="barra-decisao" role="region" aria-label="Decisão">
      ${custoDecisao(c)}
      <p class="barra-decisao-msg" role="status">${icone('historico')} Aprovando em instantes…</p>
      <button type="button" class="btn btn-fantasma" data-desfazer>Desfazer</button>
    </div>`;
  }
  return html`<div class="barra-decisao" role="region" aria-label="Decisão">
    ${custoDecisao(c)}
    <button type="button" class="btn btn-perigo" data-reprovar aria-keyshortcuts="R">${icone('x')} Reprovar <kbd class="atalho" aria-hidden="true">R</kbd></button>
    <button type="button" class="btn btn-primario" data-aprovar aria-keyshortcuts="A">${icone('check')} Aprovar <kbd class="atalho" aria-hidden="true">A</kbd></button>
  </div>`;
}

function desenhar() {
  if (!atual) return;
  const { el, ctx, id } = atual;
  const c = ctx.campanhas.porId(id);
  if (!c) {
    ctx.cabecalho({ titulo: 'Campanha', voltar: '#/campanhas' });
    ctx.barraDeAcao(false);
    pintar(el, ctx.campanhas.erro ? estadoLista({ erro: ctx.campanhas.erro }) : ctx.campanhas.carregado
      ? vazio({ icone: 'busca', titulo: 'Campanha não encontrada', texto: 'O endereço pode estar errado ou esta campanha não está liberada para o seu acesso.', acao: { href: '#/campanhas', rotulo: 'Ver campanhas' } })
      : carregando(2));
    return;
  }
  ctx.cabecalho({ titulo: c.campanha, voltar: '#/campanhas' });
  const b = barra(c, ctx);
  ctx.barraDeAcao(!!b);
  const rolagem = window.scrollY;
  const foco = document.activeElement && el.contains(document.activeElement) ? document.activeElement : null;
  const seletorFoco = foco?.matches('[data-aprovar]') ? '[data-aprovar]' : foco?.matches('[data-reprovar]') ? '[data-reprovar]' : foco?.matches('[data-desfazer]') ? '[data-desfazer]' : null;
  pintar(el, html`${corpo(c, ctx)}${b}`);
  window.scrollTo(0, rolagem);
  if (seletorFoco) ($(seletorFoco, el) || $('[data-aprovar], [data-desfazer]', el))?.focus({ preventScroll: true });
  carregarNotas(ctx, c);
}

// Próxima pendente (a mais antiga, sem contar a que acabou de sair da fila).
function abrirProxima(ctx, idAtual) {
  const prox = ctx.campanhas.pendentes().find(c => String(c.id) !== String(idAtual));
  if (prox) ctx.navegar(`#/campanhas/${prox.id}`, { substituir: true });
  else {
    ctx.toast('Fila limpa: nenhuma campanha pendente.', { tom: 'sucesso' });
    ctx.navegar('#/campanhas', { substituir: true });
  }
}

const estaAberta = id => location.hash === `#/campanhas/${id}`;

async function gravarAprovacao(ctx, e) {
  if (e.desfeito || e.feito) return;
  e.feito = true;
  clearTimeout(e.timer);
  e.aviso?.fechar('gravando');
  if (emEspera === e) emEspera = null;
  try {
    await ctx.campanhas.decidir(e.id, STATUS.APROVADA);
    ctx.toast(`Aprovada · ${e.cliente} · R$ ${brl(e.total)}`, { tom: 'sucesso' });
    if (estaAberta(e.id)) abrirProxima(ctx, e.id);
  } catch (err) {
    ctx.toast(err.message, { tom: 'erro', duracao: 8000 });
    if (atual && String(atual.id) === String(e.id)) desenhar();
  }
}

function aprovar(ctx, c) {
  // Estado novo a cada clique: um "Desfazer" antigo não vale para este.
  const e = { id: c.id, cliente: c.cliente, total: calc(c).total, desfeito: false, feito: false, timer: null, aviso: null };
  emEspera = e;
  e.aviso = ctx.toast(`Aprovando ${c.cliente}…`, {
    acao: { rotulo: 'Desfazer', aoClicar: () => desfazer(ctx, e) },
    duracao: ESPERA_APROVAR + 500,
  });
  e.timer = setTimeout(() => gravarAprovacao(ctx, e), ESPERA_APROVAR);
  desenhar();
}

function desfazer(ctx, e) {
  if (!e || e.feito || e.desfeito) return;
  e.desfeito = true;
  clearTimeout(e.timer);
  e.aviso?.fechar('desfeito');
  if (emEspera === e) emEspera = null;
  ctx.toast('Aprovação desfeita. A campanha continua pendente.');
  if (atual && String(atual.id) === String(e.id)) desenhar();
}

async function reprovar(ctx, c) {
  const corpoDlg = html`
    ${MOTIVOS_RAPIDOS.length ? html`<p class="campo-legenda" id="mr-rot">Motivos rápidos</p>
      <div class="chips" role="group" aria-labelledby="mr-rot">${MOTIVOS_RAPIDOS.map(m => html`<button type="button" class="chip" data-motivo="${m}">${m}</button>`)}</div>` : ''}
    ${areaTexto({ id: 'rp-motivo', rotulo: 'Motivo da reprova', obrigatorio: true, dica: 'O coordenador vai ler isso. Diga o que precisa mudar.', atributos: { maxlength: 1000 } })}`;
  let desligarChips = () => {};
  await abrirDialogo({
    titulo: 'Reprovar campanha',
    descricao: `${c.cliente} · ${c.campanha} · R$ ${brl(calc(c).total)}`,
    corpo: corpoDlg,
    acoes: [
      { rotulo: 'Voltar', valor: null, tipo: 'fantasma' },
      { rotulo: 'Reprovar', valor: 'reprovar', tipo: 'perigo', principal: true },
    ],
    aoAbrir: d => {
      desligarChips = ao(d, 'click', '[data-motivo]', (ev, b) => {
        const t = $('#rp-motivo', d);
        t.value = b.dataset.motivo;
        d.querySelectorAll('[data-motivo]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        aplicarErros(d, {});
        t.focus();
        t.setSelectionRange(t.value.length, t.value.length);
      });
    },
    antesDeFechar: async (_v, d) => {
      erroNoDialogo(d, '');
      const motivo = $('#rp-motivo', d).value.trim();
      if (!motivo) { aplicarErros(d, { 'rp-motivo': 'Escreva o motivo antes de reprovar.' }); return false; }
      try {
        await ctx.campanhas.decidir(c.id, STATUS.REPROVADA, motivo);
      } catch (err) { erroNoDialogo(d, err.message); return false; }
      ctx.toast(`Reprovada · ${c.cliente}`);
      if (estaAberta(c.id)) abrirProxima(ctx, c.id);
      return true;
    },
  });
  desligarChips();
}

// Se o app for para segundo plano durante a espera, grava já (não perde a aprovação).
document.addEventListener('visibilitychange', () => {
  if (document.hidden && emEspera && atual) gravarAprovacao(atual.ctx, emEspera);
});

// ---------- atalhos de teclado (só ≥ 900 px) ----------
const ATALHOS = [
  ['A', 'Aprovar (com 5 s para desfazer)'],
  ['R', 'Reprovar'],
  ['J', 'Próxima campanha da lista'],
  ['K', 'Campanha anterior da lista'],
  ['?', 'Mostrar estes atalhos'],
];

function mostrarAtalhos() {
  abrirDialogo({
    titulo: 'Atalhos de teclado',
    descricao: 'Valem no detalhe da campanha, no computador, fora dos campos de texto.',
    corpo: html`<dl class="atalhos">${ATALHOS.map(([k, t]) => html`<div><dt><kbd>${k}</kbd></dt><dd>${t}</dd></div>`)}</dl>`,
    acoes: [{ rotulo: 'Fechar', valor: null, tipo: 'primario', principal: true }],
  });
}

function aoTeclar(e) {
  if (!atual || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
  if (!matchMedia('(min-width: 900px)').matches) return;
  if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (document.querySelector('dialog[open]')) return;
  const { el, ctx, id, lista } = atual;
  const tecla = e.key.toLowerCase();
  if (tecla === 'a' || tecla === 'r') {
    const b = $(tecla === 'a' ? '[data-aprovar]' : '[data-reprovar]', el);
    if (b) { e.preventDefault(); b.click(); }
  } else if ((tecla === 'j' || tecla === 'k') && lista) {
    const ids = lista();
    if (!ids.length) return;
    const i = ids.indexOf(String(id));
    const alvo = tecla === 'j' ? ids[i + 1] ?? (i < 0 ? ids[0] : null) : ids[i - 1] ?? (i < 0 ? ids.at(-1) : null);
    if (alvo) { e.preventDefault(); ctx.navegar(`#/campanhas/${alvo}`, { substituir: true }); }
  } else if (e.key === '?') {
    e.preventDefault();
    mostrarAtalhos();
  }
}

// lista: () => ids da lista filtrada (para J/K), quando o detalhe está ao lado dela.
export function montar(el, ctx, { id, lista = null }) {
  atual = { el, ctx, id, lista, desligar: [] };
  document.addEventListener('keydown', aoTeclar);
  atual.desligar.push(() => document.removeEventListener('keydown', aoTeclar), ligarCopiar(el, ctx.toast));
  atual.desligar.push(
    ao(el, 'click', '[data-aprovar]', () => {
      const c = ctx.campanhas.porId(id);
      if (!c) return;
      // Outra aprovação ainda esperando: grava aquela já e começa esta.
      if (emEspera && String(emEspera.id) !== String(c.id)) gravarAprovacao(ctx, emEspera);
      if (!emEspera) aprovar(ctx, c);
    }),
    ao(el, 'click', '[data-reprovar]', () => { const c = ctx.campanhas.porId(id); if (c) reprovar(ctx, c); }),
    ao(el, 'click', '[data-desfazer]', () => desfazer(ctx, emEspera)),
    ctx.campanhas.assinar(ev => { if (ev.tipo === 'carga' || ev.tipo === 'erro' || String(ev.id) === String(id)) desenhar(); }),
    ctx.cadastros.assinar(() => desenhar()),
  );
  desenhar();
  const meu = atual;
  return () => {
    meu.desligar.forEach(fn => fn());
    if (atual === meu) atual = null;
    ctx.barraDeAcao(false);
  };
}
