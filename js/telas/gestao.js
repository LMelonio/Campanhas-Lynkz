// ============================================================
//  GESTÃO — empresas e balconistas.
//  #/gestao               lista de empresas
//  #/gestao/empresas/:id  ficha da empresa
//  Todo usuário ativo cadastra e edita. Nada é apagado, só desativado.
// ============================================================
import { html, pintar, $, ao, debounce } from '../lib/dom.js';
import { calc, brl, dataBR, contem, maskCNPJ, maskCPF, maskTelefone, STATUS } from '../lib/regras.js';
import { icone } from '../ui/icones.js';
import { cartao, vazio, seloNeutro } from '../ui/pecas.js';
import { confirmar } from '../ui/avisos.js';
import { dialogoEmpresa, dialogoBalconista } from '../ui/cadastro-dialogos.js';
import { CHAVE_EMPRESA_SUGERIDA } from './nova.js';

const filtros = { busca: '', inativas: false, balcInativos: false };
let s = null;   // { el, ctx, params, desligar[] }

// ---------- lista ----------
function desenharLista() {
  const { el, ctx } = s;
  const todas = ctx.campanhas.todas();
  const lista = ctx.cadastros.empresas({ inativas: filtros.inativas }).filter(e => !filtros.busca || contem(filtros.busca,
    `${e.nome} ${e.cidade || ''} ${e.cnpj || ''} ${ctx.cadastros.balconistasDa(e.id).map(b => b.nome_completo).join(' ')}`));

  pintar($('#gs-resumo', el), `${lista.length} ${lista.length === 1 ? 'empresa' : 'empresas'}`);
  pintar($('#gs-itens', el), lista.length
    ? html`<ul class="empresas">${lista.map(e => {
        const nb = ctx.cadastros.balconistasDa(e.id).length;
        const nc = todas.filter(c => String(c.empresa_id) === String(e.id)).length;
        return html`<li><a class="empresa-item" href="#/gestao/empresas/${e.id}">
          <span class="empresa-icone" aria-hidden="true">${icone('gestao')}</span>
          <span class="empresa-texto">
            <strong>${e.nome}${e.ativo ? '' : html` ${seloNeutro('Desativada')}`}</strong>
            <small>${[e.cidade, e.cnpj ? maskCNPJ(e.cnpj) : ''].filter(Boolean).join(' · ') || 'Sem cidade e CNPJ'}</small>
            <small>${nb} ${nb === 1 ? 'balconista' : 'balconistas'} · ${nc} ${nc === 1 ? 'campanha' : 'campanhas'}</small>
          </span>
          ${icone('seta')}
        </a></li>`;
      })}</ul>`
    : vazio({
        icone: 'gestao',
        titulo: filtros.busca ? 'Nenhuma empresa encontrada' : 'Nenhuma empresa cadastrada',
        texto: filtros.busca ? 'A busca também procura pelo nome dos balconistas.' : 'Cadastre a primeira para usá-la nas campanhas.',
      }));
}

function montarLista() {
  const { el, ctx } = s;
  ctx.cabecalho({ titulo: 'Gestão' });
  pintar(el, html`
    <div class="secao-cabeca">
      <div>
        <h2 class="secao-titulo">Empresas e balconistas</h2>
        <p class="secao-nota">Todo usuário ativo cadastra e edita. Nada é apagado: quem sai é desativado.</p>
      </div>
      <button type="button" class="btn btn-primario" id="gs-nova">${icone('mais')} Cadastrar empresa</button>
    </div>
    <div class="ferramentas ferramentas-linha-larga">
      <div class="campo busca">
        <label class="so-leitor" for="gs-busca">Buscar empresas</label>
        ${icone('busca')}
        <input id="gs-busca" type="search" value="${filtros.busca}" placeholder="Empresa, cidade, CNPJ ou balconista" autocomplete="off">
      </div>
      <label class="interruptor sem-caixa" for="gs-inativas">
        <input type="checkbox" role="switch" id="gs-inativas"${filtros.inativas ? html` checked` : ''}>
        <span class="interruptor-trilho" aria-hidden="true"></span>
        <span class="interruptor-texto">Mostrar desativadas</span>
      </label>
    </div>
    <p class="lista-resumo" id="gs-resumo" role="status"></p>
    <div id="gs-itens"></div>`);

  const buscar = debounce(v => { filtros.busca = v; desenharLista(); }, 200);
  s.desligar.push(
    ao(el, 'input', '#gs-busca', (e, i) => buscar(i.value)),
    ao(el, 'change', '#gs-inativas', (e, cb) => { filtros.inativas = cb.checked; desenharLista(); }),
    ao(el, 'click', '#gs-nova', async () => {
      const e = await dialogoEmpresa();
      if (e) { ctx.toast(`Empresa ${e.nome} cadastrada.`, { tom: 'sucesso' }); ctx.navegar(`#/gestao/empresas/${e.id}`); }
    }),
    () => buscar.cancelar(),
  );
  s.redesenhar = desenharLista;
  desenharLista();
}

