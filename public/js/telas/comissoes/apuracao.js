// Comissões → Apuração: vendas do mês no Qlik, cálculo de cada pessoa, "Novos no Qlik" (um a um ou em lote)
// e "Desativados com venda no Qlik" (reativar).
// Os documentos e o fechamento do mês ficam em documentos.js.
import { html, pintar, $, $$, ao } from '../../lib/dom.js';
import { dataBR, horaBR } from '../../lib/regras.js';
import { REGIMES, ROTULO_REGIME, ehPJ, pctPadrao, errosComissionado, novoDoQlik } from '../../lib/comissoes.js';
import { comissoes } from '../../dados/comissoes.js';
import { detalhar } from '../../dados/erros.js';
import { icone } from '../../ui/icones.js';
import { carregando } from '../../ui/pecas.js';
import { confirmar } from '../../ui/avisos.js';
import { selecao, aplicarErros } from '../../ui/campos.js';
import { s, r$, pctTxt, pct1, mesMinusculo, quemFechou, redesenhar, recalcular, ocupar } from './comum.js';
import { documentosHtml, faixaFechar } from './documentos.js';
import { editar } from './cadastro.js';

export function desenhar() {
  const r = s.resultado;
  return html`
    ${s.erroQlik ? html`<p class="nota nota-alerta" role="alert">${icone('alerta')}<span>${s.erroQlik}</span></p>` : ''}
    ${s.buscando && !r ? carregando(2) : r ? resultadoHtml(r) : html`<p class="nota">${icone('info')}<span>Escolha o mês e busque as vendas. As pessoas vêm do Qlik; premiações e metas do Contrato ficam gravadas nas outras abas.</span></p>`}`;
}

function resultadoHtml(r) {
  const t = r.totais;
  const semCad = r.semCadastro.reduce((x, v) => x + v.total, 0);
  const f = r.fechado;
  const reaberto = !f && comissoes.fechamento(r.mes);
  return html`
    ${f ? html`<p class="nota cm-fechado">${icone('cadeado')}<span>Mês fechado em ${quemFechou(f)}. Os valores abaixo são a cópia do histórico: não mudam com o Qlik nem com o cadastro.</span></p>` : ''}
    ${reaberto ? html`<p class="nota nota-alerta">${icone('alerta')}<span>Mês reaberto em ${dataBR(reaberto.reaberto_em)}: ${reaberto.motivo_reabertura}. Feche de novo depois de corrigir.</span></p>` : ''}
    <section class="destaque cm-destaque" aria-labelledby="cm-total-t">
      <p class="destaque-rotulo" id="cm-total-t">${f ? 'Pago' : 'A pagar'} em ${mesMinusculo(r.mes)}</p>
      <p class="cm-total num-display">${r$(t.geral.valor_pagar)}</p>
      <p class="destaque-sub">${f ? `Consulta ao Qlik de ${dataBR(r.consulta.consultado_em)} às ${horaBR(r.consulta.consultado_em)}, gravada no fechamento.` : `Consulta ao Qlik às ${horaBR(r.consulta.consultado_em)}. Premiações, ajustes e metas vêm do que está gravado.`}</p>
    </section>
    <dl class="numeros numeros-3 cm-numeros">
      <div class="numero"><dt>CLT (folha)</dt><dd class="num-display">${r$(t.clt.valor_pagar)}</dd></div>
      <div class="numero"><dt>PJ (ADP com NF)</dt><dd class="num-display">${r$(t.pj.valor_pagar)}</dd></div>
      <div class="numero${r.semCadastro.length ? ' cm-numero-alerta' : ''}"><dt>Novos no Qlik</dt><dd class="num-display">${r$(semCad)}</dd></div>
    </dl>
    ${documentosHtml(r)}

    ${r.semCadastro.length ? novosHtml(r) : ''}
    ${desativadosHtml(r)}
    ${r.consulta.sem_vendedor ? html`<p class="nota">${icone('info')}<span>${r$(r.consulta.sem_vendedor)} em vendas sem vendedor no Qlik ficaram de fora.</span></p>` : ''}

    ${tabela('Vendedores CLT', r.linhas.filter(l => !ehPJ(l)), false)}
    ${tabela('Representantes PJ', r.linhas.filter(ehPJ), true)}
    ${r.ignorados.length ? html`<p class="secao-nota">Não comissionam: ${r.ignorados.map(x => `${x.vendedor} (${r$(x.total)})`).join(', ')}. Para mudar, vá em Parâmetros.</p>` : ''}
    ${f ? '' : faixaFechar(r)}`;
}

