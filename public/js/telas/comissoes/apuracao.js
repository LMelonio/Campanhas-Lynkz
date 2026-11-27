// Comissões → Apuração: vendas do mês no Qlik, cálculo de cada pessoa, "Novos no Qlik" (um a um ou em lote)
// e "Desativados com venda no Qlik" (reativar).
// Os documentos e o fechamento do mês ficam em documentos.js.
import { html, pintar, $, $$, ao } from '../../lib/dom.js';
import { dataBR, horaBR } from '../../lib/regras.js';
import { periodoApuracao } from '../../lib/comissoes.js';
import { REGIMES, ROTULO_REGIME, ehPJ, pctPadrao, errosComissionado, novoDoQlik, secundariosDaLinha } from '../../lib/comissoes.js';
import { comissoes } from '../../dados/comissoes.js';
import { detalhar } from '../../dados/erros.js';
import { icone } from '../../ui/icones.js';
import { carregando } from '../../ui/pecas.js';
import { confirmar } from '../../ui/avisos.js';
import { selecao, aplicarErros } from '../../ui/campos.js';
import { s, r$, pctTxt, pct1, mesMinusculo, quemFechou, redesenhar, recalcular, ocupar } from './comum.js';
import { documentosHtml, faixaFechar, antesDeFechar } from './documentos.js';
import { editar } from './cadastro.js';

export function desenhar() {
  const r = s.resultado;
  const p = periodoApuracao(s.mes, comissoes.parametros().dia_corte);
  const dm = d => dataBR(d).slice(0, 5);
  return html`
    ${s.erroQlik ? html`<div class="nota nota-alerta cm-erro-qlik" role="alert">${icone('alerta')}<span>${s.erroQlik}</span>
      <button type="button" class="btn btn-fantasma btn-pequeno" id="cm-tentar-qlik"${s.buscando ? html` disabled` : ''}>${icone('repetir')} Tentar de novo</button></div>` : ''}
    ${s.buscando && !r ? html`<section class="destaque cm-destaque cm-buscando" aria-busy="true">
        <p class="destaque-rotulo" role="status" aria-live="polite">Buscando as vendas de ${dm(p.inicio)} a ${dm(p.fim)} no Qlik…</p>
      </section>${carregando(2)}`
      : r ? resultadoHtml(r) : s.erroQlik ? '' : html`<p class="nota">${icone('info')}<span>As vendas do mês vêm do Qlik. Premiações e metas do Contrato ficam gravadas nas outras abas.</span></p>`}`;
}

// Abriu um mês aberto sem consulta (nem na memória, nem gravada): busca sozinho, uma vez por mês nesta sessão.
// Erro não tenta de novo sozinho: fica o "Tentar de novo".
const autoBuscado = new Set();
export function buscarSeFaltar() {
  if (!s || s.resultado || s.buscando || s.erroQlik || comissoes.fechado(s.mes) || autoBuscado.has(s.mes)) return;
  autoBuscado.add(s.mes);
  buscar();
}