// ---------- ficha da empresa ----------
function desenharFicha() {
  const { el, ctx, params } = s;
  const e = ctx.cadastros.empresa(params.empresa);
  if (!e) {
    ctx.cabecalho({ titulo: 'Empresa', voltar: '#/gestao' });
    pintar(el, vazio({ icone: 'gestao', titulo: ctx.cadastros.carregado ? 'Empresa não encontrada' : 'Carregando…', acao: { href: '#/gestao', rotulo: 'Ver empresas' } }));
    return;
  }
  ctx.cabecalho({ titulo: e.nome, voltar: '#/gestao' });
  const camps = ctx.campanhas.todas().filter(c => String(c.empresa_id) === String(e.id));
  const aprov = camps.filter(c => c.status === STATUS.APROVADA);
  const investido = aprov.reduce((t, c) => t + calc(c).total, 0);
  const balcs = ctx.cadastros.balconistasDa(e.id, { inativos: filtros.balcInativos });
  const nInativos = ctx.cadastros.balconistasDa(e.id, { inativos: true }).filter(b => !b.ativo).length;
  const rolagem = window.scrollY;

  pintar(el, html`<div class="ficha">
    <header class="det-cabeca">
      <div class="det-linha"><span class="det-empresa">${icone('gestao')}Empresa</span>${e.ativo ? '' : seloNeutro('Desativada')}</div>
      <h2 class="det-titulo">${e.nome}</h2>
      <p class="det-sub">${[e.cidade, e.cnpj ? maskCNPJ(e.cnpj) : ''].filter(Boolean).join(' · ') || 'Sem cidade e CNPJ'}</p>
    </header>

    <dl class="numeros numeros-3">
      <div class="numero"><dt>Investido em aprovadas</dt><dd class="num-display">R$ ${brl(investido)}</dd></div>
      <div class="numero"><dt>Campanhas</dt><dd class="num-display">${camps.length}</dd></div>
      <div class="numero"><dt>Balconistas ativos</dt><dd class="num-display">${ctx.cadastros.balconistasDa(e.id).length}</dd></div>
    </dl>

    <div class="det-paineis">
      <section class="painel">
        <h3 class="painel-titulo">Dados da empresa
          <span class="acoes">
            <button type="button" class="btn btn-fantasma btn-pequeno" id="fx-editar">${icone('editar')} Editar</button>
            <button type="button" class="btn ${e.ativo ? 'btn-perigo' : 'btn-fantasma'} btn-pequeno" id="fx-ativo">${e.ativo ? 'Desativar' : 'Reativar'}</button>
          </span>
        </h3>
        <dl class="linhas">
          <div><dt>CNPJ</dt><dd>${e.cnpj ? maskCNPJ(e.cnpj) : '—'}</dd></div>
          <div><dt>Cidade</dt><dd>${e.cidade || '—'}</dd></div>
          <div><dt>Telefone</dt><dd>${e.telefone ? maskTelefone(e.telefone) : '—'}</dd></div>
          ${e.observacoes ? html`<div class="empilhada"><dt>Observações</dt><dd>${e.observacoes}</dd></div>` : ''}
          <div><dt>Cadastrada em</dt><dd>${dataBR(e.criado_em)}</dd></div>
          ${e.atualizado_em ? html`<div><dt>Última alteração</dt><dd>${dataBR(e.atualizado_em)}</dd></div>` : ''}
        </dl>
      </section>

      <section class="painel">
        <h3 class="painel-titulo">Balconistas
          <button type="button" class="btn btn-fantasma btn-pequeno" id="fx-novo-balc"${e.ativo ? '' : html` disabled`}>${icone('mais')} Cadastrar</button>
        </h3>
        ${balcs.length ? html`<ul class="balconistas">${balcs.map(b => html`<li class="balconista${b.ativo ? '' : ' inativo'}">
          <div class="balconista-dados">
            <strong>${b.nome_completo}${b.ativo ? '' : html` ${seloNeutro('Desativado')}`}</strong>
            <small>CPF ${maskCPF(b.cpf)} · Nasc. ${dataBR(b.data_nascimento)}</small>
            <small>${b.email} · ${maskTelefone(b.telefone)}</small>
          </div>
          <div class="acoes">
            <button type="button" class="btn btn-fantasma btn-pequeno" data-editar-balc="${b.id}" aria-label="Editar ${b.nome_completo}">${icone('editar')} Editar</button>
            <button type="button" class="btn ${b.ativo ? 'btn-perigo' : 'btn-fantasma'} btn-pequeno" data-ativo-balc="${b.id}" aria-label="${b.ativo ? 'Desativar' : 'Reativar'} ${b.nome_completo}">${b.ativo ? 'Desativar' : 'Reativar'}</button>
          </div>
        </li>`)}</ul>` : html`<p class="painel-corpo campo-dica">Nenhum balconista ${filtros.balcInativos ? '' : 'ativo '}cadastrado.</p>`}
        ${nInativos ? html`<div class="painel-corpo"><label class="interruptor sem-caixa" for="fx-balc-inativos">
          <input type="checkbox" role="switch" id="fx-balc-inativos"${filtros.balcInativos ? html` checked` : ''}>
          <span class="interruptor-trilho" aria-hidden="true"></span>
          <span class="interruptor-texto">Mostrar desativados (${nInativos})</span></label></div>` : ''}
      </section>
    </div>

    <div class="secao-cabeca">
      <h2 class="secao-titulo">Campanhas desta empresa</h2>
      ${e.ativo ? html`<a class="btn btn-fantasma btn-pequeno" href="#/nova" data-nova-empresa="${e.id}">${icone('mais')} Nova campanha</a>` : ''}
    </div>
    ${camps.length ? html`<div class="grade-cartoes">${camps.map(c => cartao(c))}</div>`
      : vazio({ icone: 'campanhas', titulo: 'Nenhuma campanha ligada a esta empresa', texto: 'Campanhas da v1, sem cadastro de empresa, não aparecem aqui.' })}
  </div>`);
  window.scrollTo(0, rolagem);
}