const alertasHtml = l => (l.alertas.length ? html`<small class="cm-alerta-linha">${icone('alerta')}<span>${l.alertas.map(a => a.texto).join(' ')}</span></small>` : '');

function contratoHtml(c) {
  if (!c || c.motivo === 'Sem meta cadastrada') return html`<span class="cm-sub">Sem meta</span>`;
  const conta = `Faturamento ${pct1(c.pct_faturamento)}, positivação ${c.positivados} de ${c.meta_positivacao}${c.informado ? ' (informado)' : ''}`;
  return c.atingiu
    ? html`${r$(c.valor)}<small class="cm-sub">${conta}: ${pctTxt(c.pct_premio)}</small>`
    : html`<span class="cm-sub cm-nao">Não atingiu</span><small class="cm-sub">${conta}</small>`;
}

function tabela(titulo, ls, pj) {
  if (!ls.length) return '';
  const id = pj ? 'cm-t-pj' : 'cm-t-clt';
  return html`<section aria-labelledby="${id}">
    <h2 class="secao-titulo" id="${id}">${titulo} <span class="contador-texto">${ls.length}</span></h2>
    <div class="tabela-caixa"><table class="tabela cm-tabela">
      <thead><tr><th scope="col">${pj ? 'Representante' : 'Vendedor'}</th><th scope="col" class="num">Venda principal</th><th scope="col" class="num">Farelo</th>
        <th scope="col" class="num">Comissão</th><th scope="col" class="num">Premiações</th><th scope="col" class="num">${pj ? 'Contrato de Resultado' : 'Acordo mínimo'}</th><th scope="col" class="num">A pagar</th></tr></thead>
      <tbody>${ls.map(l => html`<tr>
        <td data-rotulo="${pj ? 'Representante' : 'Vendedor'}" class="principal"><strong>${l.nome}</strong>
          <small class="cm-sub">${l.regime === 'TELEVENDAS' ? 'Televendas, ' : ''}${pctTxt(l.pct_principal)} e ${pctTxt(l.pct_farelo)} no Farelo${l.equipe ? `, ${l.equipe}` : ''}</small>${alertasHtml(l)}
          ${pj && l.valor_pagar > 0 ? html`<button type="button" class="btn btn-texto btn-pequeno cm-recibo" data-recibo="${l.id}" aria-label="Baixar recibo de ${l.nome}">${icone('baixar')} Recibo</button>` : ''}</td>
        <td data-rotulo="Venda principal" class="num tabular">${r$(l.venda_principal)}</td>
        <td data-rotulo="Farelo" class="num tabular">${r$(l.venda_farelo)}</td>
        <td data-rotulo="Comissão" class="num tabular">${r$(l.comissao_total)}</td>
        <td data-rotulo="Premiações" class="num tabular">${l.premiacoes ? r$(l.premiacoes) : '—'}${l.ajustes ? html`<small class="cm-sub">Ajustes ${l.ajustes > 0 ? '+' : '−'}${r$(Math.abs(l.ajustes))}</small>` : ''}</td>
        <td data-rotulo="${pj ? 'Contrato de Resultado' : 'Acordo mínimo'}" class="num tabular">${pj ? contratoHtml(l.contrato)
          : l.acordo ? html`${r$(l.acordo.valor)}${l.piso_aplicado ? html`<small class="cm-sub">Paga o acordo</small>` : ''}` : '—'}</td>
        <td data-rotulo="A pagar" class="num tabular cm-pagar">${r$(l.valor_pagar)}</td>
      </tr>`)}</tbody>
    </table></div></section>`;
}

