// Login, recuperação de senha, convite e checagem do perfil. A sessão aberta por link de e-mail
// (recuperação ou convite) serve só para criar a senha; o papel fica em perfis, protegido por RLS.
import { sb } from './lib/supabase.js';
import { urlAuth, limparUrl } from './lib/url-auth.js';
import { html, pintar, $, armazenamento } from './lib/dom.js';
import { emailValido, SENHA_MIN, problemaSenha } from './lib/regras.js';
import { icone } from './ui/icones.js';
import { campo, interruptor, marcarErro, limparErro } from './ui/campos.js';
import { campoSenha, ligarSenha } from './ui/senha.js';

const C = window.CONFIG;
const el = () => document.getElementById('acesso');

// Enquanto modoRecuperacao for true, a sessão aberta por link de recuperação ou convite só serve para criar a senha.
const LINK_DE_SENHA = ['recovery', 'invite'];
const convite = urlAuth.tipo === 'invite';
let modoRecuperacao = LINK_DE_SENHA.includes(urlAuth.tipo) && !urlAuth.erro;
let pronto = false;
let entrou = false;
let aoEntrarCb = () => {};

// Marca (sem dado pessoal) de que há uma recuperação não terminada. Se a
// pessoa fechar o app sem trocar a senha, a sessão é encerrada na próxima vez.
const CHAVE_RECUPERACAO = 'lynkz_recuperacao_pendente';
const marcarRecuperacao = () => armazenamento.gravar(CHAVE_RECUPERACAO, 1);
const recuperacaoPendente = () => armazenamento.ler(CHAVE_RECUPERACAO) === 1;
async function encerrarRecuperacao() {
  const { error } = await sb.auth.signOut();       // sai em todos os aparelhos
  if (error) await sb.auth.signOut({ scope: 'local' });
  armazenamento.remover(CHAVE_RECUPERACAO);
  modoRecuperacao = false;
}
if (modoRecuperacao) marcarRecuperacao();

// Endereço do app sem # nem ?, para onde o link do e-mail volta.
const URL_APP = location.origin + location.pathname;

function mostrar(conteudo) {
  document.getElementById('splash').hidden = true;
  document.getElementById('app').hidden = true;
  const a = el();
  a.hidden = false;
  pintar(a, html`<main class="acesso-caixa">
    <div class="acesso-marca">
      <img src="assets/logo.png" alt="${C.MARCA || 'LYNKZ'}" width="120" height="28">
      <span>${C.SUBMARCA || 'Campanhas'}</span>
    </div>
    ${conteudo}
    <p class="versao">Versão ${C.VERSAO}</p>
  </main>`);
  const foco = a.querySelector('[autofocus]') || a.querySelector('h1');
  foco?.focus();
}

const msg = (id, texto, tipo = '') => {
  const m = document.getElementById(id);
  if (!m) return;
  m.className = 'acesso-msg' + (tipo ? ' ' + tipo : '');
  pintar(m, texto ? html`${tipo === 'erro' ? icone('alerta') : ''}<span>${texto}</span>` : '');
};

const ocupar = (botao, texto) => {
  const antes = botao.textContent;
  botao.disabled = true; botao.setAttribute('aria-busy', 'true'); botao.textContent = texto;
  return () => { botao.disabled = false; botao.removeAttribute('aria-busy'); botao.textContent = antes; };
};

function telaAcessoVisivel() { return !el().hidden; }

// ---------- login ----------
// Só o e-mail fica no aparelho (nunca a senha). "Sair da conta" não apaga.
const CHAVE_EMAIL = 'lynkz_ultimo_email';
const CHAVE_LEMBRAR = 'lynkz_lembrar_email';
let errosSeguidos = 0;

