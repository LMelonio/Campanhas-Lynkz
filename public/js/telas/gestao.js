// Gestão: lista de empresas (#/gestao) e ficha da empresa (#/gestao/empresas/:id) com seus balconistas.
// Empresas vêm do Qlik; aqui só se cadastram balconistas (limite por empresa, contando desativados).
import { html, pintar, $, ao, debounce } from '../lib/dom.js';
import { calc, brl, dataBR, contem, maskCNPJ, maskCPF, maskTelefone, STATUS, LIMITES } from '../lib/regras.js';
import { icone } from '../ui/icones.js';
import { cartao, vazio, seloNeutro } from '../ui/pecas.js';
import { confirmar } from '../ui/avisos.js';
import { estadoLista } from '../ui/estado.js';
import { campoBusca, ligarBusca } from '../ui/campos.js';
import { dialogoEmpresa, dialogoBalconista, totalBalconistas, empresaCheia } from '../ui/cadastro-dialogos.js';
import { CHAVE_EMPRESA_SUGERIDA } from './nova.js';
import { ehDoQlik, textoBuscaEmpresa } from '../dados/cadastros.js';

const PASSO = 60;   // empresas desenhadas por vez (com o Qlik são milhares)
const filtros = { busca: '', inativas: false, balcInativos: false, limite: PASSO };
let s = null;   // { el, ctx, params, desligar[] }

// ---------- lista ----------
function desenharLista() {
  const { el, ctx } = s;
  // Conta campanhas por empresa uma vez só (antes era uma varredura por empresa).
  const nCamp = new Map();
  for (const c of ctx.campanhas.todas()) if (c.empresa_id != null) nCamp.set(String(c.empresa_id), (nCamp.get(String(c.empresa_id)) || 0) + 1);
  const lista = ctx.cadastros.empresas({ inativas: filtros.inativas }).filter(e => !filtros.busca
    || contem(filtros.busca, textoBuscaEmpresa(e, ctx.cadastros.balconistasDa(e.id))));
  const visiveis = lista.slice(0, filtros.limite);

  const est = estadoLista({ carregado: ctx.cadastros.carregado, erro: ctx.cadastros.erro });
  if (est) { pintar($('#gs-resumo', el), ''); pintar($('#gs-itens', el), est); return; }
  pintar($('#gs-resumo', el), `${lista.length.toLocaleString('pt-BR')} ${lista.length === 1 ? 'empresa' : 'empresas'}`);
  pintar($('#gs-itens', el), lista.length
    ? html`<ul class="empresas">${visiveis.map(e => {
        const nb = totalBalconistas(e.id);
        const nc = nCamp.get(String(e.id)) || 0;
        const local = [e.cidade, e.uf].filter(Boolean).join(' / ');
        return html`<li><a class="empresa-item" href="#/gestao/empresas/${e.id}">
          <span class="empresa-icone" aria-hidden="true">${icone('gestao')}</span>
          <span class="empresa-texto">
            <strong>${e.nome}${e.ativo ? '' : html` ${seloNeutro('Desativada')}`}</strong>
            ${e.nome_fantasia && e.nome_fantasia !== e.nome ? html`<small>${e.nome_fantasia}</small>` : ''}
            <small>${[e.codigo_cliente ? `Cód. ${e.codigo_cliente}` : '', local, e.cnpj ? maskCNPJ(e.cnpj) : ''].filter(Boolean).join(' · ') || 'Sem cidade e CNPJ'}</small>
            <small>Balconistas: ${nb} de ${LIMITES.balconistas_por_empresa} · ${nc} ${nc === 1 ? 'campanha' : 'campanhas'}</small>
          </span>
          ${icone('seta')}
        </a></li>`;
      })}</ul>
      ${lista.length > visiveis.length ? html`<button type="button" class="btn btn-fantasma btn-largo" id="gs-mais">Mostrar mais (${(lista.length - visiveis.length).toLocaleString('pt-BR')} restantes)</button>` : ''}`
    : vazio({
        icone: 'gestao',
        titulo: filtros.busca ? 'Nenhuma empresa encontrada' : 'Nenhuma empresa cadastrada',
        texto: filtros.busca ? 'A busca procura nome, nome fantasia, código do cliente, cidade, CNPJ, vendedor e balconistas.' : 'As empresas chegam pela sincronização com o Qlik.',
      }));
}