async function buscar() {
  if (s.buscando) return;
  const meu = s;
  s.buscando = true; s.erroQlik = null;
  redesenhar();
  try {
    const r = await comissoes.apurar(s.mes);
    if (s === meu) s.resultado = r;
  } catch (e) {
    if (s === meu) s.erroQlik = detalhar(e).mensagem;
  }
  if (s !== meu) return;
  s.buscando = false;
  redesenhar();
}

// ---------- Novos no Qlik ----------
function novosHtml(r) {
  const f = r.fechado;
  const lote = !f && r.semCadastro.length >= 2;
  const valores = x => html`<strong>${x.vendedor}</strong><small class="tabular">${r$(x.total)}${x.farelo ? `, Farelo ${r$(x.farelo)}` : ''}</small>`;
  return html`<section class="painel cm-sem" aria-labelledby="cm-t-sem">
      <h2 class="painel-titulo" id="cm-t-sem">Novos no Qlik</h2>
      <p class="painel-corpo campo-dica">${f ? 'Vendedores sem cadastro quando o mês foi fechado: as vendas deles ficaram fora da comissão.' : 'Vendedores que apareceram no Qlik e ainda não têm regime nem percentual. Até completar o cadastro, as vendas deles não entram em nenhuma comissão.'}</p>
      ${lote ? loteHtml(r.semCadastro) : ''}
      <ul class="cm-sem-lista">${r.semCadastro.map(x => html`<li>
        ${lote
          ? html`<label class="cm-sem-marca"><input type="checkbox" data-lote="${x.vendedor}"${s.lote.has(x.vendedor) ? html` checked` : ''}><span>${valores(x)}</span></label>`
          : html`<div>${valores(x)}</div>`}
        ${f ? '' : html`<div class="acoes">
          <button type="button" class="btn btn-fantasma btn-pequeno" data-completar="${x.vendedor}" aria-label="Completar cadastro: ${x.vendedor}">${icone('pessoa')} Completar cadastro</button>
          <button type="button" class="btn btn-texto btn-pequeno" data-ignorar="${x.vendedor}" aria-label="Não comissiona: ${x.vendedor}">Não comissiona</button>
        </div>`}</li>`)}</ul>
    </section>`;
}

// ---------- Desativados com venda no Qlik ----------
// Venda, premiação ou ajuste de quem foi desativado não entra no total: reativar devolve a pessoa à conta.
function desativadosHtml(r) {
  const vendas = r.desativados || [];
  const orfaos = r.lancamentosOrfaos || [];
  if (!vendas.length && !orfaos.length) return '';
  const pessoas = new Map();
  const pessoa = (id, nome) => pessoas.get(id) || pessoas.set(id, { id, nome, vendas: [], lancamentos: [] }).get(id);
  for (const v of vendas) pessoa(v.id, v.nome).vendas.push(v);
  for (const o of orfaos) pessoa(o.comissionado_id, o.nome).lancamentos.push(o);
  const f = r.fechado;
  return html`<section class="painel cm-desativados" aria-labelledby="cm-t-desativados">
    <h2 class="painel-titulo" id="cm-t-desativados">Desativados com venda no Qlik</h2>
    <p class="painel-corpo campo-dica">${f ? 'Cadastros desativados quando o mês foi fechado: as vendas e lançamentos deles ficaram fora da comissão.' : 'Estas pessoas estão desativadas no Cadastro. As vendas, premiações e ajustes delas não entram no total até reativar.'}</p>
    <ul class="cm-sem-lista">${[...pessoas.values()].map(p => html`<li>
      <div><strong>${p.nome}</strong>
        ${p.vendas.map(v => html`<small class="tabular">${v.vendedor}: ${r$(v.total)}${v.farelo ? `, Farelo ${r$(v.farelo)}` : ''}</small>`)}
        ${p.lancamentos.map(o => html`<small class="tabular">${o.tipo === 'premiacao' ? 'Premiação' : 'Ajuste'} ${o.descricao ? `"${o.descricao}" ` : ''}${r$(o.valor)}</small>`)}</div>
      ${f ? '' : html`<div class="acoes"><button type="button" class="btn btn-fantasma btn-pequeno" data-reativar="${p.id}" aria-label="Reativar ${p.nome}">Reativar</button></div>`}
    </li>`)}</ul>
  </section>`;
}

