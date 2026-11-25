// Perfil: dados da conta, resumo, aparência, planilha Excel, troca de senha e saída.
import { html, pintar, ao } from '../lib/dom.js';
import { STATUS, quandoBR, rotuloPapel } from '../lib/regras.js';
import { icone } from '../ui/icones.js';
import { seloNeutro } from '../ui/pecas.js';
import { exportarExcel } from '../exportar.js';
import { sb } from '../lib/supabase.js';
import { abrirDialogo, erroNoDialogo } from '../ui/avisos.js';
import { aplicarErros } from '../ui/campos.js';
import { campoSenha, ligarSenha } from '../ui/senha.js';
import { TEMAS, temaEscolhido, escolherTema, aoMudarTema } from '../ui/tema.js';

const C = window.CONFIG;

function desenhar(el, ctx) {
  const p = ctx.perfil;
  const todas = ctx.campanhas.todas();
  const minhas = todas.filter(c => c.solicitante_id === p.id);
  const inicial = (p.nome || '?').trim().charAt(0).toUpperCase();
  pintar(el, html`<div class="perfil">
    <section class="painel perfil-cartao">
      <div class="avatar" aria-hidden="true">${inicial}</div>
      <div>
        <h2 class="perfil-nome">${p.nome}</h2>
        <p class="perfil-email">${p.email}</p>
        ${ctx.ultimoAcesso ? html`<p class="perfil-acesso">Último acesso: ${quandoBR(ctx.ultimoAcesso)}</p>` : ''}
        ${seloNeutro(rotuloPapel(p.papel))}
      </div>
    </section>

    <section class="painel">
      <h3 class="painel-titulo">Resumo</h3>
      <dl class="linhas">
        <div><dt>Campanhas que você enviou</dt><dd class="tabular">${minhas.length}</dd></div>
        <div><dt>Suas aprovadas</dt><dd class="tabular">${minhas.filter(c => c.status === STATUS.APROVADA).length}</dd></div>
        <div><dt>Suas em análise</dt><dd class="tabular">${minhas.filter(c => c.status === STATUS.PENDENTE).length}</dd></div>
        <div><dt>Total no sistema</dt><dd class="tabular">${todas.length}</dd></div>
        <div><dt>Aguardando decisão</dt><dd class="tabular">${ctx.campanhas.pendentes().length}</dd></div>
      </dl>
    </section>

    <section class="painel">
      <h3 class="painel-titulo" id="pf-tema-t">Aparência</h3>
      <div class="painel-corpo temas" role="radiogroup" aria-labelledby="pf-tema-t">
        ${TEMAS.map(t => html`<label class="tema-opcao">
          <input type="radio" name="pf-tema" value="${t.valor}"${t.valor === temaEscolhido() ? html` checked` : ''}>
          <span class="tema-amostra tema-amostra-${t.valor}" aria-hidden="true">${icone(t.ico)}</span>
          <span class="tema-texto"><strong>${t.rotulo}</strong><small>${t.dica}</small></span>
        </label>`)}
      </div>
    </section>

    <section class="painel">
      <h3 class="painel-titulo">Relatório</h3>
      <div class="painel-corpo">
        <p class="campo-dica bloco-dica">Planilha com todas as campanhas, custo total, rebate e decisão. Dados Swile só saem nas campanhas que você pode ver.</p>
        <button type="button" class="btn btn-fantasma btn-largo" id="pf-excel">${icone('baixar')} Baixar planilha Excel</button>
      </div>
    </section>

    <button type="button" class="btn btn-fantasma btn-largo perfil-senha" id="pf-senha">${icone('cadeado')} Alterar senha</button>
    <button type="button" class="btn btn-perigo btn-largo" id="pf-sair">${icone('sair')} Sair da conta</button>
    <p class="versao versao-centro">Versão ${C.VERSAO}</p>
  </div>`);
}

