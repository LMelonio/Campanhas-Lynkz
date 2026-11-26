// Comissões (#/comissoes, só administrador).
//   ?aba=previa       Apuração: vendas do mês no Qlik, cálculo de cada pessoa, Excel, recibos e ADP dos PJ
//   ?aba=premiacoes   premiações de campanha e ajustes (com motivo) do mês, CLT e PJ
//   ?aba=contrato     Contrato de Resultado dos PJ: metas do mês anterior e realizado
//   ?aba=cadastro     comissionados: as pessoas vêm do Qlik; aqui só se completa regime, %, acordo e dados da PJ
//   ?aba=parametros   código do Farelo, dia de corte, % padrão, Contrato de Resultado, nomes que não comissionam
//   ?aba=historico    meses fechados (cópia do que foi pago); abrir um mês mostra a cópia e gera os documentos dela
// A tela só organiza: banco, Qlik e cálculo ficam em dados/comissoes.js e lib/comissoes.js;
// o que vai no recibo, na ADP e no Excel, em lib/comissoes-documentos.js.
import { html, pintar, $, $$, ao } from '../lib/dom.js';
import { brl, dataBR, horaBR, lerValor, valorCampo, contem, hojeCivil } from '../lib/regras.js';
import {
  REGIMES, ROTULO_REGIME, ehPJ, pctPadrao, periodoApuracao, mesAnteriorFechado,
  somaMes, rotuloMesComissao, errosComissionado, nomeQlik, entradaContrato, avaliarContrato, novoDoQlik,
} from '../lib/comissoes.js';
import { recibosDoMes, linhasAdpPj, totalLinhas, pendenciasPj, NF_RE } from '../lib/comissoes-documentos.js';
import { comissoes } from '../dados/comissoes.js';
import { detalhar } from '../dados/erros.js';
import { vencimentoPadrao, DIAS_UTEIS_VENCIMENTO } from '../adp.js';
import { icone } from '../ui/icones.js';
import { vazio, carregando, seloNeutro } from '../ui/pecas.js';
import { abrirDialogo, erroNoDialogo, confirmar } from '../ui/avisos.js';
import { campo, selecao, areaTexto, interruptor, aplicarErros, ligarMascaras, campoBusca, ligarBusca } from '../ui/campos.js';

const ABAS = [
  { valor: 'previa', rotulo: 'Apuração' },
  { valor: 'premiacoes', rotulo: 'Premiações' },
  { valor: 'contrato', rotulo: 'Contrato PJ' },
  { valor: 'cadastro', rotulo: 'Cadastro' },
  { valor: 'parametros', rotulo: 'Parâmetros' },
  { valor: 'historico', rotulo: 'Histórico' },
];
const ABAS_DO_MES = ['previa', 'premiacoes', 'contrato'];