function mostrarLogin(msgOk = '', email = '') {
  const lembrado = armazenamento.ler(CHAVE_EMAIL);
  const emailIni = email || (typeof lembrado === 'string' ? lembrado : '');
  const lembrar = armazenamento.ler(CHAVE_LEMBRAR) !== false;
  mostrar(html`
    <h1 tabindex="-1">Bem-vindo de volta</h1>
    <p class="acesso-sub">Entre com o e-mail e a senha da empresa.</p>
    <form id="f-login" novalidate>
      ${campo({ id: 'l-email', rotulo: 'E-mail', tipo: 'email', valor: emailIni,
                atributos: { inputmode: 'email', autocomplete: 'username', placeholder: `seuemail@${C.DOMINIO || 'empresa.com.br'}`, autofocus: !emailIni } })}
      ${campoSenha({ id: 'l-senha', rotulo: 'Senha', autocomplete: 'current-password',
                     extraRotulo: html`<button type="button" class="link-acao" id="l-esqueci">Esqueci minha senha</button>` })}
      ${interruptor({ id: 'l-lembrar', rotulo: 'Lembrar meu e-mail neste aparelho', marcado: lembrar, classe: 'sem-caixa' })}
      <button class="btn btn-primario btn-largo" id="l-entrar" type="submit">Entrar</button>
    </form>
    <p id="l-msg" class="acesso-msg${msgOk ? ' ok' : ''}" role="status" aria-live="polite">${msgOk}</p>`);
  const raiz = $('.acesso-caixa', el());   // recriada a cada tela: ouvintes não se acumulam
  ligarSenha(raiz);
  if (emailIni) $('#l-senha').focus();

  const esqueci = () => mostrarPedirLink('Redefinir senha',
    'Informe seu e-mail. Enviaremos um link para você criar uma senha nova.', $('#l-email').value.trim());
  $('#l-esqueci').addEventListener('click', esqueci);
  raiz.addEventListener('click', e => { if (e.target.closest('#l-redefinir')) esqueci(); });
  // Digitar de novo tira a marca de erro do campo.
  raiz.addEventListener('input', e => {
    const c = e.target.closest('.campo.tem-erro');
    if (c) limparErro(raiz, c.dataset.campo);
  });

  $('#f-login').addEventListener('submit', async ev => {
    ev.preventDefault();
    const email = $('#l-email').value.trim().toLowerCase();
    const senha = $('#l-senha').value;
    msg('l-msg', '');
    limparErro(raiz, 'l-email'); limparErro(raiz, 'l-senha');
    // Marca os dois campos de uma vez; o foco vai para o primeiro com erro.
    const erroEmail = !email ? 'Informe o e-mail.' : !emailValido(email) ? 'Digite um e-mail válido.' : '';
    const erroSenha = senha ? '' : 'Informe a senha.';
    if (erroEmail) marcarErro(raiz, 'l-email', erroEmail);
    if (erroSenha) marcarErro(raiz, 'l-senha', erroSenha);
    if (erroEmail || erroSenha) { $(erroEmail ? '#l-email' : '#l-senha').focus(); return; }
    const liberar = ocupar($('#l-entrar'), 'Entrando…');
    const { error } = await sb.auth.signInWithPassword({ email, password: senha });
    if (error) {
      liberar();
      if (/invalid login credentials/i.test(error.message)) {
        errosSeguidos++;
        marcarErro(raiz, 'l-senha', 'E-mail ou senha inválidos.');
        // Depois de 3 erros seguidos, o caminho para redefinir fica à mão.
        if (errosSeguidos >= 3) {
          pintar($('#l-senha-erro'), html`${icone('alerta')}<span>E-mail ou senha inválidos.
            <button type="button" class="link-acao" id="l-redefinir">Esqueceu? Redefina a senha</button></span>`);
        }
        const s = $('#l-senha');
        s.focus();
        s.select();
      } else if (/failed to fetch|network/i.test(error.message)) {
        msg('l-msg', 'Sem conexão. Confira a internet e tente de novo.', 'erro');
      } else {
        console.error('Login:', error);
        msg('l-msg', 'Não foi possível entrar agora. Tente de novo em instantes.', 'erro');
      }
      return;
    }
    errosSeguidos = 0;
    if ($('#l-lembrar').checked) { armazenamento.gravar(CHAVE_EMAIL, email); armazenamento.gravar(CHAVE_LEMBRAR, true); }
    else { armazenamento.remover(CHAVE_EMAIL); armazenamento.gravar(CHAVE_LEMBRAR, false); }
    await verificar();
  });
}

