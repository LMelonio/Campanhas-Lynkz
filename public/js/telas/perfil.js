// ============================================================
//  PERFIL — dados, resumo, Excel, sair e versão.
// ============================================================
import { html, pintar, ao } from '../lib/dom.js';
import { STATUS, PAPEL } from '../lib/regras.js';
import { icone } from '../ui/icones.js';
import { seloNeutro } from '../ui/pecas.js';
import { exportarExcel } from '../exportar.js';

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
        ${seloNeutro(p.papel === PAPEL.APROVADOR ? 'Aprovador' : 'Coordenador')}
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
      <h3 class="painel-titulo">Relatório</h3>
      <div class="painel-corpo">
        <p class="campo-dica bloco-dica">Planilha com todas as campanhas, custo total, rebate e decisão. Dados Swile só saem nas campanhas que você pode ver.</p>
        <button type="button" class="btn btn-fantasma btn-largo" id="pf-excel">${icone('baixar')} Baixar planilha Excel</button>
      </div>
    </section>

    <button type="button" class="btn btn-perigo btn-largo" id="pf-sair">${icone('sair')} Sair da conta</button>
    <p class="versao versao-centro">Versão ${C.VERSAO}</p>
  </div>`);
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
    ctx.campanhas.assinar(() => { if (!el.querySelector('[aria-busy="true"]')) desenhar(el, ctx); }),
  ];
  return () => desligar.forEach(fn => fn());
}