function montarLista() {
  const { el, ctx } = s;
  ctx.cabecalho({ titulo: 'Gestão' });
  pintar(el, html`
    <div class="secao-cabeca">
      <div>
        <h2 class="secao-titulo">Empresas e balconistas</h2>
        <p class="secao-nota">As empresas vêm do Qlik. Cada uma pode ter até ${LIMITES.balconistas_por_empresa} balconistas para receber premiações.</p>
      </div>
      <button type="button" class="btn btn-primario" id="gs-novo-balc">${icone('mais')} Cadastrar balconista</button>
    </div>
    <div class="ferramentas ferramentas-linha-larga">
      ${campoBusca({ id: 'gs-busca', rotulo: 'Buscar empresas', valor: filtros.busca, placeholder: 'Buscar empresa ou código', dica: 'Procura nome, nome fantasia, código do cliente, cidade, CNPJ, vendedor e balconistas.' })}
      <label class="interruptor sem-caixa" for="gs-inativas">
        <input type="checkbox" role="switch" id="gs-inativas"${filtros.inativas ? html` checked` : ''}>
        <span class="interruptor-trilho" aria-hidden="true"></span>
        <span class="interruptor-texto">Mostrar desativadas</span>
      </label>
    </div>
    <p class="lista-resumo" id="gs-resumo" role="status"></p>
    <div id="gs-itens"></div>`);

  const buscar = debounce(v => { filtros.busca = v; filtros.limite = PASSO; desenharLista(); }, 200);
  s.desligar.push(
    ao(el, 'input', '#gs-busca', (e, i) => buscar(i.value)),
    ao(el, 'change', '#gs-inativas', async (e, cb) => {
      filtros.inativas = cb.checked; filtros.limite = PASSO;
      if (cb.checked) await ctx.cadastros.carregarInativas();   // E1: desativadas só sob demanda
      desenharLista();
    }),
    ao(el, 'click', '#gs-mais', () => { filtros.limite += PASSO * 5; desenharLista(); }),
    ao(el, 'click', '#gs-novo-balc', async () => {
      const b = await dialogoBalconista(null);
      if (b) {
        const e = ctx.cadastros.empresa(b.empresa_id);
        ctx.toast(`${b.nome_completo} cadastrado${e ? ` em ${e.nome}` : ''}.`, {
          tom: 'sucesso', duracao: 7000,
          acao: { rotulo: 'Ver empresa', aoClicar: () => ctx.navegar(`#/gestao/empresas/${b.empresa_id}`) },
        });
      }
    }),
    () => buscar.cancelar(),
    ligarBusca(el),
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
    pintar(el, estadoLista({ carregado: ctx.cadastros.carregado, erro: ctx.cadastros.erro })
      || vazio({ icone: 'gestao', titulo: 'Empresa não encontrada', acao: { href: '#/gestao', rotulo: 'Ver empresas' } }));
    return;
  }
  ctx.cabecalho({ titulo: e.nome, voltar: '#/gestao' });
  const camps = ctx.campanhas.todas().filter(c => String(c.empresa_id) === String(e.id));
  const aprov = camps.filter(c => c.status === STATUS.APROVADA);
  const investido = aprov.reduce((t, c) => t + calc(c).total, 0);
  const balcs = ctx.cadastros.balconistasDa(e.id, { inativos: filtros.balcInativos });
  const nInativos = ctx.cadastros.balconistasDa(e.id, { inativos: true }).filter(b => !b.ativo).length;
  const total = totalBalconistas(e.id), cheia = empresaCheia(e.id), max = LIMITES.balconistas_por_empresa;
  const rolagem = window.scrollY;

  pintar(el, html`<div class="ficha">
    <header class="det-cabeca">
      <div class="det-linha"><span class="det-empresa">${icone('gestao')}Empresa</span>${e.ativo ? '' : seloNeutro('Desativada')}</div>
      <h2 class="det-titulo">${e.nome}</h2>
      <p class="det-sub">${[e.nome_fantasia && e.nome_fantasia !== e.nome ? e.nome_fantasia : '', [e.cidade, e.uf].filter(Boolean).join(' / '), e.cnpj ? maskCNPJ(e.cnpj) : ''].filter(Boolean).join(' · ') || 'Sem cidade e CNPJ'}</p>
    </header>

    <dl class="numeros numeros-3">
      <div class="numero"><dt>Investido em aprovadas</dt><dd class="num-display valor">R$ ${brl(investido)}</dd></div>
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
        ${ehDoQlik(e) ? html`<p class="painel-corpo nota">${icone('info')}<span>Nome, CNPJ e cidade vêm do Qlik${e.sincronizado_em ? ` (atualizado em ${dataBR(e.sincronizado_em)})` : ''}. Aqui você edita telefone e observações.</span></p>` : ''}
        <dl class="linhas">
          ${e.codigo_cliente ? html`<div><dt>Código do cliente</dt><dd>${e.codigo_cliente}</dd></div>` : ''}
          ${e.nome_fantasia ? html`<div><dt>Nome fantasia</dt><dd>${e.nome_fantasia}</dd></div>` : ''}
          <div><dt>CNPJ</dt><dd>${e.cnpj ? maskCNPJ(e.cnpj) : '—'}</dd></div>
          <div><dt>Cidade</dt><dd>${[e.cidade, e.uf].filter(Boolean).join(' / ') || '—'}</dd></div>
          ${e.vendedor ? html`<div><dt>Vendedor</dt><dd>${e.vendedor}</dd></div>` : ''}
          <div><dt>Telefone</dt><dd>${e.telefone ? maskTelefone(e.telefone) : '—'}</dd></div>
          ${e.observacoes ? html`<div class="empilhada"><dt>Observações</dt><dd>${e.observacoes}</dd></div>` : ''}
          <div><dt>Cadastrada em</dt><dd>${dataBR(e.criado_em)}${e.origem === 'planilha' ? ' (planilha antiga)' : ''}</dd></div>
          ${e.atualizado_em ? html`<div><dt>Última alteração</dt><dd>${dataBR(e.atualizado_em)}</dd></div>` : ''}
        </dl>
      </section>

      <section class="painel">
        <h3 class="painel-titulo"><span>Balconistas <span class="vagas">${total} de ${max}</span></span>
          <button type="button" class="btn btn-fantasma btn-pequeno" id="fx-novo-balc"${e.ativo && !cheia ? '' : html` disabled`}
            aria-describedby="fx-vagas">${icone('mais')} Cadastrar</button>
        </h3>
        <p class="painel-corpo campo-dica" id="fx-vagas">${!e.ativo ? 'Empresa desativada não recebe balconista novo.'
          : cheia ? `Limite de ${max} balconistas atingido (contando os desativados). Para trocar a pessoa, edite um dos cadastros.`
          : `Cabe${max - total === 1 ? '' : 'm'} mais ${max - total} ${max - total === 1 ? 'balconista' : 'balconistas'}. Eles aparecem para escolha na Nova campanha.`}</p>
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
      : vazio({ icone: 'campanhas', titulo: 'Nenhuma campanha ligada a esta empresa', texto: 'Campanhas antigas, registradas sem o cadastro da empresa, não aparecem aqui.' })}
  </div>`);
  window.scrollTo(0, rolagem);
}

async function alternarEmpresa(ctx, e) {
  if (e.ativo) {
    const pend = ctx.campanhas.pendentes().filter(c => String(c.empresa_id) === String(e.id)).length;
    const ok = await confirmar({
      titulo: `Desativar ${e.nome}?`,
      descricao: 'Ela some da lista ao criar campanhas. O histórico continua, e dá para reativar depois.'
        + (pend ? ` ${pend} ${pend === 1 ? 'campanha pendente continua' : 'campanhas pendentes continuam'} na fila de aprovação.` : ''),
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
  // Redesenha ao vivo, mas nunca com um diálogo aberto por cima: se houver
  // um, espera ele fechar (senão a edição feita no diálogo não aparecia).
  let adiado = false;
  const ao_vivo = () => {
    const d = document.querySelector('dialog[open]');
    if (!d) { s?.redesenhar?.(); return; }
    if (adiado) return;
    adiado = true;
    d.addEventListener('close', () => { adiado = false; s?.redesenhar?.(); }, { once: true });
  };
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