let s = null;   // { el, ctx, aba, pronto, erro, mes, resultado, buscando, erroQlik, busca, inativos, gerando, historico, desligar[] }
// O mês vai no endereço (#/comissoes?aba=previa&mes=2026-10) e fica lembrado aqui:
// quem sai pelo menu e volta continua no mesmo mês, com a consulta ao Qlik que está na memória.
let mesLembrado = null;
const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const r$ = n => `R$ ${brl(n)}`;
const pctTxt = n => `${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const pct1 = n => (n == null ? '—' : `${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const valorPct = n => (n == null || n === '' ? '' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
const mesMinusculo = mes => rotuloMesComissao(mes).replace(/^\S+/, m => m.toLowerCase());
const ativos = () => comissoes.cadastro().filter(c => c.ativo !== false);
const fechado = () => comissoes.fechado(s.mes);
const quemFechou = f => `${dataBR(f.fechado_em)} às ${horaBR(f.fechado_em)}`;
const avisoFechado = () => html`<p class="nota cm-fechado">${icone('cadeado')}<span>${mesMinusculo(s.mes).replace(/^./, c => c.toUpperCase())} está fechado e no histórico
  (fechado em ${quemFechou(comissoes.fechamento(s.mes))}). Para mudar, reabra o mês na Apuração.</span></p>`;

// Mês sugerido: o da apuração que fecha hoje ou já fechou.
function mesPadrao() {
  const hoje = hojeCivil();
  const mes = hoje.slice(0, 7);
  return Number(hoje.slice(8, 10)) >= comissoes.parametros().dia_corte ? mes : somaMes(mes, -1);
}

// ---------- casca ----------
function desenhar() {
  const { el, ctx } = s;
  if (!ctx.ehAprovador) {
    pintar(el, vazio({ icone: 'cadeado', titulo: 'Só administradores', texto: 'Comissões são dados de remuneração e ficam só com a gerência.', acao: { href: '#/inicio', rotulo: 'Voltar ao início' } }));
    return;
  }
  if (s.erro) {
    pintar(el, html`<div class="estado-erro" role="alert">${icone('alerta')}
      <div class="estado-erro-texto"><p class="estado-titulo">Não foi possível carregar as comissões</p><p class="estado-texto">${s.erro}</p></div>
      <button type="button" class="btn btn-fantasma" id="cm-tentar">${icone('repetir')} Tentar de novo</button></div>`);
    return;
  }
  if (!s.pronto) { pintar(el, carregando(3)); return; }
  const conteudo = { premiacoes: telaPremiacoes, contrato: telaContrato, cadastro: telaCadastro, parametros: telaParametros, historico: telaHistorico }[s.aba] || telaPrevia;
  pintar(el, html`<div class="comissoes">
    <div class="filtros cm-abas" role="group" aria-label="Seções das comissões">
      ${ABAS.map(a => html`<button type="button" class="filtro" data-aba="${a.valor}" aria-pressed="${s.aba === a.valor}">${a.rotulo}</button>`)}
    </div>
    <div id="cm-conteudo">${ABAS_DO_MES.includes(s.aba) ? seletorMes() : ''}${conteudo()}</div>
  </div>`);
}

function seletorMes() {
  const p = comissoes.parametros();
  const ap = periodoApuracao(s.mes, p.dia_corte);
  const ct = mesAnteriorFechado(s.mes);
  const meses = [0, -1, -2, -3, -4, -5].map(n => somaMes(mesPadrao(), n));
  if (!meses.includes(s.mes)) meses.unshift(s.mes);
  const r = s.resultado;
  return html`<div class="cm-cabeca"><div class="cm-consulta">
      ${selecao({ id: 'cm-mes', rotulo: 'Mês da apuração', opcoes: meses.map(m => ({ valor: m, rotulo: rotuloMesComissao(m) })), valor: s.mes, vazio: 'Escolha o mês' })}
      ${fechado() ? '' : html`<button type="button" class="btn ${r ? 'btn-fantasma' : 'btn-primario'}" id="cm-buscar"${s.buscando ? html` aria-busy="true" disabled` : ''}>${icone('repetir')} ${s.buscando ? 'Buscando no Qlik…' : r ? 'Buscar de novo' : 'Buscar vendas no Qlik'}</button>`}
    </div>
    <p class="secao-nota cm-periodo">Vendas de ${dataBR(ap.inicio)} a ${dataBR(ap.fim)}, receita menos devolução, atacado regular. Farelo é o fornecedor ${p.cod_farelo}.
      O Contrato de Resultado olha ${mesMinusculo(ct.mes)} inteiro.</p></div>`;
}

// ---------- apuração ----------
function telaPrevia() {
  const r = s.resultado;
  return html`
    ${s.erroQlik ? html`<p class="nota nota-alerta" role="alert">${icone('alerta')}<span>${s.erroQlik}</span></p>` : ''}
    ${s.buscando && !r ? carregando(2) : r ? resultadoHtml(r) : html`<p class="nota">${icone('info')}<span>Escolha o mês e busque as vendas. As pessoas vêm do Qlik; premiações e metas do Contrato ficam gravadas nas outras abas.</span></p>`}`;
}

function resultadoHtml(r) {
  const t = r.totais;
  const semCad = r.semCadastro.reduce((x, v) => x + v.total, 0);
  const g = s.gerando;
  const botao = (id, ic, rotulo, ocupado, tipo = 'btn-fantasma') => html`<button type="button" class="btn ${tipo}" id="${id}"${g ? html` disabled` : ''}${ocupado ? html` aria-busy="true"` : ''}>${icone(ic)} ${ocupado ? `${rotulo}…` : rotulo}</button>`;
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
    <div class="acoes cm-documentos" role="group" aria-label="Documentos do mês">
      ${botao('cm-excel', 'baixar', 'Baixar Excel', g === 'excel')}
      ${botao('cm-recibos', 'baixar', 'Recibos dos PJ', g === 'recibos')}
      ${botao('cm-adp', 'moeda', 'Gerar ADP dos PJ', g === 'adp')}
      ${f ? botao('cm-reabrir', 'cadeado', 'Reabrir mês', g === 'reabrir') : ''}
    </div>

    ${r.semCadastro.length ? html`<section class="painel cm-sem" aria-labelledby="cm-t-sem">
      <h2 class="painel-titulo" id="cm-t-sem">Novos no Qlik</h2>
      <p class="painel-corpo campo-dica">${f ? 'Vendedores sem cadastro quando o mês foi fechado: as vendas deles ficaram fora da comissão.' : 'Vendedores que apareceram no Qlik e ainda não têm regime nem percentual. Até completar o cadastro, as vendas deles não entram em nenhuma comissão.'}</p>
      ${f || r.semCadastro.length < 2 ? '' : loteHtml(r.semCadastro)}
      <ul class="cm-sem-lista">${r.semCadastro.map(x => html`<li>
        ${f || r.semCadastro.length < 2
          ? html`<div><strong>${x.vendedor}</strong><small class="tabular">${r$(x.total)}${x.farelo ? `, Farelo ${r$(x.farelo)}` : ''}</small></div>`
          : html`<label class="cm-sem-marca"><input type="checkbox" data-lote="${x.vendedor}"${s.lote.has(x.vendedor) ? html` checked` : ''}>
            <span><strong>${x.vendedor}</strong><small class="tabular">${r$(x.total)}${x.farelo ? `, Farelo ${r$(x.farelo)}` : ''}</small></span></label>`}
        ${f ? '' : html`<div class="acoes">
          <button type="button" class="btn btn-fantasma btn-pequeno" data-completar="${x.vendedor}" aria-label="Completar cadastro: ${x.vendedor}">${icone('pessoa')} Completar cadastro</button>
          <button type="button" class="btn btn-texto btn-pequeno" data-ignorar="${x.vendedor}" aria-label="Não comissiona: ${x.vendedor}">Não comissiona</button>
        </div>`}</li>`)}</ul>
    </section>` : ''}
    ${r.consulta.sem_vendedor ? html`<p class="nota">${icone('info')}<span>${r$(r.consulta.sem_vendedor)} em vendas sem vendedor no Qlik ficaram de fora.</span></p>` : ''}

    ${tabela('Vendedores CLT', r.linhas.filter(l => !ehPJ(l)), false)}
    ${tabela('Representantes PJ', r.linhas.filter(ehPJ), true)}
    ${r.ignorados.length ? html`<p class="secao-nota">Não comissionam: ${r.ignorados.map(x => `${x.vendedor} (${r$(x.total)})`).join(', ')}. Para mudar, vá em Parâmetros.</p>` : ''}
    ${f ? '' : faixaFechar(r, botao)}`;
}

// O que conferir antes de fechar o mês. Cada item: { ok, texto } (o texto já diz o que falta).
function antesDeFechar(r) {
  const pjs = linhasAdpPj(r, comissoes.contextoDocumentos(r.mes).cadastro);
  const semNf = pjs.filter(l => !l.nf || l.nf_valor == null).map(l => l.nome);
  const semCadastro = pjs.filter(l => l.falta.some(x => x !== 'número da NF' && x !== 'valor da NF')).map(l => l.nome);
  const n = r.semCadastro.length;
  return [
    { ok: !n, texto: n ? `${n} ${n === 1 ? 'vendedor' : 'vendedores'} em Novos no Qlik, fora da comissão` : 'Ninguém em Novos no Qlik' },
    { ok: !semCadastro.length, texto: semCadastro.length ? `Cadastro do PJ incompleto: ${semCadastro.join(', ')}` : 'Cadastro dos PJ completo para o recibo e a ADP' },
    { ok: !semNf.length, texto: !pjs.length ? 'Nenhum PJ a pagar neste mês' : semNf.length ? `ADP dos PJ sem a NF de ${semNf.join(', ')}` : 'ADP dos PJ gerada, com a NF de todos' },
  ];
}

// "Fechar mês" fica sozinho no fim da apuração, longe dos documentos, e só chama atenção quando nada falta.
function faixaFechar(r, botao) {
  const itens = antesDeFechar(r);
  const pronto = itens.every(i => i.ok);
  return html`<section class="painel cm-fechar${pronto ? ' cm-fechar-pronto' : ''}" aria-labelledby="cm-t-fechar">
    <h2 class="painel-titulo" id="cm-t-fechar">Fechar ${mesMinusculo(r.mes)}</h2>
    <div class="painel-corpo">
      <p class="campo-dica">Grava a cópia do que foi pago no histórico e trava premiações, ajustes, contrato e NF. Dá para reabrir, com motivo.</p>
      <ul class="cm-conferir">${itens.map(i => html`<li class="${i.ok ? 'ok' : 'falta'}">${icone(i.ok ? 'check' : 'alerta')}<span>${i.texto}<span class="so-leitor">${i.ok ? ' (pronto)' : ' (falta)'}</span></span></li>`)}</ul>
      <div class="acoes acoes-fim">${botao('cm-fechar', 'cadeado', pronto ? 'Fechar mês' : 'Fechar mês assim mesmo', s.gerando === 'fechar', pronto ? 'btn-primario' : 'btn-fantasma')}</div>
    </div>
  </section>`;
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
  desenhar();
  try {
    const r = await comissoes.apurar(s.mes);
    if (s === meu) s.resultado = r;
  } catch (e) {
    if (s === meu) s.erroQlik = detalhar(e).mensagem;
  }
  if (s !== meu) return;
  s.buscando = false;
  desenhar();
}

// Recalcula com a consulta já feita (depois de mexer no cadastro, nas premiações ou no contrato).
async function recalcular() {
  if (!s.resultado) return;
  s.resultado = await comissoes.apurar(s.mes, { buscar: false });
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
    desenhar();
  } catch (e) { s.ctx.toast(detalhar(e).mensagem, { tom: 'erro' }); }
}


// ---------- "Novos no Qlik" em lote: marcar vários e cadastrar com os % padrão, ou "não comissiona" ----------
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

// ---------- documentos do mês: Excel, recibos e ADP ----------
async function ocupar(tipo, fn) {
  if (s.gerando) return;
  const meu = s;
  s.gerando = tipo; desenhar();
  try { await fn(); }
  catch (e) { if (e?.name !== 'AbortError') meu.ctx.toast(detalhar(e).mensagem, { tom: 'erro', duracao: 7000 }); }
  finally { if (s === meu) { s.gerando = null; desenhar(); } }
}

function baixarExcel() {
  return ocupar('excel', async () => {
    const r = s.resultado;
    let base = null, aviso = '';
    if (!comissoes.fechado(r.mes)) {
      try { base = (await comissoes.buscarBase(r.mes)).linhas; }
      catch (e) { aviso = `A aba da base do Qlik ficou de fora (${detalhar(e).mensagem}). As vendas foram como valor.`; }
    }
    const { baixarExcelComissoes } = await import('../comissoes-excel.js');
    const ctxDoc = comissoes.contextoDocumentos(r.mes);
    if (ctxDoc.fechado) { base = null; aviso = ''; }   // mês fechado: a base de hoje no Qlik pode não bater com a cópia
    const x = await baixarExcelComissoes(r, { ...ctxDoc, base });
    s.ctx.toast(aviso || `${x.arquivo} baixado.`, { tom: aviso ? 'erro' : 'sucesso', duracao: aviso ? 8000 : 4000 });
  });
}

async function baixarRecibos(id = null) {
  const r = s.resultado;
  const todos = recibosDoMes(r, comissoes.contextoDocumentos(r.mes).cadastro);
  const lista = id == null ? todos : todos.filter(x => String(x.linha.id) === String(id));
  if (!lista.length) { s.ctx.toast('Nenhum representante PJ com valor a pagar neste mês.', { tom: 'erro' }); return; }
  const faltando = lista.filter(x => x.falta.length);
  if (faltando.length) {
    const ok = await confirmar({
      titulo: 'Há dados faltando no cadastro',
      descricao: `${faltando.map(x => `${x.linha.nome}: ${x.falta.join(', ')}`).join('. ')}. O recibo sai com um traço no lugar. Complete em Comissionados ou gere assim mesmo.`,
      confirmar: 'Gerar assim mesmo',
    });
    if (!ok) return;
  }
  await ocupar('recibos', async () => {
    const { gerarRecibos } = await import('../comissoes-pdf.js');
    const x = await gerarRecibos(lista, { mes: r.mes, periodo: r.periodo });
    s.ctx.toast(x.quantidade === 1 ? `${x.arquivo} baixado.` : `${x.quantidade} recibos baixados em um PDF.`, { tom: 'sucesso' });
  });
}

// Diálogo da ADP dos PJ: quem entra, número e valor da NF (gravados no mês) e vencimento.
// Mês fechado: as NF são as da cópia (não se editam; para mudar, reabra o mês).
async function dialogoAdp() {
  const r = s.resultado;
  const travado = !!r.fechado;
  const linhas = linhasAdpPj(r, comissoes.contextoDocumentos(r.mes).cadastro);
  if (!linhas.length) { s.ctx.toast('Nenhum representante PJ com valor a pagar neste mês.', { tom: 'erro' }); return; }
  const doCadastro = l => l.falta.filter(f => f !== 'número da NF' && f !== 'valor da NF');
  let dlg = null;
  const marcada = i => !!$(`#ap-m-${i}`, dlg)?.checked;
  const corpo = html`
    ${campo({ id: 'ap-venc', rotulo: 'Vencimento', tipo: 'date', valor: vencimentoPadrao(), obrigatorio: true, dica: `Padrão: ${DIAS_UTEIS_VENCIMENTO} dias úteis depois de hoje.` })}
    <p class="adp-resumo" id="ap-resumo"></p>
    <ul class="adp-lista">${linhas.map((l, i) => {
      const bloqueio = doCadastro(l);
      const semNf = travado && (!l.nf || l.nf_valor == null);
      const motivo = bloqueio.length ? `Falta no cadastro: ${bloqueio.join(', ')}.` : semNf ? 'Mês fechado sem a NF: reabra o mês para informar.' : '';
      return html`<li class="adp-item cm-adp-item${motivo ? ' adp-bloqueado' : ''}">
        <label class="adp-marca"><input type="checkbox" id="ap-m-${i}" data-ap-marca="${i}"${motivo ? html` disabled` : html` checked`} aria-describedby="ap-d-${i}">
          <span class="adp-cliente">${l.nome}</span></label>
        <p class="adp-info" id="ap-d-${i}"><span>${l.fornecedor}${l.cnpj ? `, CNPJ ${l.cnpj}` : ''}</span><span class="tabular">A pagar: ${r$(l.valor)}</span>
          ${motivo ? html`<span class="adp-motivo">${icone('cadeado')}${motivo}</span>` : ''}
          <span class="adp-motivo" data-ap-dif="${i}"${l.diferenca ? '' : html` hidden`}>${icone('alerta')}Valor da NF diferente do valor a pagar.</span></p>
        ${motivo ? '' : html`<div class="cm-duas cm-nf">
          ${campo({ id: `ap-nf-${i}`, rotulo: 'Número da NF', valor: l.nf, obrigatorio: true, atributos: { maxlength: 20, autocomplete: 'off', inputmode: 'numeric', ...(travado ? { readonly: true } : {}) } })}
          ${campo({ id: `ap-nv-${i}`, rotulo: 'Valor da NF', valor: valorCampo(l.nf_valor), obrigatorio: true, mascara: 'valor', atributos: travado ? { readonly: true } : {} })}
        </div>`}
      </li>`;
    })}</ul>
    <p class="campo-dica adp-nota">${travado ? 'Mês fechado: as notas são as gravadas no fechamento.' : 'Número e valor da nota ficam gravados no mês. Representante com dado faltando no cadastro não entra: complete em Comissionados.'}</p>`;
  const resumo = () => {
    const sel = linhas.filter((l, i) => marcada(i));
    pintar($('#ap-resumo', dlg), `${sel.length} de ${linhas.length} representantes, ${r$(totalLinhas(sel))}`);
  };
  // Aviso de diferença na hora em que o valor da NF muda.
  const conferir = i => {
    const v = lerValor($(`#ap-nv-${i}`, dlg)?.value || '');
    const aviso = $(`[data-ap-dif="${i}"]`, dlg);
    if (aviso) aviso.hidden = !(Number.isFinite(v) && Math.round(v * 100) !== Math.round(linhas[i].valor * 100));
  };
  await abrirDialogo({
    titulo: `ADP dos PJ, ${mesMinusculo(r.mes)}`,
    descricao: 'Autorização de pagamento das notas fiscais dos representantes (documentos diversos / NF).',
    corpo,
    acoes: [{ rotulo: 'Cancelar', valor: null, tipo: 'fantasma' }, { rotulo: 'Gerar PDF', valor: 'gerar', tipo: 'primario', principal: true }],
    aoAbrir: d => {
      dlg = d; resumo();
      const desligar = ligarMascaras(d);
      d.addEventListener('change', e => { if (e.target.matches('[data-ap-marca]')) resumo(); });
      d.addEventListener('input', e => { const m = /^ap-nv-(\d+)$/.exec(e.target.id); if (m) conferir(+m[1]); });
      d.addEventListener('close', desligar, { once: true });
    },
    antesDeFechar: async (_v, d) => {
      erroNoDialogo(d, '');
      const venc = $('#ap-venc', d).value;
      const erros = {};
      if (!venc) erros['ap-venc'] = 'Informe o vencimento.';
      const marcadas = [];
      linhas.forEach((l, i) => {
        if (!marcada(i)) return;
        const nf = $(`#ap-nf-${i}`, d).value.trim();
        const nfValor = lerValor($(`#ap-nv-${i}`, d).value);
        if (!NF_RE.test(nf)) erros[`ap-nf-${i}`] = nf ? 'Só letras, números e . / - (até 20).' : 'Informe o número da NF.';
        if (!(nfValor >= 0.01)) erros[`ap-nv-${i}`] = 'Informe o valor da NF.';
        marcadas.push({ ...l, nf, nf_valor: nfValor, diferenca: Math.round(nfValor * 100) !== Math.round(l.valor * 100) });
      });
      if (Object.keys(erros).length) { aplicarErros(d, erros); return false; }
      if (!marcadas.length) { erroNoDialogo(d, 'Marque pelo menos um representante.'); return false; }
      const dif = marcadas.filter(l => l.diferenca);
      if (dif.length) {
        const ok = await confirmar({
          titulo: dif.length === 1 ? 'Uma nota com valor diferente' : `${dif.length} notas com valor diferente`,
          descricao: `${dif.map(l => `${l.nome}: NF de ${r$(l.nf_valor)}, a pagar ${r$(l.valor)}`).join('. ')}. A ADP sai com o valor a pagar. Gerar assim mesmo?`,
          confirmar: 'Gerar assim mesmo',
        });
        if (!ok) return false;
      }
      try {
        if (!travado) {
          for (const l of marcadas) {
            const atual = comissoes.mesPj(r.mes, l.id) || {};
            if (l.nf !== (atual.nf_numero || '') || l.nf_valor !== atual.nf_valor) await comissoes.salvarMesPj(r.mes, l.id, { nf_numero: l.nf, nf_valor: l.nf_valor });
          }
        }
        const { gerarAdpPj } = await import('../comissoes-pdf.js');
        const x = await gerarAdpPj(marcadas, { mes: r.mes, vencimento: venc });
        s.ctx.toast(`ADP gerada: ${x.quantidade} ${x.quantidade === 1 ? 'nota' : 'notas'}, ${r$(x.total)}.`, { tom: 'sucesso' });
        return true;
      } catch (e) { erroNoDialogo(d, detalhar(e).mensagem); return false; }
    },
  });
  if (s && !travado) { await recalcular(); desenhar(); }
}

// ---------- fechar e reabrir o mês (histórico) ----------
async function fecharMes() {
  const r = s.resultado;
  const avisos = antesDeFechar(r).filter(i => !i.ok).map(i => i.texto.replace(/^./, c => c.toLowerCase()));
  const ok = await confirmar({
    titulo: `Fechar ${mesMinusculo(r.mes)}?`,
    descricao: `O mês entra no histórico com ${r$(r.totais.geral.valor_pagar)} (CLT ${r$(r.totais.clt.valor_pagar)}, PJ ${r$(r.totais.pj.valor_pagar)}). Premiações, ajustes, contrato e NF ficam travados.${avisos.length ? ` Atenção: ${avisos.join('; ')}.` : ''}`,
    confirmar: 'Fechar mês',
  });
  if (!ok) return;
  await ocupar('fechar', async () => {
    await comissoes.fecharMes(r);
    s.resultado = await comissoes.apurar(r.mes, { buscar: false });
    s.historico = null;
    s.ctx.toast(`${rotuloMesComissao(r.mes)} fechado e no histórico.`, { tom: 'sucesso' });
  });
}

async function reabrirMes() {
  const mes = s.mes;
  const v = await abrirDialogo({
    titulo: `Reabrir ${mesMinusculo(mes)}?`,
    descricao: 'A cópia do histórico continua guardada. Depois de corrigir, feche o mês de novo.',
    corpo: areaTexto({ id: 'rb-motivo', rotulo: 'Motivo', obrigatorio: true, atributos: { rows: 2, maxlength: 300 } }),
    acoes: [{ rotulo: 'Cancelar', valor: null, tipo: 'fantasma' }, { rotulo: 'Reabrir mês', valor: 'reabrir', tipo: 'perigo', principal: true }],
    antesDeFechar: async (_v, d) => {
      const motivo = $('#rb-motivo', d).value.trim().replace(/\s+/g, ' ');
      if (motivo.length < 3) { aplicarErros(d, { 'rb-motivo': 'Escreva o motivo (3 letras ou mais).' }); return false; }
      try { await comissoes.reabrirMes(mes, motivo); return true; }
      catch (e) { erroNoDialogo(d, detalhar(e).mensagem); return false; }
    },
  });
  if (v !== 'reabrir' || !s) return;
  s.historico = null;
  s.resultado = await comissoes.apurar(mes, { buscar: false });
  s.ctx.toast(`${rotuloMesComissao(mes)} reaberto. Busque as vendas para recalcular.`, { tom: 'sucesso' });
  desenhar();
}

// ---------- histórico ----------
function telaHistorico() {
  if (!s.historico) {
    const meu = s;
    comissoes.historico().then(h => { if (s === meu) { s.historico = h; desenhar(); } })
      .catch(e => { if (s === meu) { s.historico = []; s.ctx.toast(detalhar(e).mensagem, { tom: 'erro' }); desenhar(); } });
    return carregando(2);
  }
  if (!s.historico.length) return vazio({ icone: 'historico', titulo: 'Nenhum mês fechado ainda', texto: 'Depois de gerar a ADP e os recibos, use "Fechar mês" na Apuração. O mês entra aqui com a cópia do que foi pago.' });
  return html`<div class="tabela-caixa"><table class="tabela cm-tabela">
    <thead><tr><th scope="col">Mês</th><th scope="col" class="num">CLT</th><th scope="col" class="num">PJ</th><th scope="col" class="num">Total</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead>
    <tbody>${s.historico.map(f => html`<tr>
      <td data-rotulo="Mês" class="principal"><strong>${rotuloMesComissao(f.mes)}</strong>
        <small class="cm-sub">${f.status === 'fechado' ? `Fechado em ${dataBR(f.fechado_em)}` : `Reaberto em ${dataBR(f.reaberto_em)}: ${f.motivo_reabertura || ''}`}</small></td>
      <td data-rotulo="CLT" class="num tabular">${r$(f.total_clt)}</td>
      <td data-rotulo="PJ" class="num tabular">${r$(f.total_pj)}</td>
      <td data-rotulo="Total" class="num tabular cm-pagar">${r$(f.total)}</td>
      <td data-rotulo="" class="cm-acao"><button type="button" class="btn btn-fantasma btn-pequeno" data-abrir-mes="${f.mes}" aria-label="Abrir ${rotuloMesComissao(f.mes)}">${icone('seta')} Abrir</button></td>
    </tr>`)}</tbody></table></div>`;
}

// ---------- premiações e ajustes ----------
// Os dois são lançamentos do mês por pessoa: premiação (valor positivo, campanha) e ajuste (+/−, motivo).
const LANC = {
  premio: { tabela: 'premiacoes', texto: x => x.descricao, rotuloTexto: 'Campanha', titulo: 'Premiações do mês' },
  ajuste: { tabela: 'ajustes', texto: x => x.motivo, rotuloTexto: 'Motivo', titulo: 'Ajustes do mês' },
};

function tabelaLancamentos(tipo, lista, travado) {
  const k = LANC[tipo];
  const porId = new Map(comissoes.cadastro().map(c => [c.id, c]));
  const total = lista.reduce((t, x) => t + Number(x.valor), 0);
  const sinal = v => (tipo === 'ajuste' ? (v < 0 ? '−' : '+') : '') + r$(Math.abs(v));
  return html`<section aria-labelledby="cm-t-${tipo}">
    <h2 class="secao-titulo" id="cm-t-${tipo}">${k.titulo} <span class="contador-texto">${lista.length}</span></h2>
    <div class="tabela-caixa"><table class="tabela cm-tabela">
      <thead><tr><th scope="col">Quem recebe</th><th scope="col">${k.rotuloTexto}</th><th scope="col" class="num">Valor</th>${travado ? '' : html`<th scope="col"><span class="sr-only">Ações</span></th>`}</tr></thead>
      <tbody>${lista.map(x => { const c = porId.get(x.comissionado_id); return html`<tr>
        <td data-rotulo="Quem recebe" class="principal"><strong>${c?.nome || '—'}</strong><small class="cm-sub">${c ? ROTULO_REGIME[c.regime] : ''}</small></td>
        <td data-rotulo="${k.rotuloTexto}">${k.texto(x)}</td>
        <td data-rotulo="Valor" class="num tabular">${sinal(x.valor)}</td>
        ${travado ? '' : html`<td data-rotulo="" class="cm-acao"><button type="button" class="btn btn-texto btn-pequeno" data-remover="${tipo}:${x.id}" aria-label="Remover ${k.texto(x)} de ${c?.nome || ''}">${icone('lixeira')} Remover</button></td>`}
      </tr>`; })}</tbody>
      <tfoot><tr><th scope="row" colspan="2">Total</th><td class="num tabular cm-pagar">${sinal(total)}</td>${travado ? '' : html`<td></td>`}</tr></tfoot>
    </table></div></section>`;
}

function telaPremiacoes() {
  const travado = fechado();
  const premios = comissoes.premiacoes(s.mes);
  const ajustes = comissoes.ajustes(s.mes);
  const pessoas = ativos().map(c => ({ valor: c.id, rotulo: `${c.nome} (${ROTULO_REGIME[c.regime]})` }));
  return html`
    ${travado ? avisoFechado() : html`<div class="cm-lancar">
      <form class="painel cm-premiar" id="cm-form-premio" novalidate aria-labelledby="cm-t-premio">
        <h2 class="painel-titulo" id="cm-t-premio">Lançar premiação de ${mesMinusculo(s.mes)}</h2>
        <div class="painel-corpo">
          ${selecao({ id: 'pr-pessoa', rotulo: 'Quem recebe', opcoes: pessoas, vazio: 'Escolha a pessoa', obrigatorio: true })}
          ${campo({ id: 'pr-desc', rotulo: 'Campanha', obrigatorio: true, atributos: { maxlength: 120, autocomplete: 'off' } })}
          ${campo({ id: 'pr-valor', rotulo: 'Valor', obrigatorio: true, mascara: 'valor' })}
          <div class="acoes acoes-fim"><button type="submit" class="btn btn-primario">${icone('mais')} Lançar premiação</button></div>
        </div>
      </form>
      <form class="painel cm-premiar" id="cm-form-ajuste" novalidate aria-labelledby="cm-t-ajuste">
        <h2 class="painel-titulo" id="cm-t-ajuste">Lançar ajuste</h2>
        <div class="painel-corpo">
          ${selecao({ id: 'aj-pessoa', rotulo: 'Quem recebe', opcoes: pessoas, vazio: 'Escolha a pessoa', obrigatorio: true })}
          ${campo({ id: 'aj-motivo', rotulo: 'Motivo', obrigatorio: true, dica: 'Entra depois do acordo mínimo e aparece no recibo.', atributos: { maxlength: 200, autocomplete: 'off' } })}
          <div class="cm-duas">
            ${selecao({ id: 'aj-tipo', rotulo: 'Tipo', obrigatorio: true, valor: 'desconto', vazio: 'Escolha', opcoes: [{ valor: 'desconto', rotulo: 'Desconto (−)' }, { valor: 'acrescimo', rotulo: 'Acréscimo (+)' }] })}
            ${campo({ id: 'aj-valor', rotulo: 'Valor', obrigatorio: true, mascara: 'valor' })}
          </div>
          <div class="acoes acoes-fim"><button type="submit" class="btn btn-fantasma">${icone('mais')} Lançar ajuste</button></div>
        </div>
      </form>
    </div>`}
    ${premios.length ? tabelaLancamentos('premio', premios, travado)
      : vazio({ icone: 'moeda', titulo: `Nenhuma premiação em ${mesMinusculo(s.mes)}`, texto: 'As premiações de campanha do mês entram no valor a pagar, no recibo e no Excel.' })}
    ${ajustes.length ? tabelaLancamentos('ajuste', ajustes, travado) : ''}`;
}

async function lancar(form, tipo) {
  const v = k => $(`#${k}`, form).value;
  const premio = tipo === 'premio';
  const p = premio ? 'pr' : 'aj';
  const texto = v(premio ? 'pr-desc' : 'aj-motivo').trim().replace(/\s+/g, ' ');
  const valor = lerValor(v(`${p}-valor`));
  const erros = {};
  if (!v(`${p}-pessoa`)) erros[`${p}-pessoa`] = 'Escolha quem recebe.';
  if (texto.length < (premio ? 2 : 3)) erros[premio ? 'pr-desc' : 'aj-motivo'] = premio ? 'Informe a campanha.' : 'Escreva o motivo (3 letras ou mais).';
  if (!(valor >= 0.01 && valor <= 1000000)) erros[`${p}-valor`] = 'Valor de R$ 0,01 a R$ 1.000.000,00.';
  if (Object.keys(erros).length) { aplicarErros(form, erros); return; }
  const botao = $('button[type="submit"]', form);
  botao.disabled = true; botao.setAttribute('aria-busy', 'true');
  const comissionado_id = v(`${p}-pessoa`);
  const c = comissoes.cadastro().find(x => String(x.id) === String(comissionado_id));
  try {
    if (premio) await comissoes.lancarPremiacao({ mes: s.mes, comissionado_id, descricao: texto, valor });
    else await comissoes.lancarAjuste({ mes: s.mes, comissionado_id, motivo: texto, valor: v('aj-tipo') === 'acrescimo' ? valor : -valor });
    await recalcular();
    s.ctx.toast(premio ? `Premiação de ${r$(valor)} lançada para ${c?.nome || ''}.` : `Ajuste de ${v('aj-tipo') === 'acrescimo' ? '+' : '−'}${r$(valor)} lançado para ${c?.nome || ''}.`, { tom: 'sucesso' });
    desenhar();
    $(`#${p}-pessoa`, s.el)?.focus();
  } catch (e) {
    s.ctx.toast(detalhar(e).mensagem, { tom: 'erro' });
    botao.disabled = false; botao.removeAttribute('aria-busy');
  }
}

async function remover(chave) {
  const [tipo, id] = chave.split(':');
  const k = LANC[tipo];
  const x = (tipo === 'premio' ? comissoes.premiacoes(s.mes) : comissoes.ajustes(s.mes)).find(p => String(p.id) === id);
  if (!x) return;
  const ok = await confirmar({ titulo: `Remover ${k.texto(x)}?`, descricao: `${r$(Math.abs(x.valor))} deixam de entrar na comissão de ${mesMinusculo(s.mes)}. O lançamento fica no histórico de alterações.`, confirmar: 'Remover', perigo: true });
  if (!ok) return;
  try {
    if (tipo === 'premio') await comissoes.removerPremiacao(s.mes, x.id);
    else await comissoes.removerAjuste(s.mes, x.id);
    await recalcular();
    s.ctx.toast(tipo === 'premio' ? 'Premiação removida.' : 'Ajuste removido.', { tom: 'sucesso' });
    desenhar();
  } catch (e) { s.ctx.toast(detalhar(e).mensagem, { tom: 'erro' }); }
}

// ---------- Contrato de Resultado (PJ) ----------
function contratoDe(c) {
  const linha = s.resultado?.linhas.find(l => l.id === c.id);
  if (linha?.contrato) return linha.contrato;
  const e = entradaContrato(c, comissoes.mesPj(s.mes, c.id), null);
  return { ...avaliarContrato(e, comissoes.parametros()), meta_origem: e.meta_origem, informado: e.informado, semQlik: !e.informado };
}

function telaContrato() {
  const ct = mesAnteriorFechado(s.mes);
  const travado = fechado();
  const pjs = travado ? (s.resultado?.linhas || []).filter(ehPJ) : ativos().filter(ehPJ);
  const origem = c => (c.meta_origem === 'mes' ? '' : c.meta_origem === 'cadastro' ? html`<small class="cm-sub">Meta do cadastro</small>` : '');
  return html`
    ${travado ? avisoFechado() : ''}
    <p class="nota">${icone('info')}<span>Metas e realizado de ${mesMinusculo(ct.mes)}, pagos na comissão de ${mesMinusculo(s.mes)}.
      ${s.resultado ? 'O realizado vem do Qlik; informe à mão só quando o Qlik não servir.' : 'Busque as vendas para ver o realizado do Qlik.'}</span></p>
    ${pjs.length ? html`<div class="tabela-caixa"><table class="tabela cm-tabela">
      <thead><tr><th scope="col">Representante</th><th scope="col" class="num">Meta de faturamento</th><th scope="col" class="num">Realizado</th>
        <th scope="col" class="num">Meta de positivação</th><th scope="col" class="num">Positivados</th><th scope="col" class="num">Prêmio</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead>
      <tbody>${pjs.map(c => {
        const k = contratoDe(c);
        const semReal = k.semQlik && !s.resultado;
        return html`<tr>
          <td data-rotulo="Representante" class="principal"><strong>${c.nome}</strong>${origem(k)}${k.informado ? html`<small class="cm-sub">Realizado informado: ${k.motivo_informado || ''}</small>` : ''}</td>
          <td data-rotulo="Meta de faturamento" class="num tabular">${k.meta_faturamento ? r$(k.meta_faturamento) : '—'}</td>
          <td data-rotulo="Realizado" class="num tabular">${semReal ? '—' : html`${r$(k.realizado_faturamento)}<small class="cm-sub">${pct1(k.pct_faturamento)}</small>`}</td>
          <td data-rotulo="Meta de positivação" class="num tabular">${k.meta_positivacao ?? '—'}</td>
          <td data-rotulo="Positivados" class="num tabular">${semReal ? '—' : html`${k.positivados}<small class="cm-sub">${pct1(k.pct_positivacao)}</small>`}</td>
          <td data-rotulo="Prêmio" class="num tabular cm-pagar">${semReal ? '—' : k.atingiu ? html`${r$(k.valor)}<small class="cm-sub">${pctTxt(k.pct_premio)}</small>` : html`<span class="cm-sub cm-nao">${k.motivo || 'Não atingiu'}</span>`}</td>
          <td data-rotulo="" class="cm-acao">${travado ? '' : html`<button type="button" class="btn btn-fantasma btn-pequeno" data-contrato="${c.id}" aria-label="Editar contrato de ${c.nome}">${icone('editar')} Editar</button>`}</td>
        </tr>`;
      })}</tbody></table></div>`
      : vazio({ icone: 'pessoa', titulo: 'Nenhum representante PJ ativo', texto: 'Os PJ aparecem aqui depois de completar o cadastro com regime PJ.' })}`;
}

async function editarContrato(c) {
  const ct = mesAnteriorFechado(s.mes);
  const atual = comissoes.mesPj(s.mes, c.id) || {};
  const temMes = atual.meta_faturamento != null || atual.meta_positivacao != null;
  const metaF = temMes ? atual.meta_faturamento : c.meta_faturamento;
  const metaP = temMes ? atual.meta_positivacao : c.meta_positivacao;
  const linha = s.resultado?.linhas.find(l => l.id === c.id);
  const qlik = linha?.contrato ? `No Qlik: ${r$(linha.contrato.qlik_faturamento)} e ${linha.contrato.qlik_positivados} clientes positivados.` : 'Busque as vendas para ver o realizado do Qlik.';
  const informado = atual.realizado_faturamento != null || atual.realizado_positivacao != null;
  const corpo = html`
    <fieldset class="cm-bloco"><legend>Metas de ${mesMinusculo(ct.mes)}</legend>
      ${temMes || metaF == null ? '' : html`<p class="campo-dica">Preenchidas com a meta do cadastro. Salvar grava para este mês.</p>`}
      <div class="cm-duas">
        ${campo({ id: 'ct-mf', rotulo: 'Faturamento', valor: valorCampo(metaF), mascara: 'valor', obrigatorio: true })}
        ${campo({ id: 'ct-mp', rotulo: 'Clientes positivados', valor: metaP ?? '', obrigatorio: true, atributos: { inputmode: 'numeric', maxlength: 6 } })}
      </div>
    </fieldset>
    <fieldset class="cm-bloco"><legend>Realizado informado à mão</legend>
      <p class="campo-dica">${qlik} Preencha só se o Qlik não servir; em branco, vale o Qlik.</p>
      <div class="cm-duas">
        ${campo({ id: 'ct-rf', rotulo: 'Faturamento realizado', opcional: true, valor: valorCampo(atual.realizado_faturamento), mascara: 'valor' })}
        ${campo({ id: 'ct-rp', rotulo: 'Positivados', opcional: true, valor: atual.realizado_positivacao ?? '', atributos: { inputmode: 'numeric', maxlength: 6 } })}
      </div>
      ${areaTexto({ id: 'ct-mot', rotulo: 'Motivo', opcional: !informado, valor: atual.realizado_motivo || '', dica: 'Obrigatório quando informar o realizado.', atributos: { rows: 2, maxlength: 200 } })}
    </fieldset>`;
  let desligar = null;
  const v = await abrirDialogo({
    titulo: `Contrato de ${c.nome}`,
    descricao: `Comissão de ${mesMinusculo(s.mes)}.`,
    corpo,
    acoes: [{ rotulo: 'Cancelar', valor: null, tipo: 'fantasma' }, { rotulo: 'Salvar contrato', valor: 'salvar', tipo: 'primario', principal: true }],
    aoAbrir: d => { desligar = ligarMascaras(d); },
    antesDeFechar: async (_v, d) => {
      erroNoDialogo(d, '');
      const val = k => $(`#${k}`, d).value.trim();
      const inteiro = k => (val(k) === '' ? null : Number(val(k).replace(/\D/g, '')));
      const dados = {
        meta_faturamento: val('ct-mf') === '' ? null : lerValor(val('ct-mf')), meta_positivacao: inteiro('ct-mp'),
        realizado_faturamento: val('ct-rf') === '' ? null : lerValor(val('ct-rf')), realizado_positivacao: inteiro('ct-rp'),
        realizado_motivo: val('ct-mot').replace(/\s+/g, ' ') || null,
      };
      const erros = {};
      if (!(dados.meta_faturamento > 0 && dados.meta_faturamento <= 1e8)) erros['ct-mf'] = 'Informe a meta de faturamento.';
      if (!(Number.isInteger(dados.meta_positivacao) && dados.meta_positivacao > 0 && dados.meta_positivacao <= 100000)) erros['ct-mp'] = 'Informe a meta (número inteiro).';
      if (dados.realizado_faturamento != null && !Number.isFinite(dados.realizado_faturamento)) erros['ct-rf'] = 'Valor inválido.';
      const temReal = dados.realizado_faturamento != null || dados.realizado_positivacao != null;
      if (temReal && !(dados.realizado_motivo && dados.realizado_motivo.length >= 3)) erros['ct-mot'] = 'Escreva o motivo (3 letras ou mais).';
      if (!temReal) dados.realizado_motivo = null;
      if (Object.keys(erros).length) { aplicarErros(d, erros); return false; }
      try { await comissoes.salvarMesPj(s.mes, c.id, dados); return true; }
      catch (e) { erroNoDialogo(d, detalhar(e).mensagem); return false; }
    },
  });
  if (desligar) desligar();
  if (v !== 'salvar' || !s) return;
  await recalcular();
  desenhar();
  s.ctx.toast(`Contrato de ${c.nome} salvo.`, { tom: 'sucesso' });
}

// ---------- cadastro ----------
function telaCadastro() {
  const nInativos = comissoes.cadastro().filter(c => c.ativo === false).length;
  return html`
    <div class="cm-cad-topo">
      ${campoBusca({ id: 'cm-busca', rotulo: 'Buscar comissionado', valor: s.busca, placeholder: 'Nome, equipe ou nome no Qlik' })}
    </div>
    <p class="secao-nota">As pessoas vêm do Qlik (Vendedor B2B). Quem aparece pela primeira vez fica em "Novos no Qlik", na Apuração, para completar o cadastro.</p>
    ${nInativos ? interruptor({ id: 'cm-inativos', rotulo: `Mostrar desativados (${nInativos})`, marcado: s.inativos }) : ''}
    <div id="cm-lista">${listaCadastro()}</div>`;
}

function listaCadastro() {
  const lista = comissoes.cadastro()
    .filter(c => s.inativos || c.ativo !== false)
    .filter(c => !s.busca || contem(s.busca, `${c.nome} ${c.equipe || ''} ${c.nomes_qlik.join(' ')} ${c.pj_razao_social || ''} ${ROTULO_REGIME[c.regime]}`));
  const grupo = (titulo, ls) => (ls.length ? html`<section class="painel" aria-label="${titulo}">
    <h2 class="painel-titulo">${titulo} <span class="contador-texto">${ls.length}</span></h2>
    <ul class="usuarios-lista">${ls.map(itemCadastro)}</ul></section>` : '');
  return lista.length ? html`${grupo('CLT', lista.filter(c => !ehPJ(c)))}${grupo('PJ', lista.filter(ehPJ))}`
    : vazio({ icone: 'pessoa', titulo: s.busca ? 'Ninguém com esse nome' : 'Ninguém cadastrado ainda', texto: s.busca ? 'Busque pelo nome, pela equipe ou pelo nome no Qlik.' : 'Busque as vendas de um mês na Apuração: quem vendeu aparece em "Novos no Qlik" para completar.' });
}

function itemCadastro(c) {
  const falta = ehPJ(c) ? pendenciasPj(c) : [];
  const linhaExtra = ehPJ(c)
    ? (falta.length ? html`<small class="cm-falta">${icone('alerta')}<span>Falta para o recibo e a ADP: ${falta.join(', ')}</span></small>` : '')
    : c.acordo_minimo ? html`<small>Acordo mínimo de ${r$(c.acordo_minimo)}, de ${dataBR(c.acordo_inicio)} a ${c.acordo_fim ? dataBR(c.acordo_fim) : 'sem fim'}</small>` : '';
  return html`<li class="usuario${c.ativo === false ? ' inativo' : ''}">
    <div class="usuario-avatar" aria-hidden="true">${c.nome.trim().charAt(0).toUpperCase()}</div>
    <div class="usuario-dados">
      <strong>${c.nome}${c.regime === 'TELEVENDAS' ? html` ${seloNeutro('Televendas')}` : ''}${c.ativo === false ? html` ${seloNeutro('Desativado')}` : ''}</strong>
      <small>${pctTxt(c.pct_principal)} e ${pctTxt(c.pct_farelo)} no Farelo${c.equipe ? `, ${c.equipe}` : ''}${ehPJ(c) && c.pj_razao_social ? `. Recebe como ${c.pj_razao_social}` : ''}</small>
      <small>No Qlik: ${c.nomes_qlik.join(', ')}</small>
      ${linhaExtra}
    </div>
    <div class="acoes"><button type="button" class="btn btn-fantasma btn-pequeno" data-editar="${c.id}" aria-label="Editar ${c.nome}">${icone('editar')} Editar</button></div>
  </li>`;
}

const ID = k => `dc-${k.replace(/_/g, '-')}`;
const pctPadraoObj = regime => { const p = pctPadrao(regime, comissoes.parametros()); return { pct_principal: p.principal, pct_farelo: p.farelo }; };
const sufixo = html`<span class="cm-sufixo" aria-hidden="true">%</span>`;

// c: cadastro existente, ou null para completar quem chegou do Qlik (nomeDoQlik obrigatório).
async function editar(c, nomeDoQlik = null) {
  const novo = !c;
  const base = c || novoDoQlik(nomeDoQlik, 'CLT', comissoes.parametros());
  const dv = k => (base[k] ?? '');
  const corpo = html`
    <p class="cm-qlik"><span class="cm-discreto">Nome no Qlik</span> <strong>${base.nomes_qlik.join(', ')}</strong></p>
    ${campo({ id: ID('nome'), rotulo: 'Nome', valor: dv('nome'), obrigatorio: true, dica: 'Como aparece no app, no recibo e no Excel.', atributos: { maxlength: 80, autocomplete: 'off' } })}
    <div class="cm-duas">
      ${selecao({ id: ID('regime'), rotulo: 'Regime', obrigatorio: true, valor: base.regime, opcoes: REGIMES.map(r => ({ valor: r, rotulo: ROTULO_REGIME[r] })) })}
      ${campo({ id: ID('equipe'), rotulo: 'Equipe', opcional: true, valor: dv('equipe'), atributos: { maxlength: 60 } })}
    </div>
    <div class="cm-duas">
      ${campo({ id: ID('pct_principal'), rotulo: '% sobre a venda principal', valor: valorPct(base.pct_principal), obrigatorio: true, mascara: 'decimal', depois: sufixo })}
      ${campo({ id: ID('pct_farelo'), rotulo: '% sobre o Farelo', valor: valorPct(base.pct_farelo), obrigatorio: true, mascara: 'decimal', depois: sufixo })}
    </div>
    ${campo({ id: ID('email'), rotulo: 'E-mail', tipo: 'email', opcional: true, valor: dv('email'), dica: 'Para mandar o recibo direto, quando essa opção existir.', atributos: { maxlength: 120, autocomplete: 'off' } })}

    <fieldset class="cm-bloco" data-so="clt"${ehPJ(base) ? html` hidden` : ''}>
      <legend>Acordo mínimo garantido</legend>
      <p class="campo-dica">Na vigência, paga o maior valor entre a comissão do mês e o acordo. Sem valor, sem acordo.</p>
      ${campo({ id: ID('acordo_minimo'), rotulo: 'Valor do acordo', opcional: true, valor: valorCampo(base.acordo_minimo), mascara: 'valor' })}
      <div class="cm-duas">
        ${campo({ id: ID('acordo_inicio'), rotulo: 'Começa em', tipo: 'date', valor: dv('acordo_inicio') })}
        ${campo({ id: ID('acordo_fim'), rotulo: 'Termina em', tipo: 'date', opcional: true, valor: dv('acordo_fim') })}
      </div>
    </fieldset>

    <fieldset class="cm-bloco" data-so="pj"${ehPJ(base) ? '' : html` hidden`}>
      <legend>Quem recebe (recibo e ADP)</legend>
      <p class="campo-dica">As metas do Contrato de Resultado ficam na aba Contrato PJ, mês a mês.</p>
      ${campo({ id: ID('pj_razao_social'), rotulo: 'Razão social', opcional: true, valor: dv('pj_razao_social'), atributos: { maxlength: 120 } })}
      <div class="cm-duas">
        ${campo({ id: ID('pj_documento'), rotulo: 'CNPJ ou CPF', opcional: true, valor: dv('pj_documento'), atributos: { inputmode: 'numeric', maxlength: 18, autocomplete: 'off' } })}
        ${campo({ id: ID('pj_banco'), rotulo: 'Banco', opcional: true, valor: dv('pj_banco'), atributos: { maxlength: 60 } })}
      </div>
      ${campo({ id: ID('pj_pix'), rotulo: 'Chave PIX', opcional: true, valor: dv('pj_pix'), atributos: { maxlength: 140, autocomplete: 'off' } })}
      ${campo({ id: ID('adp_observacao'), rotulo: 'Observação na ADP', opcional: true, valor: dv('adp_observacao'), dica: 'Por exemplo: Pagamento dos representantes comerciais da Lynkz do interior do Maranhão', atributos: { maxlength: 200 } })}
    </fieldset>
    ${novo ? '' : interruptor({ id: ID('ativo'), rotulo: 'Ativo', marcado: base.ativo !== false, dica: 'Desligado, sai das próximas apurações. Nada é apagado.' })}`;

  let salvo = null;
  let desligar = null;
  await abrirDialogo({
    titulo: novo ? `Completar cadastro` : `Editar ${c.nome}`,
    descricao: novo ? 'Este vendedor apareceu no Qlik. Defina o regime e os percentuais para as vendas dele entrarem na comissão.' : '',
    corpo,
    acoes: [
      { rotulo: 'Cancelar', valor: null, tipo: 'fantasma' },
      { rotulo: novo ? 'Salvar cadastro' : 'Salvar alterações', valor: 'salvar', tipo: 'primario', principal: true },
    ],
    aoAbrir: d => {
      desligar = ligarMascaras(d);
      // Trocar o regime mostra os blocos certos e troca os % que ainda estavam no padrão do regime anterior.
      let anterior = base.regime;
      $(`#${ID('regime')}`, d).addEventListener('change', e => {
        const regime = e.target.value || 'CLT';
        $$('[data-so]', d).forEach(f => { f.hidden = f.dataset.so === 'pj' ? regime !== 'PJ' : regime === 'PJ'; });
        const antes = pctPadraoObj(anterior);
        const depois = pctPadraoObj(regime);
        for (const k of ['pct_principal', 'pct_farelo']) {
          const inp = $(`#${ID(k)}`, d);
          if (!inp.value.trim() || lerValor(inp.value) === antes[k]) inp.value = valorPct(depois[k]);
        }
        anterior = regime;
      });
    },
    antesDeFechar: async (_v, d) => {
      erroNoDialogo(d, '');
      const val = k => $(`#${ID(k)}`, d)?.value ?? '';
      const num = k => (val(k).trim() === '' ? null : lerValor(val(k)));
      const dados = {
        id: c?.id,
        nome: val('nome').trim().replace(/\s+/g, ' '),
        regime: val('regime'),
        equipe: val('equipe').trim(),
        pct_principal: num('pct_principal'),
        pct_farelo: num('pct_farelo'),
        nomes_qlik: base.nomes_qlik,
        email: val('email').trim(),
        acordo_minimo: num('acordo_minimo'),
        acordo_inicio: val('acordo_inicio') || null,
        acordo_fim: val('acordo_fim') || null,
        pj_razao_social: val('pj_razao_social').trim(),
        pj_documento: val('pj_documento').replace(/\D/g, ''),
        pj_pix: val('pj_pix').trim(),
        pj_banco: val('pj_banco').trim(),
        adp_observacao: val('adp_observacao').trim(),
        ativo: novo ? true : !!$(`#${ID('ativo')}`, d)?.checked,
      };
      if (dados.regime === 'PJ') Object.assign(dados, { acordo_minimo: null, acordo_inicio: null, acordo_fim: null });
      const erros = errosComissionado(dados, comissoes.cadastro());
      if (dados.pj_documento && !/^(\d{11}|\d{14})$/.test(dados.pj_documento)) erros.pj_documento = 'CNPJ com 14 números ou CPF com 11.';
      if (erros.nomes_qlik) { erroNoDialogo(d, erros.nomes_qlik); delete erros.nomes_qlik; if (!Object.keys(erros).length) return false; }
      if (Object.keys(erros).length) {
        aplicarErros(d, Object.fromEntries(Object.entries(erros).map(([k, m]) => [ID(k), m])));
        return false;
      }
      try { salvo = await comissoes.salvar(dados, c?.id ?? null); return true; }
      catch (e) { erroNoDialogo(d, detalhar(e).mensagem); return false; }
    },
  });
  if (desligar) desligar();
  if (!salvo || !s) return;
  await recalcular();
  desenhar();
  s.ctx.toast(novo ? `${salvo.nome} entrou na comissão.` : 'Cadastro salvo.', { tom: 'sucesso' });
}

// ---------- parâmetros ----------
function telaParametros() {
  const p = comissoes.parametros();
  const pc = (k, rotulo) => campo({ id: `cp-${k}`, rotulo, valor: valorPct(p[k]), obrigatorio: true, mascara: 'decimal', depois: sufixo });
  return html`<form class="cm-parametros" id="cm-form-param" novalidate>
    <section class="painel" aria-labelledby="cp-t1"><h2 class="painel-titulo" id="cp-t1">Apuração</h2><div class="painel-corpo">
      <div class="cm-duas">
        ${campo({ id: 'cp-cod_farelo', rotulo: 'Código do fornecedor do Farelo', valor: p.cod_farelo, obrigatorio: true, atributos: { inputmode: 'numeric', maxlength: 10 } })}
        ${campo({ id: 'cp-dia_corte', rotulo: 'Dia de corte', valor: p.dia_corte, obrigatorio: true, dica: `Hoje: do dia ${Number(p.dia_corte) + 1} do mês anterior ao dia ${p.dia_corte}.`, atributos: { inputmode: 'numeric', maxlength: 2 } })}
      </div>
      ${areaTexto({ id: 'cp-nomes_ignorados', rotulo: 'Nomes do Qlik que não comissionam', valor: p.nomes_ignorados.join('\n'), opcional: true, dica: 'Um por linha. Por exemplo: TERRAZOO, venda da própria empresa.', atributos: { rows: 3 } })}
    </div></section>
    <section class="painel" aria-labelledby="cp-t2"><h2 class="painel-titulo" id="cp-t2">% de quem completar o cadastro</h2><div class="painel-corpo">
      <p class="campo-dica">Preenchem o cadastro de quem chega do Qlik. Quem já está cadastrado continua com os % do próprio cadastro.</p>
      <div class="cm-tres">${pc('pct_clt_principal', 'CLT')}${pc('pct_televendas_principal', 'Televendas')}${pc('pct_pj_principal', 'PJ')}</div>
      <div class="cm-tres">${pc('pct_clt_farelo', 'CLT no Farelo')}${pc('pct_televendas_farelo', 'Televendas no Farelo')}${pc('pct_pj_farelo', 'PJ no Farelo')}</div>
    </div></section>
    <section class="painel" aria-labelledby="cp-t3"><h2 class="painel-titulo" id="cp-t3">Contrato de Resultado (PJ)</h2><div class="painel-corpo">
      <div class="cm-duas">${pc('contrato_gatilho_faturamento', 'Faturamento mínimo da meta')}${pc('contrato_gatilho_positivacao', 'Positivação mínima da meta')}</div>
      <div class="cm-tres">${pc('contrato_pct_faixa1', 'Prêmio')}${pc('contrato_limite_faixa', 'Faturamento para o prêmio maior')}${pc('contrato_pct_faixa2', 'Prêmio maior')}</div>
      <p class="campo-dica">Hoje: com ${pctTxt(p.contrato_gatilho_faturamento)} do faturamento e ${pctTxt(p.contrato_gatilho_positivacao)} da positivação, paga ${pctTxt(p.contrato_pct_faixa1)} do faturamento realizado; acima de ${pctTxt(p.contrato_limite_faixa)}, paga ${pctTxt(p.contrato_pct_faixa2)}.</p>
    </div></section>
    <div class="acoes acoes-fim">
      ${p.atualizado_em ? html`<span class="cm-discreto cm-alterado">Alterados em ${dataBR(p.atualizado_em)}</span>` : ''}
      <button type="submit" class="btn btn-primario">Salvar parâmetros</button>
    </div>
  </form>`;
}

const LIMITES_PARAM = { contrato_gatilho_faturamento: [1, 500], contrato_gatilho_positivacao: [1, 500], contrato_limite_faixa: [1, 500] };
async function salvarParametros(form) {
  const v = k => $(`#cp-${k}`, form).value;
  const dados = { cod_farelo: v('cod_farelo').trim(), dia_corte: Number(v('dia_corte')), nomes_ignorados: v('nomes_ignorados').split('\n').map(nomeQlik).filter(Boolean) };
  const erros = {};
  if (!/^\d{1,10}$/.test(dados.cod_farelo)) erros['cp-cod_farelo'] = 'Só números, até 10.';
  if (!(Number.isInteger(dados.dia_corte) && dados.dia_corte >= 1 && dados.dia_corte <= 28)) erros['cp-dia_corte'] = 'De 1 a 28.';
  for (const k of Object.keys(comissoes.parametros()).filter(k => k.startsWith('pct_') || k.startsWith('contrato_'))) {
    const n = lerValor(v(k));
    const [min, max] = LIMITES_PARAM[k] || [0, 20];
    if (v(k).trim() === '' || !Number.isFinite(n) || n < min || n > max) erros[`cp-${k}`] = `De ${min} a ${max}.`;
    dados[k] = n;
  }
  if (Object.keys(erros).length) { aplicarErros(form, erros); return; }
  const botao = $('button[type="submit"]', form);
  botao.disabled = true; botao.setAttribute('aria-busy', 'true');
  try {
    await comissoes.salvarParametros(dados);
    s.resultado = null;   // outro corte ou outro Farelo: a apuração precisa de nova consulta
    s.ctx.toast('Parâmetros salvos.', { tom: 'sucesso' });
    desenhar();
  } catch (e) {
    s.ctx.toast(detalhar(e).mensagem, { tom: 'erro' });
    botao.disabled = false; botao.removeAttribute('aria-busy');
  }
}

// ---------- montagem ----------
async function trocarMes(mes) {
  const meu = s;
  s.mes = mesLembrado = mes; s.erroQlik = null;
  try {
    await comissoes.carregarMes(mes);
    if (s !== meu) return;
    s.resultado = await comissoes.apurar(mes, { buscar: false });
  } catch (e) { if (s === meu) s.ctx.toast(detalhar(e).mensagem, { tom: 'erro' }); }
  if (s === meu) { marcarEndereco(); desenhar(); }
}

async function carregar() {
  const meu = s;
  s.erro = null;
  try {
    await comissoes.carregar();
    if (s !== meu) return;
    s.mes = mesLembrado = s.mes || mesPadrao();
    marcarEndereco();
    await comissoes.carregarMes(s.mes);
    s.resultado = await comissoes.apurar(s.mes, { buscar: false });
    s.pronto = true;
  } catch (e) { if (s === meu) s.erro = detalhar(e).mensagem; }
  if (s === meu) desenhar();
}

const abaDe = params => (ABAS.some(a => a.valor === params?.query?.aba) ? params.query.aba : 'previa');
const mesDe = params => (MES_RE.test(params?.query?.mes || '') ? params.query.mes : null);
const rotaDe = (aba, mes) => `#/comissoes?aba=${aba}${mes ? `&mes=${mes}` : ''}`;
// Põe o mês no endereço sem criar entrada no histórico do navegador.
const marcarEndereco = () => { if (s?.mes) s.ctx.navegar(rotaDe(s.aba, s.mes), { substituir: true }); };

export function montar(el, ctx, params) {
  s = { el, ctx, aba: abaDe(params), pronto: false, erro: null, mes: mesDe(params) || mesLembrado, resultado: null, buscando: false, erroQlik: null, busca: '', inativos: false, gerando: null, lote: new Set(), desligar: [] };
  ctx.cabecalho({ titulo: 'Comissões' });
  const doCadastro = id => comissoes.cadastro().find(x => String(x.id) === String(id));
  s.desligar.push(
    ao(el, 'click', '[data-aba]', (e, b) => ctx.navegar(rotaDe(b.dataset.aba, s.mes), { substituir: true })),
    ao(el, 'click', '#cm-tentar', () => { s.erro = null; desenhar(); carregar(); }),
    ao(el, 'click', '#cm-buscar', buscar),
    ao(el, 'change', '#cm-mes', (e, sel) => { if (sel.value) trocarMes(sel.value); }),
    ao(el, 'click', '[data-ignorar]', (e, b) => ignorarNome(b.dataset.ignorar)),
    ao(el, 'click', '[data-completar]', (e, b) => editar(null, b.dataset.completar)),
    ao(el, 'change', '[data-lote]', marcarLote),
    ao(el, 'change', '#cm-lote-todos', (e, t) => { $$('[data-lote]', el).forEach(c => { c.checked = t.checked; }); marcarLote(); }),
    ao(el, 'click', '#cm-lote-ok', () => s.resultado && aplicarLote()),
    ao(el, 'click', '#cm-excel', () => s.resultado && baixarExcel()),
    ao(el, 'click', '#cm-recibos', () => s.resultado && baixarRecibos()),
    ao(el, 'click', '[data-recibo]', (e, b) => s.resultado && baixarRecibos(b.dataset.recibo)),
    ao(el, 'click', '#cm-adp', () => s.resultado && dialogoAdp()),
    ao(el, 'submit', '#cm-form-premio', (e, f) => { e.preventDefault(); lancar(f, 'premio'); }),
    ao(el, 'submit', '#cm-form-ajuste', (e, f) => { e.preventDefault(); lancar(f, 'ajuste'); }),
    ao(el, 'click', '[data-remover]', (e, b) => remover(b.dataset.remover)),
    ao(el, 'click', '#cm-fechar', () => s.resultado && fecharMes()),
    ao(el, 'click', '#cm-reabrir', reabrirMes),
    ao(el, 'click', '[data-abrir-mes]', async (e, b) => { s.aba = 'previa'; await trocarMes(b.dataset.abrirMes); }),
    ao(el, 'click', '[data-contrato]', (e, b) => { const c = doCadastro(b.dataset.contrato); if (c) editarContrato(c); }),
    ao(el, 'click', '[data-editar]', (e, b) => { const c = doCadastro(b.dataset.editar); if (c) editar(c); }),
    ao(el, 'change', '#cm-inativos', (e, i) => { s.inativos = i.checked; desenhar(); }),
    // A busca redesenha só a lista: o campo não perde o foco nem o cursor.
    ao(el, 'input', '#cm-busca', (e, i) => {
      s.busca = i.value;
      const alvo = $('#cm-lista', el);
      if (alvo) pintar(alvo, listaCadastro());
    }),
    ao(el, 'submit', '#cm-form-param', (e, f) => { e.preventDefault(); salvarParametros(f); }),
    ligarBusca(el),
    ligarMascaras(el),
  );
  desenhar();
  if (ctx.ehAprovador) carregar();
  const meu = s;
  return () => { meu.desligar.forEach(fn => fn && fn()); if (s === meu) s = null; };
}

export function atualizar(params) {
  if (!s) return;
  s.aba = abaDe(params);
  const mes = mesDe(params);
  if (mes && mes !== s.mes) {
    if (s.pronto) { trocarMes(mes); return; }
    s.mes = mesLembrado = mes;
  }
  desenhar();
}