// ---------- recuperação de senha ----------
function mostrarPedirLink(titulo, texto, email = '') {
  modoRecuperacao = false;
  mostrar(html`
    <h1 tabindex="-1">${titulo}</h1>
    <p class="acesso-sub">${texto}</p>
    <form id="f-link" novalidate>
      <div class="campo"><label for="r-email">E-mail</label>
        <input id="r-email" type="email" inputmode="email" autocomplete="email" value="${email}" autofocus></div>
      <button class="btn btn-primario btn-largo" id="r-enviar" type="submit">Enviar link</button>
    </form>
    <button class="btn btn-texto" id="r-voltar" type="button">Voltar ao login</button>
    <p id="r-msg" class="acesso-msg" role="status" aria-live="polite"></p>`);

  // verificar(), não mostrarLogin(): se já houver sessão, volta direto ao app.
  $('#r-voltar').addEventListener('click', () => verificar());
  $('#f-link').addEventListener('submit', async ev => {
    ev.preventDefault();
    const btn = $('#r-enviar');
    if (btn.disabled) return;
    const em = $('#r-email').value.trim().toLowerCase();
    if (!emailValido(em)) { msg('r-msg', 'Digite um e-mail válido.', 'erro'); return; }
    const liberar = ocupar(btn, 'Enviando…');
    const { error } = await sb.auth.resetPasswordForEmail(em, { redirectTo: URL_APP });
    if (error) {
      liberar();
      msg('r-msg', (error.status === 429 || /rate limit/i.test(error.message))
        ? 'Muitos pedidos seguidos. Aguarde alguns minutos e tente de novo.'
        : 'Não foi possível enviar: ' + error.message, 'erro');
      return;
    }
    // Mensagem neutra: não revela se o e-mail tem conta.
    msg('r-msg', 'Se este e-mail tiver acesso, o link chega em instantes. Use só o e-mail mais recente — os anteriores deixam de valer.', 'ok');
    // Espera 60 s antes de permitir novo envio (mesmo limite do Supabase).
    btn.removeAttribute('aria-busy');
    let s = 60;
    const tic = () => {
      if (!btn.isConnected) return;
      if (s <= 0) { btn.disabled = false; btn.textContent = 'Enviar de novo'; return; }
      btn.textContent = `Enviar de novo (${s--}s)`;
      setTimeout(tic, 1000);
    };
    tic();
  });
}

async function mostrarLinkInvalido() {
  // Sessão que sobrou de um link de recuperação não pode seguir valendo.
  if (modoRecuperacao || recuperacaoPendente()) await encerrarRecuperacao();
  mostrarPedirLink(convite ? 'Convite expirado ou já usado' : 'Link expirado ou já usado',
    convite ? 'O link do convite vale por tempo limitado e funciona uma vez só. Peça abaixo um link para criar sua senha.'
      : 'Links de redefinição valem por tempo limitado e funcionam uma vez só. Peça um novo abaixo.');
}

