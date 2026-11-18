import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const C  = window.CONFIG;

/* Parâmetros de autenticação que o Supabase coloca na URL ao voltar de um
   link de e-mail. Lidos ANTES de criar o cliente, porque ele consome o
   trecho depois do # e nós limpamos a barra de endereço em seguida.
   - #access_token=…&type=recovery   → link de recuperação válido
   - #error=…&error_code=otp_expired → link expirado, já usado ou inválido
   - ?token_hash=…&type=recovery     → modelo de e-mail à prova de antivírus
                                       (ver COMECE-AQUI.md) */
function lerUrlAuth(){
  const h = new URLSearchParams(location.hash.replace(/^#/,''));
  const q = new URLSearchParams(location.search);
  const pega = k => h.get(k) || q.get(k);
  return {
    erro:      pega('error_code') || pega('error'),
    tipo:      pega('type'),
    tokenHash: q.get('token_hash'),
  };
}
const urlAuth = lerUrlAuth();

const sb = createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);

// Enquanto true, a sessão aberta pelo link de recuperação só serve para
// definir a senha nova — iniciar() não entra no app.
let modoRecuperacao = urlAuth.tipo === 'recovery' && !urlAuth.erro;
let pronto = false;

/* Marca (sem nenhum dado pessoal) de que existe uma sessão aberta por link de
   recuperação que ainda não terminou. Se a pessoa fechar o app sem trocar a
   senha, na próxima abertura essa sessão é encerrada — ela nunca vira um
   login comum. */
const CHAVE_RECUPERACAO = 'lynkz_recuperacao_pendente';
const marcarRecuperacao = () => { try { localStorage.setItem(CHAVE_RECUPERACAO, '1'); } catch {} };
const recuperacaoPendente = () => { try { return localStorage.getItem(CHAVE_RECUPERACAO) === '1'; } catch { return false; } };
async function encerrarRecuperacao(){
  // Sai em todos os aparelhos; se a rede falhar, ao menos sai neste.
  const { error } = await sb.auth.signOut();
  if(error) await sb.auth.signOut({ scope: 'local' });
  try { localStorage.removeItem(CHAVE_RECUPERACAO); } catch {}
  modoRecuperacao = false;
}
if(modoRecuperacao) marcarRecuperacao();

let dados = [], perfil = null, alvo = null, canal = null;
let filtro = 'Pendente', busca = '', abaAtual = 'inicio', voltarPara = 'lista';

/* ---------------- utilidades ---------------- */
const brl  = n => Number(n||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const brl0 = n => Number(n||0).toLocaleString('pt-BR',{maximumFractionDigits:0});
const dt   = s => s ? String(s).slice(0,10).split('-').reverse().join('/') : '—';
const esc  = s => String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const normaliza = s => String(s??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
const dias = (a,b) => (a&&b) ? Math.round((new Date(b)-new Date(a))/864e5)+1 : null;
const $    = id => document.getElementById(id);

/* ---------------- Swile: máscaras e validação ----------------
   Espelham em JS a mesma regra que vive em schema.sql (cpf_valido() e a
   constraint campanhas_swile_valido), para dar feedback na hora — mas quem
   de fato barra dado inválido é sempre o banco. */
const soDigitos = s => String(s||'').replace(/\D/g,'');

function maskCPF(v){
  const d = soDigitos(v).slice(0,11);
  return d.replace(/(\d{3})(\d)/,'$1.$2')
          .replace(/(\d{3})(\d)/,'$1.$2')
          .replace(/(\d{3})(\d{1,2})$/,'$1-$2');
}
function maskTelefone(v){
  const d = soDigitos(v).slice(0,11);
  if(d.length > 10) return d.replace(/(\d{2})(\d{5})(\d{0,4})/, (m,a,b,c)=>`(${a}) ${b}${c?'-'+c:''}`);
  if(d.length > 6)  return d.replace(/(\d{2})(\d{4})(\d{0,4})/, (m,a,b,c)=>`(${a}) ${b}${c?'-'+c:''}`);
  if(d.length > 2)  return d.replace(/(\d{2})(\d{0,4})/, (m,a,b)=>`(${a}) ${b}`);
  if(d.length > 0)  return `(${d}`;
  return '';
}
// Algoritmo oficial dos dígitos verificadores (módulo 11) + rejeição de
// sequências repetidas (000.000.000-00 etc.), que passam na conta mas não
// são CPFs reais.
function cpfValido(cpf){
  const d = soDigitos(cpf);
  if(d.length !== 11) return false;
  if(/^(\d)\1{10}$/.test(d)) return false;
  const n = d.split('').map(Number);
  const dv = fatorInicial => {
    let soma = 0, peso = fatorInicial;
    for(let i=0; i<fatorInicial-1; i++) soma += n[i]*peso--;
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return dv(10)===n[9] && dv(11)===n[10];
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* Custo real = investimento LYNKZ + investimento indústria + rebate estimado (devido se o cliente bater a meta) */
function calc(c){
  const invL=+c.investimento_lynkz||0, invI=+c.investimento_industria||0, inv=invL+invI;
  const meta=+c.meta||0, pct=+c.rebate_pct||0, teto=+c.rebate_teto||0;
  let reb = (meta>0 && pct>0) ? meta*(pct/100) : 0;
  const limitado = teto>0 && reb>teto;
  if(limitado) reb = teto;
  const total = inv+reb;
  return {invL, invI, inv, meta, reb, total, limitado, pctMeta: meta>0 ? total/meta : null};
}
function banda(p){
  if(p==null)              return {cor:'var(--ink-3)',  txt:'sem meta informada'};
  if(p<=C.FAIXA_VERDE)     return {cor:'var(--green)',  txt:'dentro do padrão'};
  if(p<=C.FAIXA_AMARELA)   return {cor:'var(--amber)',  txt:'atenção'};
  return                          {cor:'var(--red)',    txt:'acima do padrão'};
}
const selo = s => s==='Aprovada' ? 'b-ok' : s==='Reprovada' ? 'b-no' : 'b-wait';

function toast(msg){
  const t=$('toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(t._x); t._x=setTimeout(()=>t.classList.remove('show'),3000);
}
const ICO = {
  relogio:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 1.9"/></svg>',
  check:'<svg viewBox="0 0 24 24"><path d="M4 12.5l5.5 5.5L20 7"/></svg>',
  lista:'<svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13"/></svg>',
  baixar:'<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M4 20h16"/></svg>',
  busca:'<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>',
  alerta:'<svg viewBox="0 0 24 24"><path d="M12 3.5L21.5 20h-19L12 3.5z"/><path d="M12 9.5v5"/><path d="M12 17.3v.1"/></svg>',
  cadeado:'<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 018 0V11"/></svg>',
  rascunho:'<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/></svg>'
};
const PIN = `<svg class="pin" viewBox="0 0 34 38"><path d="M17 1C8.7 1 2 7.7 2 16c0 10.5 13.2 20.4 13.8 20.8a2 2 0 002.4 0C18.8 36.4 32 26.5 32 16 32 7.7 25.3 1 17 1z" fill="var(--red)"/><circle cx="17" cy="15.5" r="8.5" fill="#fff"/><path d="M12.7 15.6l3 3 5.6-6" stroke="var(--red)" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const LOGO = `<div class="logo">${PIN}<div class="wordmark"><img src="logo.png" alt="LYNKZ"><span>${'{SUB}'}</span></div></div>`;
const marca = () => LOGO.replace('{SUB}', (C.SUBMARCA||'CAMPANHAS'));

/* ---------------- acesso ---------------- */
async function iniciar(){
  const { data:{ session } } = await sb.auth.getSession();
  if(modoRecuperacao){ session ? mostrarNovaSenha() : mostrarLinkInvalido(); return; }
  if(!session){ mostrarLogin(); return; }

  const { data:p, error } = await sb.from('perfis').select('*').eq('id', session.user.id).single();
  if(error || !p){ aviso('Perfil não encontrado','Sua conta entrou, mas o perfil não foi criado. Rode o schema.sql no Supabase e tente de novo.'); return; }
  if(!p.ativo){ aviso('Acesso desativado','Fale com a gerência para reativar seu acesso.'); return; }

  perfil = p;
  $('gate').hidden = true;
  $('app').hidden  = false;
  await carregar();
  escutar();
  irPara(perfil.papel==='aprovador' ? 'inicio' : 'lista');
}

function aviso(titulo, texto){
  $('app').hidden = true; $('gate').hidden = false;
  $('gate').innerHTML = `<div class="gate-in">
    ${marca()}
    <h2>${esc(titulo)}</h2><p class="sub">${esc(texto)}</p>
    <button class="btn btn-ghost" id="sair-x">Sair</button></div>`;
  $('sair-x').onclick = sair;
}

// msgOk/email: usados ao voltar da troca de senha ("Senha alterada…").
function mostrarLogin(msgOk, email){
  $('app').hidden = true; $('gate').hidden = false;
  $('gate').innerHTML = `
    <div class="gate-in">
      ${marca()}
      <h2>Bem-vindo de volta</h2>
      <p class="sub">Entre com o e-mail e a senha da empresa.</p>
      <div class="field"><label>E-mail</label>
        <input id="g-email" type="email" inputmode="email" autocomplete="email" placeholder="seuemail@${esc(C.DOMINIO||'empresa.com.br')}" value="${esc(email||'')}"></div>
      <div class="field"><label>Senha</label>
        <input id="g-senha" type="password" autocomplete="current-password" placeholder="Sua senha"></div>
      <button class="btn btn-red" id="g-send">Entrar</button>
      <button class="gate-link" id="g-esqueci" type="button">Esqueci minha senha</button>
      <p class="gate-msg${msgOk?' ok':''}" id="g-msg">${esc(msgOk||'')}</p>
      <p class="ver">Online · v${esc(C.VERSAO||'1.0.0')}</p>
    </div>`;

  $('g-esqueci').onclick = () => mostrarPedirLink(
    'Redefinir senha',
    'Informe seu e-mail. Enviaremos um link para você criar uma senha nova.',
    ($('g-email').value||'').trim()
  );

  $('g-send').onclick = async () => {
    const email = ($('g-email').value||'').trim().toLowerCase();
    const senha = $('g-senha').value||'';
    const msg = $('g-msg'); msg.className = 'gate-msg';
    if(!/^\S+@\S+\.\S+$/.test(email)){ msg.classList.add('err'); msg.textContent='Digite um e-mail válido.'; return; }
    if(!senha){ msg.classList.add('err'); msg.textContent='Digite sua senha.'; return; }
    $('g-send').disabled = true; $('g-send').textContent = 'Entrando…';
    const { error } = await sb.auth.signInWithPassword({ email, password: senha });
    $('g-send').disabled = false; $('g-send').textContent = 'Entrar';
    if(error){
      msg.className = 'gate-msg err';
      msg.textContent = /invalid login credentials/i.test(error.message)
        ? 'E-mail ou senha inválidos.'
        : 'Não foi possível entrar: ' + error.message;
    }
  };
  $('g-email').addEventListener('keydown', e => { if(e.key==='Enter') $('g-senha').focus(); });
  $('g-senha').addEventListener('keydown', e => { if(e.key==='Enter') $('g-send').click(); });
}

/* ---------------- recuperação de senha ----------------
   Quem garante que a senha muda só na conta certa é o Supabase: o link do
   e-mail abre uma sessão daquela conta, e updateUser() altera apenas o
   usuário dessa sessão. O papel (coordenador/aprovador) fica na tabela
   perfis, protegido por RLS — trocar senha não mexe nele. */

// Endereço do app sem # nem ?, para onde o link do e-mail volta.
const URL_APP = location.origin + location.pathname;

// Tira tokens e códigos de erro da barra de endereço (e do histórico).
function limparUrl(){
  if(location.href !== URL_APP) history.replaceState(null, '', URL_APP);
}

function mostrarPedirLink(titulo, texto, email){
  modoRecuperacao = false;
  $('app').hidden = true; $('gate').hidden = false;
  $('gate').innerHTML = `
    <div class="gate-in">
      ${marca()}
      <h2>${esc(titulo)}</h2>
      <p class="sub">${esc(texto)}</p>
      <div class="field"><label>E-mail</label>
        <input id="r-email" type="email" inputmode="email" autocomplete="email" placeholder="seuemail@${esc(C.DOMINIO||'empresa.com.br')}" value="${esc(email||'')}"></div>
      <button class="btn btn-red" id="r-send">Enviar link</button>
      <button class="gate-link" id="r-voltar" type="button">Voltar ao login</button>
      <p class="gate-msg" id="r-msg"></p>
    </div>`;

  // iniciar(), não mostrarLogin(): se já houver alguém logado neste
  // navegador, volta direto para o app.
  $('r-voltar').onclick = () => iniciar();
  $('r-email').addEventListener('keydown', e => { if(e.key==='Enter') $('r-send').click(); });
  $('r-send').onclick = async () => {
    const em  = ($('r-email').value||'').trim().toLowerCase();
    const msg = $('r-msg'), btn = $('r-send');
    msg.className = 'gate-msg';
    if(!EMAIL_RE.test(em)){ msg.classList.add('err'); msg.textContent='Digite um e-mail válido.'; return; }
    btn.disabled = true; btn.textContent = 'Enviando…';
    const { error } = await sb.auth.resetPasswordForEmail(em, { redirectTo: URL_APP });
    if(error){
      btn.disabled = false; btn.textContent = 'Enviar link';
      msg.className = 'gate-msg err';
      msg.textContent = (error.status===429 || /rate limit/i.test(error.message))
        ? 'Muitos pedidos seguidos. Aguarde alguns minutos e tente de novo.'
        : 'Não foi possível enviar: ' + error.message;
      return;
    }
    // Mensagem neutra: não revela se o e-mail tem conta ou não.
    msg.className = 'gate-msg ok';
    msg.textContent = 'Se este e-mail tiver acesso, o link chega em instantes. Use só o e-mail mais recente — os anteriores deixam de valer.';
    // Espera 60 s antes de permitir novo envio (mesmo limite do Supabase).
    let s = 60;
    const tic = () => {
      if(!$('r-send')) return;               // saiu da tela
      if(s <= 0){ btn.disabled = false; btn.textContent = 'Enviar de novo'; return; }
      btn.textContent = `Enviar de novo (${s--}s)`;
      setTimeout(tic, 1000);
    };
    tic();
  };
}

async function mostrarLinkInvalido(){
  // Se sobrou sessão de um link de recuperação, ela não pode seguir valendo.
  if(modoRecuperacao || recuperacaoPendente()) await encerrarRecuperacao();
  mostrarPedirLink(
    'Link expirado ou já usado',
    'Links de redefinição valem por tempo limitado e funcionam uma vez só. Peça um novo abaixo.',
    ''
  );
}

// Só aparece no modelo de e-mail com token_hash: o link abre esta tela e o
// código só é gasto quando a pessoa toca no botão. Antivírus de e-mail que
// "visitam" o link antes dela não conseguem mais queimá-lo.
function mostrarConfirmarLink(){
  $('app').hidden = true; $('gate').hidden = false;
  $('gate').innerHTML = `
    <div class="gate-in">
      ${marca()}
      <h2>Redefinir senha</h2>
      <p class="sub">Toque em continuar para criar sua nova senha.</p>
      <button class="btn btn-red" id="c-ok">Continuar</button>
      <p class="gate-msg" id="c-msg"></p>
    </div>`;
  $('c-ok').onclick = async () => {
    $('c-ok').disabled = true; $('c-ok').textContent = 'Verificando…';
    modoRecuperacao = true; marcarRecuperacao();
    const { error } = await sb.auth.verifyOtp({ token_hash: urlAuth.tokenHash, type: 'recovery' });
    limparUrl();  // só agora: o código já foi usado (ou recusado)
    if(error){ mostrarLinkInvalido(); return; }
    mostrarNovaSenha();
  };
}

async function mostrarNovaSenha(){
  modoRecuperacao = true;
  // getUser() confirma a sessão no servidor (não confia só no navegador).
  const { data:{ user }, error } = await sb.auth.getUser();
  if(error || !user){ mostrarLinkInvalido(); return; }

  $('app').hidden = true; $('gate').hidden = false;
  // O campo de e-mail (somente leitura) mostra de qual conta é a senha e
  // faz o gerenciador de senhas do navegador salvar no login certo.
  $('gate').innerHTML = `
    <div class="gate-in">
      ${marca()}
      <h2>Crie sua nova senha</h2>
      <p class="sub">Mínimo de 8 caracteres. Depois de salvar, entre com a senha nova.</p>
      <div class="field"><label>Conta</label>
        <input id="n-email" type="email" autocomplete="username" value="${esc(user.email||'')}" readonly></div>
      <div class="field"><label>Nova senha</label>
        <input id="n-senha" type="password" autocomplete="new-password" placeholder="Nova senha"></div>
      <div class="field"><label>Confirme a nova senha</label>
        <input id="n-senha2" type="password" autocomplete="new-password" placeholder="Repita a nova senha"></div>
      <button class="btn btn-red" id="n-ok">Salvar nova senha</button>
      <button class="gate-link" id="n-cancelar" type="button">Cancelar</button>
      <p class="gate-msg" id="n-msg"></p>
    </div>`;

  $('n-cancelar').onclick = async () => {
    await encerrarRecuperacao();
    mostrarLogin();
  };
  $('n-senha').addEventListener('keydown', e => { if(e.key==='Enter') $('n-senha2').focus(); });
  $('n-senha2').addEventListener('keydown', e => { if(e.key==='Enter') $('n-ok').click(); });
  $('n-ok').onclick = async () => {
    const s1 = $('n-senha').value||'', s2 = $('n-senha2').value||'';
    const msg = $('n-msg'), btn = $('n-ok');
    msg.className = 'gate-msg err';
    if(s1.length < 8){ msg.textContent = 'A senha precisa ter pelo menos 8 caracteres.'; return; }
    if(s1 !== s2){ msg.textContent = 'As duas senhas não são iguais.'; return; }

    btn.disabled = true; btn.textContent = 'Salvando…';
    const { error } = await sb.auth.updateUser({ password: s1 });
    if(error){
      btn.disabled = false; btn.textContent = 'Salvar nova senha';
      if(error.code==='same_password')
        msg.textContent = 'A nova senha precisa ser diferente da anterior.';
      else if(error.code==='weak_password')
        msg.textContent = 'Senha fraca. Use mais caracteres, misturando letras e números.';
      else if(/session|jwt|expired/i.test(error.code||error.message)){
        mostrarLinkInvalido(); return;
      } else
        msg.textContent = 'Não foi possível salvar: ' + error.message;
      return;
    }
    // Encerra a sessão do link (em todos os aparelhos) e pede login com a
    // senha nova — assim fica provado que ela funciona.
    const email = user.email;
    await encerrarRecuperacao();
    mostrarLogin('Senha alterada. Entre com a nova senha.', email);
  };
}

async function sair(){
  if(canal) sb.removeChannel(canal);
  // Rascunho não passa para o próximo usuário do mesmo navegador. O form é
  // esvaziado também: o reload abaixo dispara visibilitychange, que senão
  // salvaria de novo o que ainda está na tela.
  limparRascunho();
  $('s-nova').innerHTML = '';
  await sb.auth.signOut();
  location.reload();
}

/* ---------------- dados ---------------- */
/* A leitura vem da view campanhas_app (migracoes/02-parte-B-swile.sql),
   que só entrega os dados pessoais do recebedor Swile ao aprovador e a quem
   solicitou. Enquanto a view não existir no banco, lê a tabela como antes —
   assim o app funciona antes e depois da migração. */
let fonteCampanhas = 'campanhas_app';
async function carregar(){
  let { data, error } = await sb.from(fonteCampanhas).select('*').order('criado_em',{ascending:false});
  if(error && fonteCampanhas==='campanhas_app' && (error.code==='PGRST205' || error.code==='42P01')){
    fonteCampanhas = 'campanhas';
    ({ data, error } = await sb.from(fonteCampanhas).select('*').order('criado_em',{ascending:false}));
  }
  if(error){ toast('Não foi possível carregar: ' + error.message); return; }
  dados = data || [];
  render();
}
function escutar(){
  canal = sb.channel('campanhas-ao-vivo')
    .on('postgres_changes',{event:'*',schema:'public',table:'campanhas'}, payload => {
      carregar();
      if(payload.eventType==='INSERT' && perfil.papel==='aprovador'){
        toast('Nova campanha aguardando você.');
        if(navigator.vibrate) navigator.vibrate(140);
      }
    }).subscribe();
}
const pendentes = () => dados.filter(c=>c.status==='Pendente');

/* ---------------- INÍCIO ---------------- */
function pintarInicio(){
  const pend = pendentes();
  const aprov = dados.filter(c=>c.status==='Aprovada');
  const custoAprov = aprov.reduce((a,c)=>a+calc(c).total,0);
  const rebComp    = aprov.reduce((a,c)=>a+calc(c).reb,0);
  const valorPend  = pend.reduce((a,c)=>a+calc(c).total,0);
  const ehAprov = perfil.papel==='aprovador';

  $('s-inicio').innerHTML = `
    ${pend.length ? `
      <div class="callout">
        <p>${ehAprov ? 'Aguardando sua decisão' : 'Suas campanhas em análise'}</p>
        <strong>${pend.length} ${pend.length===1?'campanha':'campanhas'} · R$ ${brl0(valorPend)}</strong>
        <button id="ir-pend">${ehAprov?'Revisar agora':'Ver situação'}</button>
      </div>` : `
      <div class="callout" style="background:var(--green);box-shadow:0 6px 18px rgba(18,138,72,.28)">
        <p>Fila limpa</p><strong>Nenhuma campanha pendente</strong>
        <button id="ir-pend" style="color:var(--green)">Ver todas</button>
      </div>`}

    <p class="seclabel">Posição consolidada</p>
    <div class="kpis">
      <dl class="kpi"><dt>Campanhas</dt><dd>${dados.length}</dd></dl>
      <dl class="kpi amber"><dt>Pendentes</dt><dd>${pend.length}</dd></dl>
      <dl class="kpi green"><dt>Custo aprovado</dt><dd>R$ ${brl0(custoAprov)}</dd></dl>
      <dl class="kpi ${rebComp>0?'red':'zero'}"><dt>Rebate comprometido</dt><dd>R$ ${brl0(rebComp)}</dd></dl>
    </div>
    <p class="hint" style="margin:-6px 0 18px">Custo = verba + rebate estimado se o cliente bater a meta.</p>

    <p class="seclabel">Últimas movimentações</p>
    ${dados.slice(0,4).map(cartao).join('') || `<div class="empty"><div class="ring">${ICO.lista}</div>
      <p>Nenhuma campanha ainda</p><small>Toque no botão vermelho para cadastrar a primeira.</small></div>`}`;

  const b = $('ir-pend'); if(b) b.onclick = () => { filtro='Pendente'; irPara('lista'); };
}

/* ---------------- cartão de lista ---------------- */
function cartao(c){
  const k = calc(c), bd = banda(k.pctMeta);
  const larg = k.pctMeta==null ? 0 : Math.min(k.pctMeta/.25*100,100);
  return `<button class="item" data-abrir="${c.id}">
    <div class="item-top">
      <p class="item-name">${esc(c.cliente)}</p>
      <span class="badge ${selo(c.status)}">${esc(c.status)}</span>
    </div>
    <p class="item-sub">${esc(c.codigo)} · ${esc(c.laboratorio)} · ${esc(c.campanha)}</p>
    <div class="mini">
      <div class="mini-bar"><i style="width:${larg}%;background:${bd.cor}"></i></div>
      <span class="mini-pct" style="color:${bd.cor}">${k.pctMeta==null?'—':(k.pctMeta*100).toFixed(1)+'% da meta'}</span>
    </div>
    <div class="item-foot">
      <span class="item-val">R$ ${brl(k.total)}</span>
      <span class="item-when">${ICO.relogio}${dt(c.criado_em)}</span>
    </div>
  </button>`;
}

/* ---------------- LISTA ---------------- */
function pintarLista(){
  const d = $('dot'), np = pendentes().length;
  if(np){ d.hidden=false; d.textContent=np; } else d.hidden=true;

  const filtros = ['Pendente','Aprovada','Reprovada','Todas'];
  const termo = busca.trim().toLowerCase();
  let lista = dados.filter(c => filtro==='Todas' || c.status===filtro);
  if(termo) lista = lista.filter(c =>
    (c.cliente+' '+c.laboratorio+' '+c.campanha+' '+c.codigo).toLowerCase().includes(termo));

  $('s-lista').innerHTML = `
    <div class="search">${ICO.busca}
      <input id="f-busca" placeholder="Buscar por cliente, laboratório ou código" value="${esc(busca)}"></div>
    <div class="pills">${filtros.map(f=>{
      const n = f==='Todas' ? dados.length : dados.filter(c=>c.status===f).length;
      return `<button class="pill ${f===filtro?'on':''}" data-filtro="${f}">${f==='Pendente'?'Pendentes':f==='Aprovada'?'Aprovadas':f==='Reprovada'?'Reprovadas':'Todas'} ${n?`(${n})`:''}</button>`;
    }).join('')}</div>
    ${lista.length ? lista.map(cartao).join('') : `<div class="empty"><div class="ring">${ICO.check}</div>
      <p>${termo?'Nada encontrado':'Nada por aqui'}</p>
      <small>${termo?'Tente outro nome, código ou laboratório.':'Campanhas com esse status aparecem aqui.'}</small></div>`}`;

  const inp = $('f-busca');
  inp.oninput = e => { busca = e.target.value; const p = e.target.selectionStart; pintarLista();
    const n = $('f-busca'); n.focus(); n.setSelectionRange(p,p); };
  document.querySelectorAll('[data-filtro]').forEach(b => b.onclick = () => { filtro=b.dataset.filtro; pintarLista(); });
}

/* ---------------- DETALHE ---------------- */
function abrir(id){
  const c = dados.find(x => String(x.id)===String(id));
  if(!c) return;
  const k = calc(c), bd = banda(k.pctMeta);
  const larg = k.pctMeta==null ? 0 : Math.min(k.pctMeta/.25*100,100);
  const d = dias(c.data_inicio, c.data_fim);
  const podeDecidir = perfil.papel==='aprovador' && c.status==='Pendente';

  $('s-detalhe').innerHTML = `
    <div class="hero">
      <div class="hero-top">
        <p class="hero-name">${esc(c.cliente)}</p>
        <span class="badge ${selo(c.status)}">${esc(c.status)}</span>
      </div>
      <p class="hero-title">${esc(c.campanha)}</p>
      <p class="hero-code">${esc(c.codigo)} · ${esc(c.laboratorio)}</p>
    </div>

    <p class="seclabel">Custo da campanha</p>
    <div class="block">
      <div class="amount">
        <p class="lbl">Custo total</p>
        <p class="big">R$ ${brl(k.total)}</p>
        <p class="split">LYNKZ <b>R$ ${brl(k.invL)}</b> + indústria <b>R$ ${brl(k.invI)}</b>${k.reb>0?` + rebate <b>R$ ${brl(k.reb)}</b>${k.limitado?' <span class="tag-teto">no teto</span>':''}`:''}</p>
      </div>
      <div class="gauge-wrap">
        <div class="gauge-head">
          <span>sobre a meta ${c.tipo_meta?'('+esc(c.tipo_meta.toLowerCase())+')':''}</span>
          <b style="color:${bd.cor}">${k.pctMeta==null?'—':(k.pctMeta*100).toFixed(1)+'%'}</b>
        </div>
        <div class="gbar"><i style="width:${larg}%;background:${bd.cor}"></i></div>
        <div class="gmarks">
          <span style="left:${C.FAIXA_VERDE/.25*100}%">${(C.FAIXA_VERDE*100).toFixed(0)}%</span>
          <span style="left:${C.FAIXA_AMARELA/.25*100}%">${(C.FAIXA_AMARELA*100).toFixed(0)}%</span>
          <span style="left:100%;transform:translateX(-100%)">25%+</span>
        </div>
        <p class="gnote" style="color:${bd.cor}">${bd.txt}</p>
      </div>
    </div>

    <p class="seclabel">Informações</p>
    <div class="block">
      <div class="line"><dt>Meta do cliente</dt><dd>${c.meta?'R$ '+brl(c.meta):'—'}</dd></div>
      <div class="line"><dt>Tipo de meta</dt><dd>${esc(c.tipo_meta)||'—'}</dd></div>
      <div class="line"><dt>Período</dt><dd>${dt(c.data_inicio)} → ${dt(c.data_fim)}</dd></div>
      <div class="line"><dt>Duração</dt><dd>${d?d+' dias':'—'}</dd></div>
      <div class="line"><dt>Mecânica</dt><dd>${esc(c.tipo)||'—'}</dd></div>
      <div class="line"><dt>Pagamento</dt><dd>${esc(c.forma_pagamento)||'—'}</dd></div>
      ${c.mecanica?`<div class="line stack"><dt>Como funciona</dt><dd>${esc(c.mecanica)}</dd></div>`:''}
      ${c.observacoes?`<div class="line stack"><dt>Observações</dt><dd>${esc(c.observacoes)}</dd></div>`:''}
    </div>

    ${c.forma_pagamento==='Swile' && c.swile_visivel===false?`
    <p class="seclabel">Dados de quem vai receber o Swile</p>
    <div class="nota" role="status">${ICO.cadeado}
      <span>Visíveis só para o aprovador e para quem fez a solicitação.</span></div>`:''}

    ${c.forma_pagamento==='Swile' && c.swile_visivel!==false?`
    <p class="seclabel">Dados de quem vai receber o Swile</p>
    <div class="block">
      <div class="line"><dt>Nome completo</dt><dd>${esc(c.swile_nome_completo)||'—'}</dd></div>
      <div class="line"><dt>CPF</dt><dd>${c.swile_cpf?esc(maskCPF(c.swile_cpf)):'—'}</dd></div>
      <div class="line"><dt>Data de nascimento</dt><dd>${dt(c.swile_data_nascimento)}</dd></div>
      <div class="line"><dt>E-mail</dt><dd>${esc(c.swile_email)||'—'}</dd></div>
      <div class="line"><dt>Telefone</dt><dd>${c.swile_telefone?esc(maskTelefone(c.swile_telefone)):'—'}</dd></div>
    </div>`:''}

    ${k.reb>0?`
    <p class="seclabel">Rebate</p>
    <div class="block">
      <div class="line"><dt>Percentual</dt><dd style="color:var(--red)">${String(c.rebate_pct).replace('.',',')}%</dd></div>
      <div class="line"><dt>Base de cálculo</dt><dd>${esc(c.rebate_base)||'—'}</dd></div>
      <div class="line"><dt>Quando é devido</dt><dd>${esc(c.rebate_gatilho)||'—'}</dd></div>
      <div class="line"><dt>Teto</dt><dd>${c.rebate_teto>0?'R$ '+brl(c.rebate_teto):'sem teto'}</dd></div>
      <div class="line"><dt>Estimado</dt><dd>R$ ${brl(k.reb)}</dd></div>
    </div>`:''}

    <p class="seclabel">Solicitação</p>
    <div class="block">
      <div class="line"><dt>Solicitante</dt><dd>${esc(c.solicitante_nome)||'—'}</dd></div>
      <div class="line"><dt>Enviada em</dt><dd>${dt(c.criado_em)}</dd></div>
      ${c.status!=='Pendente'?`
        <div class="line"><dt>Decidida por</dt><dd>${esc(c.aprovador_nome)||'—'}</dd></div>
        <div class="line"><dt>Data da decisão</dt><dd>${dt(c.data_decisao)}</dd></div>`:''}
      ${c.motivo?`<div class="line stack"><dt>Motivo da reprova</dt><dd style="color:var(--red)">${esc(c.motivo)}</dd></div>`:''}
    </div>

    ${podeDecidir ? `<div class="actions">
      <button class="btn btn-red" data-ok="${c.id}">${ICO.check} Aprovar campanha</button>
      <button class="btn btn-danger" data-no="${c.id}">Reprovar</button>
    </div>` : ''}`;

  voltarPara = abaAtual==='detalhe' ? voltarPara : abaAtual;
  irPara('detalhe', esc(c.cliente));
}

/* Select pesquisável: input de texto + lista filtrada, restrito às opções
   dadas (o valor só "assume" um item exato da lista — texto livre não
   confirmado é descartado ao sair do campo). */
function montarComboBusca(idInput, idLista, opcoes){
  const input = $(idInput), lista = $(idLista);
  const filtra = termo => {
    const alvo = normaliza(termo);
    return alvo ? opcoes.filter(x => normaliza(x).includes(alvo)) : opcoes;
  };
  const abre = () => {
    const itens = filtra(input.value);
    lista.innerHTML = itens.length
      ? itens.map(x => `<div class="combo-opt" data-v="${esc(x)}">${esc(x)}</div>`).join('')
      : `<p class="combo-empty">Nenhum resultado</p>`;
    lista.hidden = false;
  };
  input.addEventListener('focus', abre);
  input.addEventListener('input', abre);
  lista.addEventListener('mousedown', e => e.preventDefault());
  lista.addEventListener('click', e => {
    const opt = e.target.closest('.combo-opt');
    if(!opt) return;
    input.value = opt.dataset.v;
    lista.hidden = true;
  });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      lista.hidden = true;
      const match = opcoes.find(x => normaliza(x) === normaliza(input.value));
      input.value = match || '';
    }, 120);
  });
}

/* ---------------- rascunho da NOVA ----------------
   render() remonta o formulário do zero a cada atualização ao vivo, e
   recarregar a página também o apaga. Por isso o que foi digitado vai para
   o localStorage ({id do campo: valor}) e volta quando pintarNova() roda.
   Só o formulário de criação usa isto — o detalhe/aprovação não. */
const CHAVE_RASCUNHO = 'lynkz_rascunho_campanha';
let timerRascunho = null;

const camposNova = () => $('s-nova').querySelectorAll('input[id],select[id],textarea[id]');
// Dados pessoais do recebedor Swile nunca vão para o navegador (ver PRIVACIDADE-SWILE.md).
const FORA_DO_RASCUNHO = ['f-sw-nome','f-sw-cpf','f-sw-nasc','f-sw-email','f-sw-tel'];

function lerRascunho(){
  try {
    const r = JSON.parse(localStorage.getItem(CHAVE_RASCUNHO));
    return r && typeof r === 'object' ? r : null;
  } catch { return null; }
}
function salvarRascunho(){
  clearTimeout(timerRascunho); timerRascunho = null;
  const campos = camposNova();
  if(!campos.length) return;
  const r = {}; let algumPreenchido = false;
  campos.forEach(el => {
    if(FORA_DO_RASCUNHO.includes(el.id)) return;
    const val = el.type === 'checkbox' ? el.checked : el.value;
    r[el.id] = val;
    if(val !== '' && val !== false) algumPreenchido = true;
  });
  // Formulário todo vazio não é rascunho — senão o aviso apareceria à toa.
  try {
    if(algumPreenchido) localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify(r));
    else localStorage.removeItem(CHAVE_RASCUNHO);
  } catch { /* armazenamento cheio ou bloqueado: segue sem rascunho */ }
}
function agendarRascunho(){
  clearTimeout(timerRascunho);
  timerRascunho = setTimeout(salvarRascunho, 400);
}
function limparRascunho(){
  clearTimeout(timerRascunho); timerRascunho = null;
  try { localStorage.removeItem(CHAVE_RASCUNHO); } catch {}
}
// Um listener só no container (que sobrevive às remontagens do innerHTML).
['input','change'].forEach(evt => $('s-nova').addEventListener(evt, agendarRascunho));
document.addEventListener('visibilitychange', () => { if(document.hidden) salvarRascunho(); });

/* ---------------- NOVA ---------------- */
// Formas de pagamento em que o dinheiro sai do caixa LYNKZ na hora — nelas o
// investimento LYNKZ precisa ser maior que zero. Mesma grafia de PAGTO no config.js.
const PAGTO_EXIGE_INVESTIMENTO = ['Depósito / verba','Swile'];

function pintarNova(){
  // Se havia digitação esperando o debounce, grava antes de apagar a tela.
  if(timerRascunho) salvarRascunho();
  const rascunho = lerRascunho();

  const op = (a,ph) => `<option value="">${ph}</option>` + a.map(x=>`<option>${esc(x)}</option>`).join('');
  $('s-nova').innerHTML = `
    ${rascunho ? `<div class="nota" role="status">${ICO.rascunho}<span>Rascunho recuperado</span>
      <button type="button" class="nota-acao" id="rascunho-descartar">Descartar</button></div>` : ''}
    <p class="seclabel">Dados do cliente</p>
    <div class="field"><label>Cliente</label><input id="f-cliente" placeholder="Razão social ou nome da loja"></div>
    <div class="field combo">
      <label>Laboratório</label>
      <input id="f-lab" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Selecione ou digite para buscar">
      <div class="combo-list" id="f-lab-lista" hidden></div>
    </div>

    <p class="seclabel">A campanha</p>
    <div class="field"><label>Nome da campanha</label><input id="f-camp" placeholder="Ex.: Genéricos Setembro"></div>
    <div class="field"><label>Mecânica</label><select id="f-tipo">${op(C.TIPOS,'Selecione')}</select></div>
    <div class="field"><label>Como funciona</label><textarea id="f-mec" placeholder="Ex.: 5% de desconto acima de 200 un. e 8% acima de 400 un."></textarea></div>
    <div class="two">
      <div class="field"><label>Início</label><input id="f-ini" type="date"></div>
      <div class="field"><label>Fim</label><input id="f-fim" type="date"></div>
    </div>

    <p class="seclabel">Investimento</p>
    <div class="two">
      <div class="field" id="fld-inv-lynkz">
        <label>LYNKZ (R$)</label>
        <input id="f-inv-lynkz" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0">
        <p class="erro-msg" id="err-inv-lynkz" hidden></p>
      </div>
      <div class="field"><label>Indústria (R$)</label><input id="f-inv-industria" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0"></div>
    </div>
    <p class="hint">LYNKZ sai do caixa agora. Indústria é a bonificação prometida, paga no mês seguinte. Deixe em branco se não houver.</p>
    <div class="field"><label>Forma de pagamento</label><select id="f-pag">${op(C.PAGTO,'Selecione')}</select></div>

    <div id="swile-box" hidden>
      <p class="seclabel">Dados de quem vai receber o Swile</p>
      ${rascunho && rascunho['f-pag'] === 'Swile' ? `<div class="nota" role="status">${ICO.cadeado}
        <span>Por segurança, os dados do recebedor não ficam salvos no rascunho. Preencha de novo.</span></div>` : ''}
      <div class="field" id="fld-sw-nome">
        <label>Nome completo</label>
        <input id="f-sw-nome" placeholder="Nome completo do recebedor">
        <p class="erro-msg" id="err-sw-nome" hidden></p>
      </div>
      <div class="two">
        <div class="field" id="fld-sw-cpf">
          <label>CPF</label>
          <input id="f-sw-cpf" inputmode="numeric" placeholder="000.000.000-00" maxlength="14">
          <p class="erro-msg" id="err-sw-cpf" hidden></p>
        </div>
        <div class="field" id="fld-sw-nasc">
          <label>Data de nascimento</label>
          <input id="f-sw-nasc" type="date">
          <p class="erro-msg" id="err-sw-nasc" hidden></p>
        </div>
      </div>
      <div class="field" id="fld-sw-email">
        <label>E-mail</label>
        <input id="f-sw-email" type="email" inputmode="email" placeholder="nome@exemplo.com">
        <p class="erro-msg" id="err-sw-email" hidden></p>
      </div>
      <div class="field" id="fld-sw-tel">
        <label>Telefone</label>
        <input id="f-sw-tel" inputmode="numeric" placeholder="(00) 00000-0000" maxlength="15">
        <p class="erro-msg" id="err-sw-tel" hidden></p>
      </div>
      <p class="hint">Pagamento via Swile é feito direto para essa pessoa — por isso os dados são obrigatórios.</p>
    </div>

    <p class="seclabel">Contrapartida do cliente</p>
    <div class="field"><label>Tipo de meta</label><select id="f-tm">${op(C.METAS,'Selecione')}</select></div>
    <div class="field"><label>Meta do cliente (R$)</label><input id="f-meta" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0,00"></div>

    <div class="switch"><label><input type="checkbox" id="f-rb-on"> Esta campanha tem rebate</label></div>
    <div id="rb-box" hidden>
      <div class="two">
        <div class="field"><label>% de rebate</label><input id="f-rb-pct" type="number" min="0" step="0.1" inputmode="decimal" placeholder="0,0"></div>
        <div class="field"><label>Teto em R$ (opcional)</label><input id="f-rb-teto" type="number" min="0" step="0.01" inputmode="decimal" placeholder="sem teto"></div>
      </div>
      <div class="field"><label>Base de cálculo</label><select id="f-rb-base">${op(C.BASES,'Selecione')}</select></div>
      <div class="field"><label>Quando o rebate é devido</label><select id="f-rb-gat">${op(C.GATILHOS,'Selecione')}</select></div>
      <p class="preview" id="rb-calc">Informe a meta e o % para ver o custo total.</p>
    </div>

    <div class="field"><label>Observações</label><textarea id="f-obs" placeholder="Opcional"></textarea></div>
    <button class="btn btn-red" id="f-send">Enviar para aprovação</button>
    <p class="hint">Cliente, laboratório e nome da campanha são obrigatórios. Investimento LYNKZ também, quando o pagamento for Depósito / verba ou Swile.</p>`;

  const v = id => ($(id).value||'').trim();
  // Vazio vira 0 — o banco nunca recebe null nem NaN nos valores.
  const num = id => { const n = Number(v(id) || 0); return Number.isFinite(n) ? n : 0; };

  montarComboBusca('f-lab','f-lab-lista', C.LABORATORIOS);

  /* ---- bloco condicional Swile ---- */
  function atualizarSwileBox(){
    const on = v('f-pag') === 'Swile';
    $('swile-box').hidden = !on;
    if(!on){
      ['f-sw-nome','f-sw-cpf','f-sw-nasc','f-sw-email','f-sw-tel'].forEach(id => { $(id).value = ''; });
      limparErrosSwile();
    }
  }
  $('f-pag').addEventListener('change', atualizarSwileBox);
  $('f-sw-cpf').addEventListener('input', e => { e.target.value = maskCPF(e.target.value); });
  $('f-sw-tel').addEventListener('input', e => { e.target.value = maskTelefone(e.target.value); });

  function limparErrosSwile(){
    ['nome','cpf','nasc','email','tel'].forEach(campo => {
      $('fld-sw-'+campo).classList.remove('erro');
      const e = $('err-sw-'+campo); e.hidden = true; e.innerHTML = '';
    });
  }
  function marcarErroSwile(campo, msg){
    $('fld-sw-'+campo).classList.add('erro');
    const e = $('err-sw-'+campo);
    e.hidden = false;
    e.innerHTML = ICO.alerta + `<span>${esc(msg)}</span>`;
  }
  // Bloqueia o envio quando a forma de pagamento é Swile e algum dos cinco
  // campos está vazio ou inválido. Mesma régua da CHECK constraint do
  // banco (schema.sql) — aqui só para avisar antes de tentar salvar.
  function validarSwile(){
    limparErrosSwile();
    if(v('f-pag') !== 'Swile') return true;
    let ok = true;

    if(v('f-sw-nome').split(/\s+/).filter(Boolean).length < 2){
      marcarErroSwile('nome','Informe nome e sobrenome.'); ok = false;
    }
    if(!cpfValido(v('f-sw-cpf'))){
      marcarErroSwile('cpf','CPF inválido. Confira os números.'); ok = false;
    }
    const nasc = v('f-sw-nasc');
    if(!nasc){
      marcarErroSwile('nasc','Informe a data de nascimento.'); ok = false;
    } else if(new Date(nasc+'T00:00:00') > new Date()){
      marcarErroSwile('nasc','A data não pode ser no futuro.'); ok = false;
    }
    if(!EMAIL_RE.test(v('f-sw-email'))){
      marcarErroSwile('email','Digite um e-mail válido.'); ok = false;
    }
    const tel = soDigitos(v('f-sw-tel'));
    if(tel.length !== 10 && tel.length !== 11){
      marcarErroSwile('tel','Informe o telefone com DDD (10 ou 11 números).'); ok = false;
    }
    return ok;
  }

  /* ---- investimento LYNKZ: obrigatório só em Depósito / verba e Swile ---- */
  function validarInvestimento(){
    const fld = $('fld-inv-lynkz'), e = $('err-inv-lynkz');
    fld.classList.remove('erro'); e.hidden = true; e.innerHTML = '';
    const pag = v('f-pag');
    if(!PAGTO_EXIGE_INVESTIMENTO.includes(pag) || num('f-inv-lynkz') > 0) return true;
    fld.classList.add('erro'); e.hidden = false;
    e.innerHTML = ICO.alerta + `<span>Obrigatório para ${esc(pag)}. Informe um valor maior que zero.</span>`;
    return false;
  }
  $('f-pag').addEventListener('change', validarInvestimento);
  // Enquanto digita, só reavalia para tirar o erro — não acusa no meio da digitação.
  $('f-inv-lynkz').addEventListener('input', () => {
    if($('fld-inv-lynkz').classList.contains('erro')) validarInvestimento();
  });

  function previa(){
    const on = $('f-rb-on').checked;
    $('rb-box').hidden = !on;
    if(!on) return;
    const k = calc({ investimento_lynkz:parseFloat(v('f-inv-lynkz'))||0, investimento_industria:parseFloat(v('f-inv-industria'))||0,
                     meta:parseFloat(v('f-meta'))||0,
                     rebate_pct:parseFloat(v('f-rb-pct'))||0, rebate_teto:parseFloat(v('f-rb-teto'))||0 });
    $('rb-calc').innerHTML = (k.meta>0 && k.reb>0)
      ? `Rebate estimado <b>R$ ${brl(k.reb)}</b>${k.limitado?' (limitado pelo teto)':''}<br>
         Custo total <b>R$ ${brl(k.total)}</b> · <b>${(k.pctMeta*100).toFixed(1)}%</b> da meta`
      : 'Informe a meta e o % para ver o custo total.';
  }
  ['f-rb-on','f-rb-pct','f-rb-teto','f-meta','f-inv-lynkz','f-inv-industria'].forEach(id=>{
    $(id).addEventListener('input',previa); $(id).addEventListener('change',previa);
  });

  $('f-send').onclick = async () => {
    if(!v('f-cliente')||!v('f-lab')||!v('f-camp')){
      toast('Preencha cliente, laboratório e nome da campanha.'); return; }
    if(!validarInvestimento()){ toast('Informe o investimento LYNKZ para essa forma de pagamento.'); return; }
    if(v('f-ini') && v('f-fim') && v('f-fim') < v('f-ini')){
      toast('A data fim está antes da data início.'); return; }
    const rbOn = $('f-rb-on').checked;
    if(rbOn && !(parseFloat(v('f-rb-pct'))>0)){ toast('Informe o % de rebate ou desmarque a opção.'); return; }
    if(rbOn && !(parseFloat(v('f-meta'))>0)){ toast('Rebate precisa da meta do cliente para ser calculado.'); return; }
    if(!validarSwile()){ toast('Confira os dados de quem vai receber o Swile.'); return; }

    const swileOn = v('f-pag') === 'Swile';
    $('f-send').disabled = true; $('f-send').textContent = 'Enviando…';
    const { error } = await sb.from('campanhas').insert({
      cliente:v('f-cliente'), laboratorio:v('f-lab'), campanha:v('f-camp'),
      tipo:v('f-tipo')||null, mecanica:v('f-mec')||null,
      investimento_lynkz:num('f-inv-lynkz'), investimento_industria:num('f-inv-industria'),
      forma_pagamento:v('f-pag')||null,
      data_inicio:v('f-ini')||null, data_fim:v('f-fim')||null,
      tipo_meta:v('f-tm')||null, meta:parseFloat(v('f-meta'))||0,
      rebate_pct:  rbOn ? (parseFloat(v('f-rb-pct'))||0)  : 0,
      rebate_teto: rbOn ? (parseFloat(v('f-rb-teto'))||0) : 0,
      rebate_base: rbOn ? (v('f-rb-base')||null) : null,
      rebate_gatilho: rbOn ? (v('f-rb-gat')||null) : null,
      swile_nome_completo: swileOn ? v('f-sw-nome') : null,
      swile_cpf:            swileOn ? soDigitos(v('f-sw-cpf')) : null,
      swile_data_nascimento: swileOn ? v('f-sw-nasc') : null,
      swile_email:          swileOn ? v('f-sw-email') : null,
      swile_telefone:       swileOn ? soDigitos(v('f-sw-tel')) : null,
      observacoes:v('f-obs')||null, status:'Pendente',
      solicitante_id: perfil.id, solicitante_nome: perfil.nome
    });
    $('f-send').disabled = false; $('f-send').textContent = 'Enviar para aprovação';
    if(error){ toast('Não foi possível enviar: ' + error.message); return; } // rascunho continua salvo
    limparRascunho();
    pintarNova();
    toast('Enviada. Já está na fila de aprovação.');
    await carregar();
    filtro = 'Pendente';
    irPara('lista');
  };

  /* ---- repopula o rascunho ---- */
  if(rascunho){
    camposNova().forEach(el => {
      if(FORA_DO_RASCUNHO.includes(el.id) || !(el.id in rascunho)) return;
      if(el.type === 'checkbox'){ el.checked = !!rascunho[el.id]; return; }
      let val = String(rascunho[el.id] ?? '');
      // Laboratório só aceita item exato da lista (mesma regra do combo).
      if(el.id === 'f-lab') val = C.LABORATORIOS.find(x => normaliza(x) === normaliza(val)) || '';
      el.value = val;
    });
    // Dispara os eventos que mostram os blocos condicionais (Swile, rebate)
    // e recalculam a prévia/validação — com os valores já no lugar.
    ['f-pag','f-rb-on'].forEach(id => $(id).dispatchEvent(new Event('change')));
    $('rascunho-descartar').onclick = () => { limparRascunho(); pintarNova(); toast('Rascunho descartado.'); };
  }
}

/* ---------------- HISTÓRICO ---------------- */
function pintarHistorico(){
  const decididas = dados.filter(c => c.status!=='Pendente');
  $('s-historico').innerHTML = decididas.length
    ? `<p class="seclabel">${decididas.length} ${decididas.length===1?'decisão registrada':'decisões registradas'}</p>`
      + decididas.map(cartao).join('')
    : `<div class="empty"><div class="ring">${ICO.relogio}</div><p>Sem histórico ainda</p>
       <small>Toda campanha aprovada ou reprovada fica arquivada aqui, para sempre.</small></div>`;
}

/* ---------------- PERFIL ---------------- */
function pintarPerfil(){
  const inicial = (perfil.nome||'?').trim().charAt(0).toUpperCase();
  const minhas = dados.filter(c => c.solicitante_id===perfil.id).length;
  $('s-perfil').innerHTML = `
    <div class="me">
      <div class="av">${esc(inicial)}</div>
      <h3>${esc(perfil.nome)}</h3>
      <p>${esc(perfil.email)}</p>
      <span class="badge ${perfil.papel==='aprovador'?'b-no':'b-ok'}">${perfil.papel==='aprovador'?'Aprovador':'Coordenador'}</span>
    </div>

    <p class="seclabel">Resumo</p>
    <div class="block">
      <div class="line"><dt>Campanhas que você enviou</dt><dd>${minhas}</dd></div>
      <div class="line"><dt>Total no sistema</dt><dd>${dados.length}</dd></div>
      <div class="line"><dt>Aguardando decisão</dt><dd>${pendentes().length}</dd></div>
    </div>

    <p class="seclabel">Relatório</p>
    <div class="actions" style="margin-bottom:18px">
      <button class="btn btn-ghost" id="btn-xls">${ICO.baixar} Baixar planilha Excel</button>
    </div>

    <button class="btn btn-danger" id="btn-sair">Sair da conta</button>
    <p class="ver" style="text-align:center">Online · v${esc(C.VERSAO||'1.0.0')}</p>`;
  $('btn-xls').onclick  = exportar;
  $('btn-sair').onclick = sair;
}

/* ---------------- Excel ---------------- */
// Serial de data "pura" do Excel: dias inteiros desde 30/12/1899, sem
// passar objeto Date nenhum para a biblioteca xlsx. Tentativas anteriores
// (Date em UTC, Date em horário local) deixavam a conversão interna da
// biblioteca colar um horário residual (ex.: 23:59:32) e, em alguns fusos,
// a data caía um dia. Date.UTC() aqui não representa fuso — é só régua de
// contagem de dias entre duas datas civis, por isso não sofre esse problema.
// 30/12/1899 (não 31/12 nem 01/01/1900) é a época que o próprio Excel usa,
// de propósito, para compensar o bug histórico dele que trata 1900 como
// ano bissexto. Célula vazia quando não há valor.
const dataExcel = s => {
  if(!s) return '';
  const [ano,mes,dia] = String(s).slice(0,10).split('-').map(Number);
  return Math.round((Date.UTC(ano, mes-1, dia) - Date.UTC(1899, 11, 30)) / 86400000);
};

function exportar(){
  if(!dados.length){ toast('Não há nada para exportar ainda.'); return; }
  if(typeof XLSX === 'undefined'){ toast('A biblioteca de Excel não carregou. Recarregue a página.'); return; }
  const linhas = dados.map(c => { const k = calc(c); return {
    'ID':c.codigo,'Data Solicitação':dataExcel(c.criado_em),'Solicitante':c.solicitante_nome,
    'Cliente':c.cliente,'Laboratório':c.laboratorio,'Nome da Campanha':c.campanha,
    'Tipo de Campanha':c.tipo,'Mecânica / Descrição':c.mecanica,
    'Investimento LYNKZ (R$)':k.invL,'Investimento Indústria (R$)':k.invI,'Forma de Pagamento':c.forma_pagamento,
    'Data Início':dataExcel(c.data_inicio),'Data Fim':dataExcel(c.data_fim),
    'Duração (dias)':dias(c.data_inicio,c.data_fim)||'',
    'Tipo de Meta':c.tipo_meta,'Meta do Cliente (R$)':+c.meta||0,
    'Tem Rebate':k.reb>0?'Sim':'Não','% Rebate':c.rebate_pct?(+c.rebate_pct)/100:'',
    'Base do Rebate':c.rebate_base||'','Gatilho do Rebate':c.rebate_gatilho||'',
    'Teto do Rebate (R$)':+c.rebate_teto||'','Rebate Estimado (R$)':k.reb||0,
    'Custo Total (R$)':k.total,'% Custo Total / Meta':k.pctMeta==null?'':k.pctMeta,
    'Status':c.status,'Aprovador':c.aprovador_nome||'',
    'Data da Decisão':dataExcel(c.data_decisao),
    'Motivo da Reprova':c.motivo||'','Observações':c.observacoes||'',
    'Nome do Recebedor Swile':c.swile_nome_completo||'',
    'CPF do Recebedor Swile':c.swile_cpf?maskCPF(c.swile_cpf):'',
    'Data de Nascimento do Recebedor':dataExcel(c.swile_data_nascimento),
    'E-mail do Recebedor Swile':c.swile_email||'',
    'Telefone do Recebedor Swile':c.swile_telefone?maskTelefone(c.swile_telefone):''
  };});
  const ws = XLSX.utils.json_to_sheet(linhas);

  const nLinhas = linhas.length;
  const aplicarFormato = (colunas, fmt) => colunas.forEach(col => {
    for(let l=2; l<=nLinhas+1; l++){
      const cel = ws[col+l];
      if(cel && cel.v!==undefined && cel.v!=='') cel.z = fmt;
    }
  });
  aplicarFormato(['B','L','M','AA','AF'], 'dd/mm/yyyy');         // datas (AF = Data de Nascimento do Recebedor)
  aplicarFormato(['I','J','P','U','V','W'], '"R$" #,##0.00');    // moeda
  aplicarFormato(['R','X'], '0.0%');                             // percentual

  // largura das colunas ajustada ao conteúdo (mín. do cabeçalho, máx. 40)
  const cabecalho = Object.keys(linhas[0]);
  ws['!cols'] = cabecalho.map(nome => {
    let max = nome.length;
    linhas.forEach(l => {
      const v = l[nome];
      const texto = v instanceof Date ? '00/00/0000' : String(v ?? '');
      if(texto.length > max) max = texto.length;
    });
    return { wch: Math.min(max + 2, 40) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Campanhas');
  XLSX.writeFile(wb, `Extrato_Campanhas_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast('Planilha gerada.');
}

/* ---------------- decisões ---------------- */
async function decidir(id, status, motivo){
  const c = dados.find(x => String(x.id)===String(id));
  if(!c) return;
  const { error } = await sb.from('campanhas')
    .update({ status, motivo: motivo||null }).eq('id', id).eq('status','Pendente');
  if(error){ toast('Não foi possível registrar: ' + error.message); return; }
  toast(status==='Aprovada' ? `Aprovada · ${c.cliente} · R$ ${brl(calc(c).total)}` : `Reprovada · ${c.cliente}`);
  await carregar();
  irPara(voltarPara==='detalhe' ? 'lista' : voltarPara);
}

document.addEventListener('click', e => {
  const ab = e.target.closest('[data-abrir]');
  const ok = e.target.closest('[data-ok]');
  const no = e.target.closest('[data-no]');
  if(ab) abrir(ab.dataset.abrir);
  if(ok) decidir(ok.dataset.ok,'Aprovada');
  if(no){
    alvo = no.dataset.no;
    const c = dados.find(x => String(x.id)===String(alvo));
    $('sheet-sub').textContent = c ? `${c.cliente} · R$ ${brl(calc(c).total)}` : '';
    $('motivo').value = '';
    $('sheet').classList.add('on');
    $('motivo').focus();
  }
});
$('sheet-cancel').onclick = () => { $('sheet').classList.remove('on'); alvo = null; };
$('sheet-ok').onclick = () => {
  const m = $('motivo').value.trim();
  if(!m){ toast('Escreva o motivo antes de confirmar.'); return; }
  $('sheet').classList.remove('on');
  decidir(alvo,'Reprovada',m); alvo = null;
};

/* ---------------- navegação ---------------- */
const TITULOS = { inicio:'Início', lista:'Campanhas', nova:'Nova campanha', historico:'Histórico', perfil:'Perfil' };

function irPara(tela, titulo){
  abaAtual = tela;
  ['inicio','lista','detalhe','nova','historico','perfil']
    .forEach(t => $('s-'+t).classList.toggle('on', t===tela));

  const interna = tela==='detalhe' || tela==='nova';
  $('btn-back').hidden = !interna;
  $('bar-title').textContent = titulo || TITULOS[tela] || '';
  $('bar-count').textContent = tela==='lista' && pendentes().length ? `${pendentes().length} pendente${pendentes().length>1?'s':''}` : '';

  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab===tela));
  $('s-'+tela).scrollTop = 0;
  window.scrollTo(0,0);
}
document.querySelectorAll('.tab').forEach(b => b.onclick = () => irPara(b.dataset.tab));
$('fab').onclick = () => { voltarPara = abaAtual==='nova' ? 'lista' : abaAtual; irPara('nova'); };
$('btn-back').onclick = () => irPara(voltarPara==='nova'||voltarPara==='detalhe' ? 'lista' : voltarPara);

function render(){
  pintarInicio(); pintarLista(); pintarNova(); pintarHistorico(); pintarPerfil();
  if(abaAtual==='detalhe'){ /* mantém o detalhe aberto durante atualizações ao vivo */ }
  else irPara(abaAtual);
}

sb.auth.onAuthStateChange(evt => {
  if(evt==='PASSWORD_RECOVERY'){
    if(!modoRecuperacao){ modoRecuperacao = true; if(pronto) mostrarNovaSenha(); }
    return;
  }
  // Durante a recuperação as telas de senha controlam o fluxo sozinhas.
  if(!pronto || modoRecuperacao) return;
  if(evt==='SIGNED_IN'||evt==='SIGNED_OUT') iniciar();
});

// Abertura: espera o Supabase ler o link do e-mail (se houver), limpa a URL
// e decide qual tela mostrar.
(async () => {
  await sb.auth.getSession();
  const linkTokenHash = !!urlAuth.tokenHash && urlAuth.tipo==='recovery' && !urlAuth.erro;
  // O token_hash só é apagado depois de usado (ver mostrarConfirmarLink).
  if(!linkTokenHash) limparUrl();
  // Recuperação abandonada numa visita anterior: encerra aquela sessão.
  if(!modoRecuperacao && recuperacaoPendente()) await encerrarRecuperacao();
  pronto = true;
  if(urlAuth.erro){ mostrarLinkInvalido(); return; }
  if(linkTokenHash){ mostrarConfirmarLink(); return; }
  iniciar();
})();