async function reativar(id) {
  const c = comissoes.cadastro().find(x => String(x.id) === String(id));
  if (!c) return;
  const ok = await confirmar({
    titulo: `Reativar ${c.nome}?`,
    descricao: 'Volta para a apuração com o regime e os % do cadastro. As vendas, premiações e ajustes do mês entram no total.',
    confirmar: 'Reativar',
  });
  if (!ok || !s) return;
  const meu = s;
  try {
    await comissoes.salvar({ ...c, ativo: true }, c.id);
    if (s !== meu) return;
    await recalcular();
    s.ctx.toast(`Cadastro de ${c.nome} reativado e de volta na apuração.`, { tom: 'sucesso' });
    redesenhar();
  } catch (e) { s.ctx.toast(detalhar(e).mensagem, { tom: 'erro' }); }
}

async function ignorarNome(nome) {
  const ok = await confirmar({
    titulo: `${nome} não comissiona?`,
    descricao: 'As vendas com este nome no Qlik deixam de aparecer como novas. Dá para desfazer em Parâmetros.',
    confirmar: 'Não comissiona',
  });
  if (!ok) return;
  try {
    await comissoes.ignorarNome(nome);
    await recalcular();
    s.ctx.toast(`${nome} não comissiona.`, { tom: 'sucesso' });
    redesenhar();
  } catch (e) { s.ctx.toast(detalhar(e).mensagem, { tom: 'erro' }); }
}

// Em lote: marcar vários e cadastrar com os % padrão dos Parâmetros, ou "não comissiona".
const ACOES_LOTE = [
  { valor: 'ignorar', rotulo: 'Não comissiona' },
  ...REGIMES.map(r => ({ valor: r, rotulo: `Cadastrar como ${ROTULO_REGIME[r]}` })),
];
const textoLote = n => (n ? `${n} ${n === 1 ? 'marcado' : 'marcados'}` : 'Nenhum marcado');

function loteHtml(novos) {
  const n = novos.filter(x => s.lote.has(x.vendedor)).length;
  return html`<div class="cm-lote" role="group" aria-label="Vários de uma vez">
    <div class="cm-lote-topo">
      <label class="cm-lote-todos"><input type="checkbox" id="cm-lote-todos"${n === novos.length ? html` checked` : ''}> Marcar todos</label>
      <p class="cm-discreto" id="cm-lote-n" aria-live="polite">${textoLote(n)}</p>
    </div>
    <div class="cm-lote-aplicar">
      ${selecao({ id: 'cm-lote-acao', rotulo: 'O que fazer com os marcados', opcoes: ACOES_LOTE, vazio: 'Escolha' })}
      <button type="button" class="btn btn-fantasma" id="cm-lote-ok"${s.gerando ? html` disabled` : ''}${s.gerando === 'lote' ? html` aria-busy="true"` : ''}>Aplicar aos marcados</button>
    </div>
    <p class="campo-dica">O cadastro em lote usa os % padrão dos Parâmetros. Dados da PJ e acordo mínimo se completam depois, em Cadastro.</p>
  </div>`;
}