function resultadoHtml(r) {
  const t = r.totais;
  const semCad = r.semCadastro.reduce((x, v) => x + v.total, 0);
  const f = r.fechado;
  const reaberto = !f && comissoes.fechamento(r.mes);
  const n = f ? 0 : antesDeFechar(r).filter(i => !i.ok).length;
  const clt = r.linhas.filter(l => !ehPJ(l));
  const pj = r.linhas.filter(ehPJ);
  // Ordem: o total (fixo no topo no celular), o que está pendente, as pessoas e, no fim, documentos e "Fechar mês".
  return html`
    ${f ? html`<p class="nota cm-fechado">${icone('cadeado')}<span>Mês fechado em ${quemFechou(f)}. Os valores abaixo são a cópia do histórico: não mudam com o Qlik nem com o cadastro.</span></p>` : ''}
    ${reaberto ? html`<p class="nota nota-alerta">${icone('alerta')}<span>Mês reaberto em ${dataBR(reaberto.reaberto_em)}: ${reaberto.motivo_reabertura}. Feche de novo depois de corrigir.</span></p>` : ''}
    ${reaberto && comissoes.usaCadastroDaCopia(r.mes) ? html`<p class="nota" id="cm-nota-copia">${icone('info')}<span>Calculado com o cadastro de quando o mês foi fechado. Mudanças feitas depois no Cadastro não entram aqui.</span></p>` : ''}
    <section class="destaque cm-destaque" aria-labelledby="cm-total-t">
      <p class="destaque-rotulo" id="cm-total-t">${f ? 'Pago' : 'A pagar'} em ${mesMinusculo(r.mes)}</p>
      <p class="cm-total num-display">${r$(t.geral.valor_pagar)}</p>
      <p class="cm-pendencias${n ? ' cm-pendencias-falta' : ''}">${f ? 'Mês fechado' : n ? `${n} ${n === 1 ? 'pendência' : 'pendências'}` : 'Nada pendente'}</p>
      <p class="destaque-sub" id="cm-consultado">${f ? `Consulta ao Qlik de ${dataBR(r.consulta.consultado_em)} às ${horaBR(r.consulta.consultado_em)}, gravada no fechamento.` : `Consulta ao Qlik de ${dataBR(r.consulta.consultado_em)} às ${horaBR(r.consulta.consultado_em)}. Premiações, ajustes e metas vêm do que está gravado.`}</p>
    </section>
    <dl class="numeros numeros-3 cm-numeros">
      <div class="numero"><dt>CLT (folha)</dt><dd class="num-display">${r$(t.clt.valor_pagar)}</dd></div>
      <div class="numero"><dt>PJ (ADP com NF)</dt><dd class="num-display">${r$(t.pj.valor_pagar)}</dd></div>
      <div class="numero${r.semCadastro.length ? ' cm-numero-alerta' : ''}"><dt>Novos no Qlik</dt><dd class="num-display">${r$(semCad)}</dd></div>
    </dl>

    ${r.semCadastro.length ? novosHtml(r) : ''}
    ${desativadosHtml(r)}

    ${tabela('Vendedores CLT', clt, false, t.clt.valor_pagar, colunasFornecedor(r.linhas))}
    ${tabela('Representantes PJ', pj, true, t.pj.valor_pagar, colunasFornecedor(r.linhas))}
    ${f ? documentosHtml(r) : faixaFechar(r)}
    ${naoComissionamHtml(r)}`;
}

const alertasHtml = l => (l.alertas.length ? html`<small class="cm-alerta-linha">${icone('alerta')}<span>${l.alertas.map(a => a.texto).join(' ')}</span></small>` : '');

function contratoHtml(c) {
  if (!c || c.motivo === 'Sem meta cadastrada') return html`<span class="cm-sub">Sem meta</span>`;
  const conta = `Faturamento ${pct1(c.pct_faturamento)}, positivação ${c.positivados} de ${c.meta_positivacao}${c.informado ? ' (informado)' : ''}`;
  return c.atingiu
    ? html`${r$(c.valor)}<small class="cm-sub">${conta}: ${pctTxt(c.pct_premio)}</small>`
    : html`<span class="cm-sub cm-nao">Não atingiu</span><small class="cm-sub">${conta}</small>`;
}

// Até 600 px a tabela dá lugar a um cartão por pessoa (o CSS mostra um ou outro):
// nome, regime e "A pagar" à vista; "Ver conta" abre as linhas; alertas sempre visíveis.
// Colunas de venda além da principal: um secundário por coluna (só os que tiveram venda no mês) e "Outros".
// As mesmas colunas nas duas tabelas (CLT e PJ), na ordem das regras.
function colunasFornecedor(linhas) {
  const sec = new Map();
  for (const l of linhas) for (const x of secundariosDaLinha(l)) if (x.venda && !sec.has(x.codigo)) sec.set(x.codigo, x.nome);
  return { secundarios: [...sec].map(([codigo, nome]) => ({ codigo, nome })), outros: linhas.some(l => l.venda_outros) };
}
const vendaSec = (l, codigo) => secundariosDaLinha(l).find(x => x.codigo === codigo)?.venda || 0;