// Alterar senha sem sair: confere a senha atual entrando de novo com ela,
// depois grava a nova. A sessão continua aberta.
async function alterarSenha(ctx) {
  let desligar = () => {};
  const val = (d, id) => d.querySelector('#' + id).value;
  await abrirDialogo({
    titulo: 'Alterar senha',
    descricao: 'Mínimo de 8 caracteres. Você continua conectado depois de trocar.',
    corpo: html`${campoSenha({ id: 'pf-atual', rotulo: 'Senha atual', autocomplete: 'current-password' })}
      ${campoSenha({ id: 'pf-nova', rotulo: 'Nova senha', novo: true })}
      ${campoSenha({ id: 'pf-nova2', rotulo: 'Repita a nova senha', autocomplete: 'new-password' })}`,
    acoes: [
      { rotulo: 'Cancelar', valor: null, tipo: 'fantasma' },
      { rotulo: 'Salvar nova senha', valor: 'salvar', tipo: 'primario', principal: true },
    ],
    aoAbrir: d => { desligar = ligarSenha(d, { email: () => ctx.perfil.email }); d.querySelector('#pf-atual').focus(); },
    antesDeFechar: async (_v, d) => {
      erroNoDialogo(d, '');
      const atual = val(d, 'pf-atual'), nova = val(d, 'pf-nova'), nova2 = val(d, 'pf-nova2');
      const erros = {};
      if (!atual) erros['pf-atual'] = 'Digite sua senha atual.';
      if (nova.length < 8) erros['pf-nova'] = 'A senha precisa ter pelo menos 8 caracteres.';
      else if (nova !== nova2) erros['pf-nova2'] = 'As duas senhas não são iguais.';
      if (aplicarErros(d, erros)) return false;

      const r1 = await sb.auth.signInWithPassword({ email: ctx.perfil.email, password: atual });
      if (r1.error) {
        if (/invalid login credentials/i.test(r1.error.message)) aplicarErros(d, { 'pf-atual': 'Senha atual incorreta.' });
        else { console.error(r1.error); erroNoDialogo(d, 'Não foi possível conferir a senha agora. Tente de novo.'); }
        return false;
      }
      const r2 = await sb.auth.updateUser({ password: nova });
      if (r2.error) {
        if (r2.error.code === 'same_password') aplicarErros(d, { 'pf-nova': 'A nova senha precisa ser diferente da anterior.' });
        else if (r2.error.code === 'weak_password') aplicarErros(d, { 'pf-nova': 'Senha fraca. Use mais caracteres, misturando letras e números.' });
        else { console.error(r2.error); erroNoDialogo(d, 'Não foi possível salvar agora. Tente de novo.'); }
        return false;
      }
      return true;
    },
  }).then(v => { if (v === 'salvar') ctx.toast('Senha alterada.', { tom: 'sucesso' }); });
  desligar();
}

export function montar(el, ctx) {
  ctx.cabecalho({ titulo: 'Perfil' });
  desenhar(el, ctx);
  const desligar = [
    ao(el, 'click', '#pf-excel', async (e, b) => {
      b.disabled = true; b.setAttribute('aria-busy', 'true');
      try {
        await exportarExcel(ctx.campanhas.todas(), ctx.cadastros);
        ctx.toast('Planilha gerada.', { tom: 'sucesso' });
      } catch (err) { ctx.toast(err.message, { tom: 'erro', duracao: 8000 }); }
      finally { b.disabled = false; b.removeAttribute('aria-busy'); }
    }),
    ao(el, 'click', '#pf-sair', () => ctx.sair()),
    ao(el, 'click', '#pf-senha', () => alterarSenha(ctx)),
    ao(el, 'change', 'input[name="pf-tema"]', (e, r) => escolherTema(r.value)),
    aoMudarTema(() => { const r = el.querySelector(`input[name="pf-tema"][value="${temaEscolhido()}"]`); if (r) r.checked = true; }),
    ctx.campanhas.assinar(() => { if (!el.querySelector('[aria-busy="true"]')) desenhar(el, ctx); }),
  ];
  return () => desligar.forEach(fn => fn());
}
