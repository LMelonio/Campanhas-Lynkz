// ============================================================
//  APP — casca, rotas por hash e contexto das telas.
//
//  Rotas:  #/inicio  #/campanhas  #/campanhas/:id  #/nova  #/nova/de/:id
//          #/historico  #/gestao  #/gestao/empresas/:id  #/perfil  #/usuarios (só administrador)
//
//  Cada tela exporta montar(el, ctx, params) → desmontar e, se fizer
//  sentido, atualizar(params) (troca de parâmetro sem remontar a tela).
// ============================================================
import { iniciarAcesso, sair as sairDaConta } from './acesso.js';
import { campanhas } from './dados/campanhas.js';
import { cadastros } from './dados/cadastros.js';
import { conferirBanco } from './dados/saude.js';
import { usuarios } from './dados/usuarios.js';
import { sb } from './lib/supabase.js';
import { html, pintar, $, $$ } from './lib/dom.js';
import { PAPEL, STATUS, brl, calc, rotuloPapel } from './lib/regras.js';
import { toast, confirmar } from './ui/avisos.js';
import { icone } from './ui/icones.js';
import { carregando } from './ui/pecas.js';
import * as telaInicio from './telas/inicio.js';
import * as telaCampanhas from './telas/campanhas.js';
import * as telaNova from './telas/nova.js';
import * as telaHistorico from './telas/historico.js';
import * as telaGestao from './telas/gestao.js';
import * as telaPerfil from './telas/perfil.js';
import * as telaUsuarios from './telas/usuarios.js';

const C = window.CONFIG;

// Versão destes módulos. Igual à VERSAO de config.js e sw.js (o teste do lote S confere).
// Logo depois de publicar, o config.js já chega novo pela rede, mas os módulos podem vir
// da cópia guardada da versão anterior: a tela ficava misturada até a segunda recarga (v2.9).
export const VERSAO_APP = '2.9.1';
const CHAVE_RECARGA = 'lynkz-recarregou-para';

const TELAS = {
  inicio: telaInicio, campanhas: telaCampanhas, nova: telaNova,
  historico: telaHistorico, gestao: telaGestao, perfil: telaPerfil, usuarios: telaUsuarios,
};

const ROTAS = [
  [/^\/inicio$/,                 'inicio',    () => ({})],
  [/^\/campanhas$/,              'campanhas', () => ({})],
  [/^\/campanhas\/(\d+)$/,       'campanhas', m => ({ id: m[1] })],
  [/^\/nova$/,                   'nova',      () => ({})],
  [/^\/nova\/de\/(\d+)$/,        'nova',      m => ({ de: m[1] })],
  [/^\/historico$/,              'historico', () => ({})],
  [/^\/gestao$/,                 'gestao',    () => ({})],
  [/^\/gestao\/empresas\/(\d+)$/, 'gestao',   m => ({ empresa: m[1] })],
  [/^\/perfil$/,                 'perfil',    () => ({})],
  [/^\/usuarios$/,               'usuarios',  () => ({})],
];