function tabela(titulo, ls, pj, total, cols) {
  if (!ls.length) return '';
  const id = pj ? 'cm-t-pj' : 'cm-t-clt';
  return html`<section aria-labelledby="${id}">
    <h2 class="secao-titulo cm-grupo" id="${id}"><span>${titulo} <span class="contador-texto">${ls.length}</span></span><span class="cm-grupo-total tabular">${r$(total)}</span></h2>
    <div class="tabela-caixa cm-caixa-pessoas"><table class="tabela cm-tabela">
      <thead><tr><th scope="col">${pj ? 'Representante' : 'Vendedor'}</th><th scope="col" class="num">Venda principal</th>
        ${cols.secundarios.map(x => html`<th scope="col" class="num">${x.nome}</th>`)}${cols.outros ? html`<th scope="col" class="num">Outros</th>` : ''}
        <th scope="col" class="num">Comissão</th><th scope="col" class="num">Prêmios</th><th scope="col" class="num">${pj ? 'Contrato de Resultado' : 'Acordo mínimo'}</th><th scope="col" class="num">A pagar</th></tr></thead>
      <tbody>${ls.map(l => html`<tr>
        <td data-rotulo="${pj ? 'Representante' : 'Vendedor'}" class="principal"><strong>${l.nome} <span class="cm-pagar-nome tabular" aria-hidden="true">${r$(l.valor_pagar)}</span></strong>
          <small class="cm-sub">${regimeTxt(l)}</small>${alertasHtml(l)}
          ${botaoRecibo(l, pj)}</td>
        <td data-rotulo="Venda principal" class="num tabular">${r$(l.venda_principal)}</td>
        ${cols.secundarios.map(x => html`<td data-rotulo="${x.nome}" class="num tabular">${r$(vendaSec(l, x.codigo))}</td>`)}
        ${cols.outros ? html`<td data-rotulo="Outros" class="num tabular">${r$(l.venda_outros || 0)}</td>` : ''}
        <td data-rotulo="Comissão" class="num tabular">${r$(l.comissao_total)}</td>
        <td data-rotulo="Prêmios" class="num tabular">${l.premiacoes ? r$(l.premiacoes) : '—'}${l.ajustes ? html`<small class="cm-sub">Ajustes ${sinal(l.ajustes)}</small>` : ''}</td>
        <td data-rotulo="${pj ? 'Contrato de Resultado' : 'Acordo mínimo'}" class="num tabular">${pj ? contratoHtml(l.contrato)
          : l.acordo ? html`${r$(l.acordo.valor)}${l.piso_aplicado ? html`<small class="cm-sub">Paga o acordo</small>` : ''}` : '—'}</td>
        <td data-rotulo="A pagar" class="num tabular cm-pagar">${r$(l.valor_pagar)}</td>
      </tr>`)}</tbody>
    </table></div>
    <ul class="cm-cartoes">${ls.map(l => cartao(l, pj))}</ul></section>`;
}

const sinal = v => `${v > 0 ? '+' : '−'}${r$(Math.abs(v))}`;
// "2,5% no principal e 1% no Farelo": só os secundários com venda no mês (e Outros, se houver).
function regimeTxt(l) {
  const pcts = [`${pctTxt(l.pct_principal)} no principal`,
    ...secundariosDaLinha(l).filter(x => x.venda).map(x => (x.pct == null ? `${x.nome} sem %` : `${pctTxt(x.pct)} no ${x.nome}`)),
    ...(l.venda_outros ? [l.pct_outros == null ? 'Outros sem %' : `${pctTxt(l.pct_outros)} em Outros`] : [])];
  const lista = pcts.length > 1 ? `${pcts.slice(0, -1).join(', ')} e ${pcts.at(-1)}` : pcts[0];
  return `${l.regime === 'TELEVENDAS' ? 'Televendas, ' : ''}${lista}${l.equipe ? `, ${l.equipe}` : ''}`;
}
const botaoRecibo = (l, pj) => (pj && l.valor_pagar > 0
  ? html`<button type="button" class="btn btn-texto btn-pequeno cm-recibo" data-recibo="${l.id}" aria-label="Baixar recibo de ${l.nome}">${icone('baixar')} Recibo</button>` : '');

