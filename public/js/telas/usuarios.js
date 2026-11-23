// ============================================================
//  USUÁRIOS — #/usuarios (só administrador).
//  Quem pediu acesso aparece primeiro, com "Liberar" de um toque.
//  Os demais: nome, e-mail e papel; "Editar" abre nome, papel e acesso.
//  O banco confere tudo (definir_perfil): a tela só organiza.
// ============================================================
import { html, pintar, $, ao } from '../lib/dom.js';
import { PAPEL, rotuloPapel, dataBR } from '../lib/regras.js';
import { icone } from '../ui/icones.js';
import { seloNeutro, vazio, carregando } from '../ui/pecas.js';
import { abrirDialogo, erroNoDialogo, confirmar } from '../ui/avisos.js';
import { campo, interruptor, aplicarErros } from '../ui/campos.js';
import { usuarios } from '../dados/usuarios.js';
import { detalhar } from '../dados/erros.js';

let s = null;   // { el, ctx, lista, erro, desligar[] }

const PAPEIS = [
  { valor: PAPEL.COORDENADOR, rotulo: rotuloPapel(PAPEL.COORDENADOR), texto: 'Envia campanhas e cadastra balconistas.' },
  { valor: PAPEL.APROVADOR,   rotulo: rotuloPapel(PAPEL.APROVADOR),   texto: 'Também aprova e recusa campanhas e libera acessos.' },
];

const linha = (u, eu) => html`<li class="usuario${u.ativo ? '' : ' inativo'}">
  <div class="usuario-avatar" aria-hidden="true">${(u.nome || '?').trim().charAt(0).toUpperCase()}</div>
  <div class="usuario-dados">
    <strong>${u.nome}${eu ? html` ${seloNeutro('Você')}` : ''}</strong>
    <small>${u.email}</small>
    ${u.ativo ? '' : html`<small>Conta criada em ${dataBR(u.criado_em)}</small>`}
  </div>
  <div class="acoes">
    ${u.ativo
      ? html`<span class="selo ${u.papel === PAPEL.APROVADOR ? 'selo-admin' : 'selo-neutro'}">${u.papel === PAPEL.APROVADOR ? icone('cadeado') : ''}${rotuloPapel(u.papel)}</span>
             <button type="button" class="btn btn-fantasma btn-pequeno" data-editar-usuario="${u.id}" aria-label="Editar ${u.nome}">${icone('editar')} Editar</button>`
      : html`<button type="button" class="btn btn-primario btn-pequeno" data-liberar="${u.id}" aria-label="Liberar acesso de ${u.nome}">${icone('check')} Liberar acesso</button>
             <button type="button" class="btn btn-fantasma btn-pequeno" data-editar-usuario="${u.id}" aria-label="Editar ${u.nome}">${icone('editar')} Editar</button>`}
  </div>
</li>`;

function desenhar() {
  const { el, ctx } = s;
  if (!ctx.ehAprovador) {
    pintar(el, vazio({ icone: 'cadeado', titulo: 'Só administradores', texto: 'Esta tela libera acessos e define quem aprova campanhas. Peça a um administrador.', acao: { href: '#/inicio', rotulo: 'Voltar ao início' } }));
    return;
  }
  if (s.erro) {
    pintar(el, html`<div class="estado-erro" role="alert">${icone('alerta')}
      <div class="estado-erro-texto"><p class="estado-titulo">Não foi possível carregar os usuários</p><p class="estado-texto">${s.erro}</p></div>
      <button type="button" class="btn btn-fantasma" id="us-tentar">${icone('repetir')} Tentar de novo</button></div>`);
    return;
  }
  if (!s.lista) { pintar(el, carregando(3)); return; }

  const eu = ctx.perfil.id;
  const aguardando = s.lista.filter(u => !u.ativo);
  const ativos = s.lista.filter(u => u.ativo)
    .sort((a, b) => (a.papel === b.papel ? 0 : a.papel === PAPEL.APROVADOR ? -1 : 1));
  const nAdm = ativos.filter(u => u.papel === PAPEL.APROVADOR).length;

  pintar(el, html`<div class="usuarios">
    <p class="secao-nota usuarios-guia">${PAPEIS.map(p => html`<span><strong>${p.rotulo}:</strong> ${p.texto}</span>`)}</p>

    ${aguardando.length ? html`<section class="painel" aria-labelledby="us-t-aguardando">
      <h2 class="painel-titulo" id="us-t-aguardando">Sem acesso <span class="contador-texto">${aguardando.length}</span></h2>
      <p class="painel-corpo campo-dica">Contas novas entram sem acesso. Libere quem é da equipe; quem saiu fica aqui, desativado.</p>
      <ul class="usuarios-lista">${aguardando.map(u => linha(u, u.id === eu))}</ul>
    </section>` : ''}

    <section class="painel" aria-labelledby="us-t-ativos">
      <h2 class="painel-titulo" id="us-t-ativos">Com acesso <span class="contador-texto">${ativos.length}</span></h2>
      <p class="painel-corpo campo-dica">${nAdm} ${nAdm === 1 ? 'administrador' : 'administradores'} · ${ativos.length - nAdm} ${ativos.length - nAdm === 1 ? 'usuário' : 'usuários'}</p>
      <ul class="usuarios-lista">${ativos.map(u => linha(u, u.id === eu))}</ul>
    </section>
  </div>`);
}