// "#/campanhas?status=Pendente" → caminho "/campanhas", query { status: 'Pendente' }.
// O "caminho" devolvido inclui a query: mudar só a query também atualiza a tela.
function resolver(hash) {
  const bruto = (hash || '').replace(/^#/, '');
  const [caminho, busca = ''] = bruto.split('?');
  const query = Object.fromEntries(new URLSearchParams(busca));
  for (const [re, nome, params] of ROTAS) {
    const m = caminho.match(re);
    if (m) return { nome, params: { ...params(m), query }, caminho: bruto };
  }
  return null;
}

const NAV = [
  { nome: 'inicio',    rotulo: 'Início',    href: '#/inicio',    ico: 'inicio' },
  { nome: 'campanhas', rotulo: 'Campanhas', href: '#/campanhas', ico: 'campanhas', contador: true },
  { nome: 'historico', rotulo: 'Histórico', href: '#/historico', ico: 'historico' },
  { nome: 'gestao',    rotulo: 'Gestão',    href: '#/gestao',    ico: 'gestao' },
  { nome: 'usuarios',  rotulo: 'Usuários',  href: '#/usuarios',  ico: 'pessoa', soAdmin: true, contadorUsuarios: true },
  { nome: 'perfil',    rotulo: 'Perfil',    href: '#/perfil',    ico: 'perfil' },
];

let atual = null;          // { nome, params, caminho, desmontar }
let indiceHistorico = 0;

// ---------- contexto entregue às telas ----------
const ctx = {
  perfil: null,
  ehAprovador: false,
  campanhas,
  cadastros,
  toast,

  // Navega para "#/rota". substituir: não cria entrada no histórico.
  navegar(rota, { substituir = false } = {}) {
    if (!rota.startsWith('#')) rota = '#' + rota;
    if (rota === location.hash && !substituir) { aplicarRota(); return; }
    if (substituir) history.replaceState({ i: indiceHistorico }, '', rota);
    else history.pushState({ i: ++indiceHistorico }, '', rota);
    aplicarRota();
  },

  // Cabeçalho da tela: título, rota de volta (opcional) e ações à direita.
  cabecalho({ titulo, voltar = null, acoes = '' }) {
    $('#titulo').textContent = titulo;
    document.title = `${titulo} · ${C.MARCA || 'LYNKZ'}`;
    const v = $('#voltar');
    v.hidden = !voltar;
    if (voltar) v.setAttribute('href', voltar);
    $('#abrir-menu').classList.toggle('com-voltar', !!voltar);
    pintar($('#topo-acoes'), acoes);
  },

  // Esconde a barra inferior no celular (telas com barra de ação própria).
  barraDeAcao(ligada) { document.body.classList.toggle('sem-barra', !!ligada); },

  remontar() { montarRota(resolver(location.hash) || resolver('#/inicio')); },

  sair,
};

async function sair() {
  // Rascunho não enviado: perguntar antes de apagar.
  telaNova.gravarRascunhoAgora();
  if (telaNova.temRascunho()) {
    const ok = await confirmar({
      titulo: 'Sair e descartar o rascunho?',
      descricao: 'A campanha que você começou não foi enviada e será apagada deste aparelho.',
      confirmar: 'Sair mesmo assim', perigo: true,
    });
    if (!ok) return;
  }
  telaNova.limparRascunho();
  campanhas.parar();
  cadastros.parar();
  await sairDaConta();
}

// ---------- rotas ----------
function aplicarRota() {
  // Banco desatualizado: nenhuma tela abre até "Tentar de novo" dar certo.
  if (emManutencao) { fecharMenu(); return; }
  const r = resolver(location.hash);
  if (!r) { ctx.navegar('#/inicio', { substituir: true }); return; }
  fecharMenu();
  if (atual && atual.nome === r.nome && TELAS[r.nome].atualizar && atual.caminho !== r.caminho) {
    atual.caminho = r.caminho;
    atual.params = r.params;
    TELAS[r.nome].atualizar(r.params);
    marcarNav(r.nome);
    return;
  }
  if (atual && atual.caminho === r.caminho) return;
  montarRota(r);
}

function montarRota(r) {
  if (atual?.desmontar) {
    try { atual.desmontar(); } catch (e) { console.error(e); }
  }
  const el = $('#conteudo');
  ctx.barraDeAcao(false);
  ctx.cabecalho({ titulo: '' });
  pintar(el, '');
  el.scrollTop = 0;
  window.scrollTo(0, 0);
  atual = { ...r, desmontar: null };
  try {
    atual.desmontar = TELAS[r.nome].montar(el, ctx, r.params) || null;
  } catch (e) {
    console.error(e);
    pintar(el, html`<p class="nota nota-alerta">${icone('alerta')}<span>Esta tela não abriu: ${e.message}</span></p>`);
  }
  marcarNav(r.nome);
  // Leitor de tela anuncia a troca de tela pelo título.
  if (document.activeElement === document.body || !el.contains(document.activeElement)) el.focus({ preventScroll: true });
}

function marcarNav(nome) {
  $$('[data-nav]').forEach(a => {
    if (a.dataset.nav === nome) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

// ---------- casca ----------
function montarCasca() {
  const p = ctx.perfil;
  pintar($('#abrir-menu'), icone('menu'));
  pintar($('#voltar'), icone('voltar'));

  pintar($('#menu'), html`
    <div class="menu-marca"><img src="assets/logo.png" alt="${C.MARCA || 'LYNKZ'}" width="96" height="22"><span>${C.SUBMARCA || 'Campanhas'}</span></div>
    <a class="btn btn-primario btn-largo menu-nova" href="#/nova" data-nav="nova">${icone('mais')} Nova campanha</a>
    <ul class="menu-lista">
      ${NAV.filter(n => !n.soAdmin || ctx.ehAprovador).map(n => html`<li><a class="menu-item" href="${n.href}" data-nav="${n.nome}">${icone(n.ico)}${n.rotulo}${n.contador ? html`<span class="contador" data-contador hidden></span>` : ''}${n.contadorUsuarios ? html`<span class="contador" data-contador-usuarios hidden></span>` : ''}</a></li>`)}
    </ul>
    <div class="menu-rodape">
      <p class="menu-usuario">${p.nome}<small>${rotuloPapel(p.papel)} · ${p.email}</small></p>
      <button class="btn btn-fantasma btn-pequeno" type="button" id="menu-sair">${icone('sair')} Sair</button>
      <p class="versao">Versão ${C.VERSAO}</p>
    </div>`);

  pintar($('#barra-inferior'), html`
    <a class="bi-item" href="#/inicio" data-nav="inicio">${icone('inicio')}Início</a>
    <a class="bi-item" href="#/campanhas" data-nav="campanhas">${icone('campanhas')}Campanhas<span class="contador" data-contador hidden></span></a>
    <a class="bi-item bi-nova" href="#/nova" data-nav="nova" aria-label="Nova campanha"><span>${icone('mais')}</span></a>
    <a class="bi-item" href="#/gestao" data-nav="gestao">${icone('gestao')}Gestão</a>
    <a class="bi-item" href="#/perfil" data-nav="perfil">${icone('perfil')}Perfil</a>`);

  pintar($('#offline'), html`${icone('offline')}Sem conexão — mostrando o que já estava carregado`);

  // Links "#/…" passam pelo roteador (pushState com índice, para o Voltar).
  document.addEventListener('click', e => {
    const a = e.target instanceof Element && e.target.closest('a[href^="#/"]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    ctx.navegar(a.getAttribute('href'));
  });
  // Voltar do cabeçalho: usa o histórico do app quando existe.
  $('#voltar').addEventListener('click', e => {
    e.preventDefault();
    if ((history.state?.i ?? 0) > 0) history.back();
    else ctx.navegar($('#voltar').getAttribute('href'), { substituir: true });
  }, true);
  $('#pular').addEventListener('click', e => { e.preventDefault(); $('#conteudo').focus(); });

  // "Tentar de novo" das listas e da faixa de erro.
  document.addEventListener('click', async e => {
    const b = e.target instanceof Element && e.target.closest('[data-tentar-de-novo]');
    if (b) {
      b.disabled = true; b.setAttribute('aria-busy', 'true');
      await carregarDados();
      if (b.isConnected) { b.disabled = false; b.removeAttribute('aria-busy'); }
    }
    if (e.target instanceof Element && e.target.closest('[data-faixa-fechar]')) esconderFaixaErro();
  });

  $('#abrir-menu').addEventListener('click', abrirMenu);
  $('#menu-fundo').addEventListener('click', fecharMenu);
  $('#menu-sair').addEventListener('click', sair);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('menu-aberto')) fecharMenu(); });

  window.addEventListener('popstate', () => { indiceHistorico = history.state?.i ?? 0; aplicarRota(); });
  window.addEventListener('hashchange', () => {
    // Endereço digitado à mão: registra o índice e segue.
    if (history.state?.i == null) history.replaceState({ i: ++indiceHistorico }, '', location.hash);
    aplicarRota();
  });

  const conexao = () => { $('#offline').hidden = navigator.onLine; };
  window.addEventListener('online', conexao);
  window.addEventListener('offline', conexao);
  conexao();
}

// ---------- menu lateral (celular) ----------
let quemAbriu = null;
const ehDesktop = () => matchMedia('(min-width: 900px)').matches;

function abrirMenu(e) {
  if (ehDesktop()) return;
  quemAbriu = e?.currentTarget || document.activeElement;
  document.body.classList.add('menu-aberto');
  $('#menu-fundo').hidden = false;
  ['#conteudo', '#topo', '#barra-inferior'].forEach(s => { $(s).inert = true; });
  $$('[aria-controls="menu"]').forEach(b => b.setAttribute('aria-expanded', 'true'));
  $('#menu a, #menu button')?.focus();
}

function fecharMenu() {
  if (!document.body.classList.contains('menu-aberto')) return;
  document.body.classList.remove('menu-aberto');
  $('#menu-fundo').hidden = true;
  ['#conteudo', '#topo', '#barra-inferior'].forEach(s => { $(s).inert = false; });
  $$('[aria-controls="menu"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
  if (quemAbriu?.isConnected) quemAbriu.focus();
  quemAbriu = null;
}
// O menu fica fora do "inert" no desktop; ao virar desktop com ele aberto, fecha.
matchMedia('(min-width: 900px)').addEventListener('change', fecharMenu);

// ---------- contas esperando liberação (só administrador, v2.9) ----------
function contarSemAcesso(n = usuarios.semAcesso()) {
  // Celular: o menu só abre pelo ☰ do topo (v2.9.1); um ponto nele avisa que há contas esperando.
  const botao = $('#abrir-menu');
  if (botao) {
    botao.classList.toggle('com-aviso', !!n);
    botao.setAttribute('aria-label', n ? `Abrir menu (${n} ${n === 1 ? 'conta esperando' : 'contas esperando'} liberação)` : 'Abrir menu');
  }
  $$('[data-contador-usuarios]').forEach(s => {
    s.hidden = !n;
    s.textContent = n > 99 ? '99+' : String(n || 0);
    s.setAttribute('aria-label', `${n} ${n === 1 ? 'conta esperando' : 'contas esperando'} liberação`);
  });
}
let usuariosLigados = false;
function ligarContagemUsuarios() {
  if (!ctx.ehAprovador) return;
  if (!usuariosLigados) {
    usuariosLigados = true;
    usuarios.assinar(contarSemAcesso);
    // Volta para o app: conta de novo (alguém pode ter criado conta nesse meio-tempo).
    document.addEventListener('visibilitychange', () => { if (!document.hidden && ctx.ehAprovador) usuarios.contarSemAcesso(); });
  }
  contarSemAcesso();
  usuarios.contarSemAcesso();
}

// ---------- contador de pendentes ----------
// Aprovador: todas as pendentes. Coordenador: só as dele.
function contarPendentes() {
  const pend = campanhas.pendentes();
  const n = ctx.ehAprovador ? pend.length : pend.filter(c => c.solicitante_id === ctx.perfil.id).length;
  $$('[data-contador]').forEach(s => {
    s.hidden = !n;
    s.textContent = n > 99 ? '99+' : String(n);
    s.setAttribute('aria-label', `${n} pendente${n === 1 ? '' : 's'}`);
  });
}

function avisarNovidades(ev) {
  if (ev.tipo !== 'linha' || ev.origem !== 'remota' || !ev.campanha) return;
  const c = ev.campanha;
  if (ev.nova && ctx.ehAprovador && c.status === STATUS.PENDENTE && c.solicitante_id !== ctx.perfil.id) {
    toast(`Nova campanha aguardando você: ${c.cliente} · R$ ${brl(calc(c).total)}`, {
      acao: { rotulo: 'Ver', aoClicar: () => ctx.navegar(`#/campanhas/${c.id}`) }, duracao: 8000,
    });
    if (navigator.vibrate) navigator.vibrate(140);
  } else if (!ev.nova && c.solicitante_id === ctx.perfil.id && c.status !== STATUS.PENDENTE && !ctx.ehAprovador) {
    toast(`Sua campanha ${c.campanha} foi ${c.status.toLowerCase()}.`, {
      tom: c.status === STATUS.APROVADA ? 'sucesso' : 'erro',
      acao: { rotulo: 'Ver', aoClicar: () => ctx.navegar(`#/campanhas/${c.id}`) }, duracao: 8000,
    });
  }
}

// ---------- banco desatualizado ----------
let emManutencao = false;

function mostrarManutencao(falta) {
  emManutencao = true;
  if (atual?.desmontar) { try { atual.desmontar(); } catch (e) { console.error(e); } }
  atual = null;
  document.body.classList.add('manutencao');
  ctx.barraDeAcao(false);
  ctx.cabecalho({ titulo: 'Sistema em atualização' });
  marcarNav('');
  pintar($('#conteudo'), html`<section class="manutencao-caixa" aria-labelledby="manut-t">
    <span class="manutencao-icone">${icone('alerta')}</span>
    <h2 id="manut-t">Sistema em atualização</h2>
    <p>O banco de dados ainda não recebeu a atualização desta versão. Avise a gerência. Suas campanhas estão salvas.</p>
    <button type="button" class="btn btn-primario" id="manut-tentar">${icone('repetir')} Tentar de novo</button>
    <details class="manutencao-detalhes">
      <summary>Detalhes para o TI</summary>
      <p>Falta no banco (rode a migração indicada no SQL Editor do Supabase e depois a 06 para conferir):</p>
      <ul>${falta.map(f => html`<li><code>${f.tabela}</code> → <code>sql/migracoes/${f.migracao}</code></li>`)}</ul>
    </details>
  </section>`);
  $('#manut-tentar').addEventListener('click', async e => {
    const b = e.currentTarget;
    b.disabled = true; b.setAttribute('aria-busy', 'true');
    await iniciarDados();
    if (b.isConnected) { b.disabled = false; b.removeAttribute('aria-busy'); }
  });
}

// ---------- faixa de erro de carga (fica até fechar ou dar certo) ----------
function mostrarFaixaErro(msg) {
  const f = $('#faixa-erro');
  pintar(f, html`${icone('alerta')}<span>${msg}</span>
    <button type="button" class="btn btn-texto" data-tentar-de-novo>Tentar de novo</button>
    <button type="button" class="btn-icone" data-faixa-fechar aria-label="Fechar aviso">${icone('x')}</button>`);
  f.hidden = false;
}
const esconderFaixaErro = () => { $('#faixa-erro').hidden = true; };

// Carrega campanhas e cadastros. Erro não vira aviso flutuante: vira faixa
// fixa e o estado "Não foi possível carregar" de cada lista.
async function carregarDados() {
  const erros = [];
  await Promise.all([
    campanhas.carregar().catch(e => erros.push(e.message)),
    cadastros.carregar().catch(e => erros.push(e.message)),
  ]);
  if (erros.length) mostrarFaixaErro(erros[0]); else esconderFaixaErro();
  return !erros.length;
}

// ---------- entrada ----------
let dadosLigados = false;

async function iniciarDados() {
  if (!emManutencao) pintar($('#conteudo'), carregando(4));
  const saude = await conferirBanco();
  if (!saude.ok && saude.falta.length) { mostrarManutencao(saude.falta); return; }
  emManutencao = false;
  document.body.classList.remove('manutencao');

  await carregarDados();
  if (!dadosLigados) {
    dadosLigados = true;
    campanhas.aoVivo();
    cadastros.aoVivo();
    campanhas.assinar(contarPendentes);
    campanhas.assinar(avisarNovidades);
  }
  contarPendentes();
  ligarContagemUsuarios();

  if (!resolver(location.hash)) history.replaceState({ i: indiceHistorico }, '', '#/inicio');
  else history.replaceState({ i: indiceHistorico }, '', location.hash);
  atual = null;
  aplicarRota();
}

async function entrar(perfil) {
  ctx.perfil = perfil;
  ctx.ehAprovador = perfil.papel === PAPEL.APROVADOR;
  try { ctx.ultimoAcesso = (await sb.auth.getSession()).data.session?.user?.last_sign_in_at ?? null; }
  catch { ctx.ultimoAcesso = null; }
  montarCasca();
  $('#splash').hidden = true;
  $('#app').hidden = false;
  await iniciarDados();
}

// Versão misturada: apaga as cópias guardadas e recarrega UMA vez por aba (sem loop).
// Se a diferença continuar depois disso, só registra no console e segue.
function versaoMisturada() {
  if (!C.VERSAO || C.VERSAO === VERSAO_APP) return false;
  let jaRecarregou = null;
  try { jaRecarregou = sessionStorage.getItem(CHAVE_RECARGA); } catch { /* sem sessionStorage: recarrega uma vez mesmo */ }
  if (jaRecarregou === C.VERSAO) {
    console.warn(`Versão misturada: config.js ${C.VERSAO}, módulos ${VERSAO_APP}. Já recarregou nesta aba; seguindo assim.`);
    return false;
  }
  try { sessionStorage.setItem(CHAVE_RECARGA, C.VERSAO); } catch { /* idem */ }
  const aviso = $('#splash span:last-child');
  if (aviso) aviso.textContent = `Atualizando para a versão ${C.VERSAO}…`;
  const apagar = 'caches' in window ? caches.keys().then(ns => Promise.all(ns.map(n => caches.delete(n)))) : Promise.resolve();
  apagar.catch(() => {}).finally(() => location.reload());
  return true;
}

if (!versaoMisturada()) {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  iniciarAcesso({ aoEntrar: entrar }).catch(falhaAoAbrir);
}

function falhaAoAbrir(e) {
  console.error(e);
  $('#splash').hidden = true;
  const a = $('#acesso');
  a.hidden = false;
  pintar(a, html`<main class="acesso-caixa"><h1>Não foi possível abrir o app</h1><p class="acesso-sub">${e.message}</p>
    <button class="btn btn-primario btn-largo" type="button" id="recarregar">Tentar de novo</button></main>`);
  $('#recarregar').addEventListener('click', () => location.reload());
}