function cartao(l, pj) {
  // O grupo (CLT ou PJ) já diz o regime; no cartão só aparece Televendas.
  const partes = [
    l.comissao_total ? `Comissão ${r$(l.comissao_total)}` : '',
    l.premiacoes ? `Prêmios ${r$(l.premiacoes)}` : '',
    pj && l.contrato_valor ? `Contrato ${r$(l.contrato_valor)}` : '',
    l.piso_aplicado ? `Acordo ${r$(l.acordo.valor)}` : '',
    l.ajustes ? `Ajustes ${sinal(l.ajustes)}` : '',
  ].filter(Boolean);
  const linha = (rotulo, valor) => html`<div><dt>${rotulo}</dt><dd class="tabular">${valor}</dd></div>`;
  return html`<li class="cm-cartao">
    <details>
      <summary>
        <span class="cm-cartao-topo"><strong>${l.nome}</strong><span class="cm-cartao-pagar tabular">${r$(l.valor_pagar)}</span></span>
        <span class="cm-cartao-linha"><span class="cm-ver-conta">Ver conta</span>${[l.regime === 'TELEVENDAS' ? 'Televendas' : '', ...partes].filter(Boolean).join(' · ') || 'Sem comissão no mês'}</span>
      </summary>
      <dl class="cm-conta">
        ${linha('Regime', regimeTxt(l))}
        ${linha('Venda principal', r$(l.venda_principal))}
        ${secundariosDaLinha(l).filter(x => x.venda).map(x => linha(x.nome, r$(x.venda)))}
        ${l.venda_outros ? linha('Outros', r$(l.venda_outros)) : ''}
        ${linha('Comissão', r$(l.comissao_total))}
        ${linha('Prêmios', l.premiacoes ? r$(l.premiacoes) : '—')}
        ${l.ajustes ? linha('Ajustes', sinal(l.ajustes)) : ''}
        ${pj ? linha('Contrato de Resultado', contratoHtml(l.contrato)) : linha('Acordo mínimo', l.acordo ? `${r$(l.acordo.valor)}${l.piso_aplicado ? ' (paga o acordo)' : ''}` : '—')}
        ${linha('A pagar', r$(l.valor_pagar))}
      </dl>
      ${botaoRecibo(l, pj)}
    </details>
    ${alertasHtml(l)}
  </li>`;
}

async function buscar() {
  if (s.buscando) return;
  const meu = s, mes = s.mes;
  s.buscando = true; s.erroQlik = null;
  redesenhar();
  let r = null, erro = null;
  try { r = await comissoes.apurar(mes); }
  catch (e) { erro = detalhar(e).mensagem; }
  if (s !== meu) return;
  s.buscando = false;
  // Trocou de mês no meio da busca: o resultado é de outro mês (fica na memória para quando voltar).
  if (s.mes === mes) { if (erro) s.erroQlik = erro; else s.resultado = r; }
  redesenhar();
}

// ---------- Não comissionam (último bloco) ----------
// Nomes que não comissionam e vendas sem vendedor: fora da comissão, mostrados de forma discreta.
function naoComissionamHtml(r) {
  const semVendedor = Number(r.consulta?.sem_vendedor) || 0;
  if (!r.ignorados.length && !semVendedor) return '';
  const total = r.ignorados.reduce((t, x) => t + Math.round(x.total * 100), 0) / 100 + semVendedor;
  // No celular começa fechado (só o título e o total); no computador, aberto.
  const aberto = !window.matchMedia('(max-width: 600px)').matches;
  return html`<section class="painel cm-nao-comissionam" aria-labelledby="cm-t-nao"><details${aberto ? html` open` : ''}>
    <summary><h2 class="painel-titulo" id="cm-t-nao"><span>Não comissionam</span><span class="tabular">${r$(total)}</span></h2></summary>
    <ul class="cm-nao-lista">
      ${r.ignorados.map(x => html`<li><span>${x.vendedor} · <span class="tabular">${r$(x.total)}</span></span>
        ${r.fechado ? '' : html`<button type="button" class="btn btn-texto btn-pequeno" data-voltar-comissionar="${x.vendedor}" aria-label="Voltar a comissionar ${x.vendedor}">Voltar a comissionar</button>`}</li>`)}
      ${semVendedor ? html`<li><span>Vendas sem vendedor no Qlik · <span class="tabular">${r$(semVendedor)}</span></span></li>` : ''}
    </ul>
  </details></section>`;
}