// Modelo de e-mail com token_hash: o código só é gasto quando a pessoa toca
// no botão. Antivírus que "visitam" o link antes dela não o queimam.
function mostrarConfirmarLink() {
  mostrar(html`
    <h1 tabindex="-1">${convite ? 'Bem-vindo' : 'Redefinir senha'}</h1>
    <p class="acesso-sub">Toque em continuar para criar sua ${convite ? '' : 'nova '}senha.</p>
    <form id="f-confirmar"><button class="btn btn-primario btn-largo" id="c-ok" type="submit" autofocus>Continuar</button></form>
    <p id="c-msg" class="acesso-msg" role="status"></p>`);
  $('#f-confirmar').addEventListener('submit', async ev => {
    ev.preventDefault();
    ocupar($('#c-ok'), 'Verificando…');
    modoRecuperacao = true; marcarRecuperacao();
    const { error } = await sb.auth.verifyOtp({ token_hash: urlAuth.tokenHash, type: urlAuth.tipo });
    limparUrl();  // só agora: o código já foi usado (ou recusado)
    if (error) { mostrarLinkInvalido(); return; }
    mostrarNovaSenha();
  });
}

async function mostrarNovaSenha() {
  modoRecuperacao = true;
  // getUser() confirma a sessão no servidor (não confia só no navegador).
  const { data: { user } = {}, error } = await sb.auth.getUser();
  if (error || !user) { mostrarLinkInvalido(); return; }

  // E-mail somente leitura: mostra de qual conta é a senha e ajuda o
  // gerenciador de senhas a salvar no login certo.
  mostrar(html`
    <h1 tabindex="-1">${convite ? 'Crie sua senha' : 'Crie sua nova senha'}</h1>
    <p class="acesso-sub">${convite ? `Mínimo de ${SENHA_MIN} caracteres, sem seu nome nem seu e-mail. Depois de salvar, você já entra no app.` : `Mínimo de ${SENHA_MIN} caracteres, sem seu nome nem seu e-mail. Depois de salvar, entre com a senha nova.`}</p>
    <form id="f-senha" novalidate>
      <div class="campo"><label for="n-email">Conta</label>
        <input id="n-email" type="email" autocomplete="username" value="${user.email || ''}" readonly></div>
      ${campoSenha({ id: 'n-senha', rotulo: 'Nova senha', novo: true })}
      ${campoSenha({ id: 'n-senha2', rotulo: 'Confirme a nova senha', autocomplete: 'new-password' })}
      <button class="btn btn-primario btn-largo" id="n-ok" type="submit">${convite ? 'Salvar e entrar' : 'Salvar nova senha'}</button>
    </form>
    <button class="btn btn-texto" id="n-cancelar" type="button">Cancelar</button>
    <p id="n-msg" class="acesso-msg" role="status" aria-live="polite"></p>`);

  const pessoa = { email: user.email, nome: user.user_metadata?.nome || '' };
  ligarSenha($('.acesso-caixa', el()), { email: () => pessoa.email, nome: () => pessoa.nome });
  $('#n-senha').focus();
  $('#n-cancelar').addEventListener('click', async () => { await encerrarRecuperacao(); mostrarLogin(); });
  $('#f-senha').addEventListener('submit', async ev => {
    ev.preventDefault();
    const s1 = $('#n-senha').value, s2 = $('#n-senha2').value;
    const problema = problemaSenha(s1, pessoa);
    if (problema) { msg('n-msg', problema, 'erro'); return; }
    if (s1 !== s2) { msg('n-msg', 'As duas senhas não são iguais.', 'erro'); return; }
    const liberar = ocupar($('#n-ok'), 'Salvando…');
    const { error: e2 } = await sb.auth.updateUser({ password: s1 });
    if (e2) {
      liberar();
      if (e2.code === 'same_password') msg('n-msg', 'A nova senha precisa ser diferente da anterior.', 'erro');
      else if (e2.code === 'weak_password') msg('n-msg', 'Senha fraca. Use mais caracteres, misturando letras e números.', 'erro');
      else if (/session|jwt|expired/i.test(e2.code || e2.message)) mostrarLinkInvalido();
      else msg('n-msg', 'Não foi possível salvar: ' + e2.message, 'erro');
      return;
    }
    // Convite: a conta já está liberada, então entra direto.
    if (convite) {
      modoRecuperacao = false;
      armazenamento.remover(CHAVE_RECUPERACAO);
      await verificar();
      return;
    }
    // Recuperação: encerra a sessão do link em todos os aparelhos e pede login com a senha nova.
    const email = user.email;
    await encerrarRecuperacao();
    mostrarLogin('Senha alterada. Entre com a nova senha.', email);
  });
}