// Marcar não redesenha a tela: só o contador e o "Marcar todos".
function marcarLote() {
  const caixas = $$('[data-lote]', s.el);
  s.lote = new Set(caixas.filter(c => c.checked).map(c => c.dataset.lote));
  pintar($('#cm-lote-n', s.el), textoLote(s.lote.size));
  const todos = $('#cm-lote-todos', s.el);
  if (todos) { todos.checked = s.lote.size === caixas.length; todos.indeterminate = s.lote.size > 0 && !todos.checked; }
}

async function aplicarLote() {
  const acao = $('#cm-lote-acao', s.el)?.value;
  const nomes = s.resultado.semCadastro.map(x => x.vendedor).filter(v => s.lote.has(v));
  if (!nomes.length) { s.ctx.toast('Marque pelo menos um vendedor.', { tom: 'erro' }); return; }
  if (!acao) { aplicarErros(s.el, { 'cm-lote-acao': 'Escolha o que fazer.' }); return; }
  const lista = nomes.length === 1 ? nomes[0] : `${nomes.length} vendedores`;
  const p = pctPadrao(acao, comissoes.parametros());
  const ok = await confirmar(acao === 'ignorar'
    ? { titulo: `${lista} não ${nomes.length === 1 ? 'comissiona' : 'comissionam'}?`, descricao: `${nomes.join(', ')}. As vendas com estes nomes deixam de aparecer como novas. Dá para desfazer em Parâmetros.`, confirmar: 'Não comissiona' }
    : { titulo: `Cadastrar ${lista} como ${ROTULO_REGIME[acao]}?`, descricao: `${nomes.join(', ')}. Com ${pctTxt(p.principal)} na venda principal e ${pctTxt(p.farelo)} no Farelo.${acao === 'PJ' ? ' Razão social, CNPJ e PIX ficam para completar em Cadastro antes do recibo e da ADP.' : ''}`, confirmar: 'Cadastrar' });
  if (!ok || !s) return;
  const meu = s;
  await ocupar('lote', async () => {
    let feitos = 0;
    const falhas = [];
    if (acao === 'ignorar') { await comissoes.ignorarNomes(nomes); feitos = nomes.length; }
    else {
      for (const nome of nomes) {
        const dados = novoDoQlik(nome, acao, comissoes.parametros());
        const erros = errosComissionado(dados, comissoes.cadastro());
        if (Object.keys(erros).length) { falhas.push(`${nome}: ${Object.values(erros)[0]}`); continue; }
        try { await comissoes.salvar(dados); feitos++; }
        catch (e) { falhas.push(`${nome}: ${detalhar(e).mensagem}`); }
      }
    }
    if (s !== meu) return;
    s.lote = new Set();
    await recalcular();
    const um = acao === 'ignorar' ? 'não comissiona' : `entrou na comissão como ${ROTULO_REGIME[acao]}`;
    const varios = acao === 'ignorar' ? 'não comissionam' : `entraram na comissão como ${ROTULO_REGIME[acao]}`;
    if (feitos) s.ctx.toast(feitos === 1 ? `1 vendedor ${um}.` : `${feitos} vendedores ${varios}.`, { tom: 'sucesso' });
    if (falhas.length) s.ctx.toast(`Não foi possível: ${falhas.join('. ')}`, { tom: 'erro', duracao: 8000 });
  });
}

export function ligar(el) {
  return [
    ao(el, 'click', '#cm-buscar', buscar),
    ao(el, 'click', '[data-ignorar]', (e, b) => ignorarNome(b.dataset.ignorar)),
    ao(el, 'click', '[data-completar]', (e, b) => editar(null, b.dataset.completar)),
    ao(el, 'click', '[data-reativar]', (e, b) => reativar(b.dataset.reativar)),
    ao(el, 'change', '[data-lote]', marcarLote),
    ao(el, 'change', '#cm-lote-todos', (e, t) => { $$('[data-lote]', el).forEach(c => { c.checked = t.checked; }); marcarLote(); }),
    ao(el, 'click', '#cm-lote-ok', () => s.resultado && aplicarLote()),
  ];
}