export async function voltarAComissionar(nome) {
  const ok = await confirmar({
    titulo: `Voltar a comissionar ${nome}?`,
    descricao: 'O nome sai da lista dos que não comissionam e aparece em "Novos no Qlik" para completar o cadastro.',
    confirmar: 'Voltar a comissionar',
  });
  if (!ok || !s) return false;
  try {
    await comissoes.voltarAComissionar(nome);
    await recalcular();
    s.ctx.toast(`${nome} volta a comissionar.`, { tom: 'sucesso' });
    redesenhar();
    return true;
  } catch (e) { s.ctx.toast(detalhar(e).mensagem, { tom: 'erro' }); return false; }
}

// ---------- Novos no Qlik ----------
function novosHtml(r) {
  const f = r.fechado;
  const lote = !f && r.semCadastro.length >= 2;
  const valores = x => html`<strong>${x.vendedor}</strong><small class="tabular">${r$(x.total)}${x.farelo ? `, Farelo ${r$(x.farelo)}` : ''}</small>`;
  return html`<section class="painel cm-sem" aria-labelledby="cm-t-sem">
      <h2 class="painel-titulo" id="cm-t-sem">Novos no Qlik</h2>
      <p class="painel-corpo campo-dica">${f ? 'Vendedores sem cadastro quando o mês foi fechado: as vendas deles ficaram fora da comissão.' : 'Ainda sem regime nem percentual: as vendas ficam fora da comissão até completar o cadastro.'}</p>
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

export async function ignorarNome(nome) {
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
  // PJ precisa de razão social, documento, PIX e banco: não dá em lote. Abre o cadastro do primeiro marcado.
  if (acao === 'PJ') {
    const ok = await confirmar({
      titulo: 'PJ precisa dos dados de pagamento',
      descricao: `Complete um por vez: razão social, CNPJ ou CPF, chave PIX e banco. Começando por ${nomes[0]}.`,
      confirmar: 'Completar cadastro',
    });
    if (ok && s) await editar(null, nomes[0], { regime: 'PJ' });
    return;
  }
  const p = pctPadrao(acao, comissoes.parametros());
  const ok = await confirmar(acao === 'ignorar'
    ? { titulo: `${lista} não ${nomes.length === 1 ? 'comissiona' : 'comissionam'}?`, descricao: `${nomes.join(', ')}. As vendas com estes nomes deixam de aparecer como novas. Dá para desfazer em Parâmetros.`, confirmar: 'Não comissiona' }
    : { titulo: `Cadastrar ${lista} como ${ROTULO_REGIME[acao]}?`, descricao: `${nomes.join(', ')}. Com ${pctTxt(p.principal)} na venda principal${comissoes.temFornecedores() ? ' e o % de cada secundário pelo regime' : ` e ${pctTxt(p.farelo)} no Farelo`}.${acao === 'PJ' ? ' Razão social, CNPJ e PIX ficam para completar em Cadastro antes do recibo e da ADP.' : ''}`, confirmar: 'Cadastrar' });
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
    ao(el, 'click', '#cm-tentar-qlik', buscar),
    ao(el, 'click', '[data-voltar-comissionar]', (e, b) => voltarAComissionar(b.dataset.voltarComissionar)),
    ao(el, 'click', '[data-ignorar]', (e, b) => ignorarNome(b.dataset.ignorar)),
    ao(el, 'click', '[data-completar]', (e, b) => editar(null, b.dataset.completar)),
    ao(el, 'click', '[data-reativar]', (e, b) => reativar(b.dataset.reativar)),
    ao(el, 'change', '[data-lote]', marcarLote),
    ao(el, 'change', '#cm-lote-todos', (e, t) => { $$('[data-lote]', el).forEach(c => { c.checked = t.checked; }); marcarLote(); }),
    ao(el, 'click', '#cm-lote-ok', () => s.resultado && aplicarLote()),
  ];
}