async function alternarEmpresa(ctx, e) {
  if (e.ativo) {
    const ok = await confirmar({
      titulo: `Desativar ${e.nome}?`,
      descricao: 'Ela some da lista ao criar campanhas. O histórico continua, e dá para reativar depois.',
      confirmar: 'Desativar', perigo: true,
    });
    if (!ok) return;
  }
  try {
    await ctx.cadastros.salvarEmpresa({ ativo: !e.ativo }, e.id);
    ctx.toast(e.ativo ? `${e.nome} desativada.` : `${e.nome} reativada.`, { tom: 'sucesso' });
  } catch (err) { ctx.toast(err.message, { tom: 'erro' }); }
}

async function alternarBalconista(ctx, b) {
  if (b.ativo) {
    const ok = await confirmar({
      titulo: `Desativar ${b.nome_completo}?`,
      descricao: 'Deixa de aparecer ao criar campanhas. As campanhas antigas continuam ligadas a ele.',
      confirmar: 'Desativar', perigo: true,
    });
    if (!ok) return;
  }
  try {
    await ctx.cadastros.salvarBalconista({ ativo: !b.ativo }, b.id);
    ctx.toast(b.ativo ? `${b.nome_completo} desativado.` : `${b.nome_completo} reativado.`, { tom: 'sucesso' });
  } catch (err) { ctx.toast(err.message, { tom: 'erro' }); }
}

function montarFicha() {
  const { el, ctx } = s;
  const empresaAtual = () => ctx.cadastros.empresa(s.params.empresa);
  s.desligar.push(
    ao(el, 'click', '#fx-editar', async () => {
      const e = await dialogoEmpresa(empresaAtual());
      if (e) ctx.toast('Dados da empresa salvos.', { tom: 'sucesso' });
    }),
    ao(el, 'click', '#fx-ativo', () => alternarEmpresa(ctx, empresaAtual())),
    ao(el, 'click', '#fx-novo-balc', async () => {
      const b = await dialogoBalconista(s.params.empresa);
      if (b) ctx.toast(`${b.nome_completo} cadastrado.`, { tom: 'sucesso' });
    }),
    ao(el, 'click', '[data-editar-balc]', async (ev, btn) => {
      const b = await dialogoBalconista(s.params.empresa, ctx.cadastros.balconista(btn.dataset.editarBalc));
      if (b) ctx.toast('Dados do balconista salvos.', { tom: 'sucesso' });
    }),
    ao(el, 'click', '[data-ativo-balc]', (ev, btn) => alternarBalconista(ctx, ctx.cadastros.balconista(btn.dataset.ativoBalc))),
    ao(el, 'click', '[data-nova-empresa]', (ev, a) => {
      try { sessionStorage.setItem(CHAVE_EMPRESA_SUGERIDA, a.dataset.novaEmpresa); } catch { /* segue sem sugestão */ }
    }),
    ao(el, 'change', '#fx-balc-inativos', (ev, cb) => { filtros.balcInativos = cb.checked; desenharFicha(); $('#fx-balc-inativos', el)?.focus(); }),
  );
  s.redesenhar = desenharFicha;
  desenharFicha();
}

function montarAtual() {
  s.desligar.forEach(fn => fn());
  s.desligar = [];
  window.scrollTo(0, 0);
  if (s.params.empresa) montarFicha(); else montarLista();
  // Redesenha ao vivo, mas nunca com um diálogo aberto por cima.
  const ao_vivo = () => { if (!document.querySelector('dialog[open]')) s?.redesenhar?.(); };
  s.desligar.push(s.ctx.cadastros.assinar(ao_vivo), s.ctx.campanhas.assinar(ao_vivo));
}

export function montar(el, ctx, params) {
  s = { el, ctx, params, desligar: [], redesenhar: null };
  montarAtual();
  const meu = s;
  return () => { meu.desligar.forEach(fn => fn()); if (s === meu) s = null; };
}

export function atualizar(params) {
  if (!s) return;
  s.params = params;
  montarAtual();
}