async function carregar() {
  s.erro = null;
  try { s.lista = await usuarios.listar(); }
  catch (e) { s.erro = e.message; }
  if (s) desenhar();
}

function trocarNaLista(novo) {
  s.lista = s.lista.map(u => (u.id === novo.id ? novo : u));
  if (novo.id === s.ctx.perfil.id) Object.assign(s.ctx.perfil, { nome: novo.nome });
  desenhar();
}

async function liberar(u) {
  try {
    const novo = await usuarios.definir(u.id, { ativo: true });
    trocarNaLista(novo);
    s.ctx.toast(`${novo.nome} já pode entrar como ${rotuloPapel(novo.papel).toLowerCase()}.`, { tom: 'sucesso' });
  } catch (e) { s.ctx.toast(e.message, { tom: 'erro' }); desenhar(); }
}

async function editar(u) {
  const eu = u.id === s.ctx.perfil.id;
  let salvo = null;
  const corpo = html`
    ${campo({ id: 'du-nome', rotulo: 'Nome', valor: u.nome, obrigatorio: true, dica: 'Como aparece nas campanhas e no menu.', atributos: { autocomplete: 'off', maxlength: 80 } })}
    <fieldset class="campo pessoas" data-campo="du-papel"${eu ? html` disabled` : ''}>
      <legend>Papel</legend>
      ${PAPEIS.map(p => html`<label class="pessoa"><input type="radio" name="du-papel" value="${p.valor}"${u.papel === p.valor ? html` checked` : ''}>
        <span class="pessoa-nome">${p.rotulo}<small>${p.texto}</small></span></label>`)}
    </fieldset>
    ${eu ? html`<p class="nota">${icone('info')}<span>Você não pode tirar o seu próprio acesso nem deixar de ser administrador. Outro administrador pode.</span></p>`
         : interruptor({ id: 'du-ativo', rotulo: 'Acesso liberado', marcado: u.ativo, dica: 'Desligado, a pessoa não entra no app. Nada do que ela fez é apagado.' })}`;

  await abrirDialogo({
    titulo: `Editar ${u.nome}`,
    descricao: u.email,
    corpo,
    acoes: [
      { rotulo: 'Cancelar', valor: null, tipo: 'fantasma' },
      { rotulo: 'Salvar alterações', valor: 'salvar', tipo: 'primario', principal: true },
    ],
    antesDeFechar: async (_v, d) => {
      erroNoDialogo(d, '');
      const nome = $('#du-nome', d).value.trim().replace(/\s+/g, ' ');
      if (nome.length < 2) { aplicarErros(d, { 'du-nome': 'Informe o nome (pelo menos 2 letras).' }); return false; }
      const papel = eu ? null : d.querySelector('input[name="du-papel"]:checked')?.value ?? null;
      const ativo = eu ? null : !!$('#du-ativo', d)?.checked;
      // Dar ou tirar o papel de administrador pede confirmação: muda quem aprova campanhas.
      if (papel && papel !== u.papel) {
        const ok = await confirmar({
          titulo: papel === PAPEL.APROVADOR ? `Tornar ${nome} administrador?` : `Tirar ${nome} de administrador?`,
          descricao: papel === PAPEL.APROVADOR
            ? 'Vai poder aprovar e recusar campanhas e liberar acessos de outras pessoas.'
            : 'Deixa de aprovar campanhas e de liberar acessos. Continua enviando campanhas.',
          confirmar: papel === PAPEL.APROVADOR ? 'Tornar administrador' : 'Tirar de administrador',
          perigo: papel !== PAPEL.APROVADOR,
        });
        if (!ok) return false;
      }
      try {
        salvo = await usuarios.definir(u.id, {
          nome: nome !== u.nome ? nome : null,
          papel: papel && papel !== u.papel ? papel : null,
          ativo: ativo !== null && ativo !== u.ativo ? ativo : null,
        });
        return true;
      } catch (err) {
        erroNoDialogo(d, detalhar(err).mensagem);
        return false;
      }
    },
  });
  if (salvo) { trocarNaLista(salvo); s.ctx.toast('Usuário atualizado.', { tom: 'sucesso' }); }
}

export function montar(el, ctx) {
  s = { el, ctx, lista: null, erro: null, desligar: [] };
  ctx.cabecalho({ titulo: 'Usuários' });
  const porId = id => s.lista?.find(u => String(u.id) === String(id));
  s.desligar.push(
    ao(el, 'click', '[data-liberar]', (e, b) => { const u = porId(b.dataset.liberar); if (u) { b.disabled = true; liberar(u); } }),
    ao(el, 'click', '[data-editar-usuario]', (e, b) => { const u = porId(b.dataset.editarUsuario); if (u) editar(u); }),
    ao(el, 'click', '#us-tentar', () => { s.lista = null; desenhar(); carregar(); }),
  );
  desenhar();
  if (ctx.ehAprovador) carregar();
  const meu = s;
  return () => { meu.desligar.forEach(fn => fn()); if (s === meu) s = null; };
}