// ---------- avisos de acesso ----------
function mostrarAviso(titulo, texto) {
  mostrar(html`
    <h1 tabindex="-1">${titulo}</h1>
    <p class="acesso-sub">${texto}</p>
    <button class="btn btn-fantasma btn-largo" id="a-sair" type="button">Sair</button>`);
  $('#a-sair').addEventListener('click', sair);
}

// ---------- decisão: login ou app ----------
// Login direto e evento SIGNED_IN podem chegar juntos: uma verificação por vez.
let verificando = null;
function verificar() {
  verificando ??= verificarAgora().finally(() => { verificando = null; });
  return verificando;
}
async function verificarAgora() {
  if (modoRecuperacao) { mostrarNovaSenha(); return; }
  const { data: { session } = {} } = await sb.auth.getSession();
  if (!session) { mostrarLogin(); return; }
  const { data: p, error } = await sb.from('perfis').select('*').eq('id', session.user.id).maybeSingle();
  if (error) {
    mostrarAviso('Não foi possível abrir', /failed to fetch|network/i.test(error.message)
      ? 'Sem conexão. Confira a internet e tente de novo.' : 'Erro ao ler seu perfil: ' + error.message);
    return;
  }
  if (!p) { mostrarAviso('Perfil não encontrado', 'Sua conta entrou, mas o perfil não foi criado. Fale com a gerência.'); return; }
  if (!p.ativo) { mostrarAviso('Acesso não liberado', 'Seu acesso ainda não foi liberado ou foi desativado. Peça à gerência para liberar.'); return; }
  if (entrou) return;
  entrou = true;
  el().hidden = true;
  pintar(el(), '');
  aoEntrarCb(p);
}

export async function sair() {
  try { await sb.auth.signOut(); } catch { /* sem rede: sai neste aparelho */ await sb.auth.signOut({ scope: 'local' }); }
  location.reload();
}

// Sessão do projeto Supabase anterior, removida do aparelho.
const CHAVES_ANTIGAS = ['sb-kdznytksxtjmuqwrqxka-auth-token'];

// Espera o Supabase ler o link do e-mail (se houver), limpa a URL e decide a tela. aoEntrar(perfil) roda uma vez.
export async function iniciarAcesso({ aoEntrar }) {
  aoEntrarCb = aoEntrar;
  for (const k of CHAVES_ANTIGAS) { try { localStorage.removeItem(k); } catch { /* sem armazenamento */ } }
  sb.auth.onAuthStateChange(evt => {
    if (evt === 'PASSWORD_RECOVERY') {
      if (!modoRecuperacao) { modoRecuperacao = true; marcarRecuperacao(); if (pronto) mostrarNovaSenha(); }
      return;
    }
    if (!pronto || modoRecuperacao) return;
    // SIGNED_IN também dispara ao voltar para a aba: só interessa com a tela de acesso aberta.
    if (evt === 'SIGNED_IN' && telaAcessoVisivel()) setTimeout(verificar, 0);
    if (evt === 'SIGNED_OUT' && entrou) location.reload();
  });

  await sb.auth.getSession();
  const linkTokenHash = !!urlAuth.tokenHash && LINK_DE_SENHA.includes(urlAuth.tipo) && !urlAuth.erro;
  if (!linkTokenHash) limparUrl();          // o token_hash só sai depois de usado
  if (!modoRecuperacao && recuperacaoPendente()) await encerrarRecuperacao();
  pronto = true;
  if (urlAuth.erro) { mostrarLinkInvalido(); return; }
  if (linkTokenHash) { mostrarConfirmarLink(); return; }
  await verificar();
}
