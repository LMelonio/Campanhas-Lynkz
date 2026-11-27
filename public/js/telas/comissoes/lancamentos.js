// Comissões → Premiações: premiações de campanha e ajustes (com motivo) do mês, CLT e PJ.
// Os dois são lançamentos do mês por pessoa: premiação (valor positivo, campanha) e ajuste (+/−, motivo).
// No celular (até 600 px) a lista vem primeiro e o formulário abre num diálogo ("Lançar premiação / ajuste").
import { html, $, ao } from '../../lib/dom.js';
import { lerValor } from '../../lib/regras.js';
import { ROTULO_REGIME } from '../../lib/comissoes.js';
import { comissoes } from '../../dados/comissoes.js';
import { detalhar } from '../../dados/erros.js';
import { icone } from '../../ui/icones.js';
import { vazio } from '../../ui/pecas.js';
import { confirmar, abrirDialogo, erroNoDialogo } from '../../ui/avisos.js';
import { campo, selecao, aplicarErros, ligarMascaras } from '../../ui/campos.js';
import { s, r$, mesMinusculo, ativos, fechado, avisoFechado, redesenhar, recalcular } from './comum.js';
import { editar as completarCadastro } from './cadastro.js';

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

const CELULAR = '(max-width: 600px)';
const noCelular = () => window.matchMedia(CELULAR).matches;
// Quem pode receber: os cadastrados ativos e, da consulta do mês, quem vendeu e ainda não tem cadastro
// (valor "qlik:NOME": ao lançar, completa o cadastro antes). Ficam de fora quem não comissiona e os desativados.
const PREFIXO_QLIK = 'qlik:';
const resultadoDoMes = () => (s.resultado && s.resultado.mes === s.mes ? s.resultado : null);
function pessoasDoMes() {
  const cadastrados = ativos().map(c => ({ valor: c.id, rotulo: `${c.nome} (${ROTULO_REGIME[c.regime]})`, grupo: 'Cadastrados' }));
  const semCadastro = (resultadoDoMes()?.semCadastro || []).map(x => ({ valor: PREFIXO_QLIK + x.vendedor, rotulo: `${x.vendedor} (sem cadastro)`, grupo: 'Sem cadastro' }));
  return semCadastro.length ? [...cadastrados, ...semCadastro] : cadastrados.map(({ grupo, ...o }) => o);
}

const camposPremio = (pessoas, pre = {}) => html`
  ${selecao({ id: 'pr-pessoa', rotulo: 'Quem recebe', opcoes: pessoas, valor: pre.pessoa, vazio: 'Escolha a pessoa', obrigatorio: true })}
  ${campo({ id: 'pr-desc', rotulo: 'Campanha', valor: pre.texto, obrigatorio: true, atributos: { maxlength: 120, autocomplete: 'off' } })}
  ${campo({ id: 'pr-valor', rotulo: 'Valor', valor: pre.valorTexto, obrigatorio: true, mascara: 'valor' })}`;
const camposAjuste = (pessoas, pre = {}) => html`
  ${selecao({ id: 'aj-pessoa', rotulo: 'Quem recebe', opcoes: pessoas, valor: pre.pessoa, vazio: 'Escolha a pessoa', obrigatorio: true })}
  ${campo({ id: 'aj-motivo', rotulo: 'Motivo', valor: pre.texto, obrigatorio: true, dica: 'Entra depois do acordo mínimo e aparece no recibo.', atributos: { maxlength: 200, autocomplete: 'off' } })}
  <div class="cm-duas">
    ${selecao({ id: 'aj-tipo', rotulo: 'Tipo', obrigatorio: true, valor: pre.acrescimo ? 'acrescimo' : 'desconto', vazio: 'Escolha', opcoes: [{ valor: 'desconto', rotulo: 'Desconto (−)' }, { valor: 'acrescimo', rotulo: 'Acréscimo (+)' }] })}
    ${campo({ id: 'aj-valor', rotulo: 'Valor', valor: pre.valorTexto, obrigatorio: true, mascara: 'valor' })}
  </div>`;
const semConsulta = () => (!resultadoDoMes() && !fechado()
  ? html`<p class="nota">${icone('info')}<span>Busque as vendas na Apuração para ver quem vendeu no mês.</span></p>` : '');

export function desenhar() {
  const travado = fechado();
  const premios = comissoes.premiacoes(s.mes);
  const ajustes = comissoes.ajustes(s.mes);
  const celular = noCelular();
  const pessoas = pessoasDoMes();
  const listas = html`${premios.length ? tabelaLancamentos('premio', premios, travado)
      : vazio({ icone: 'moeda', titulo: `Nenhuma premiação em ${mesMinusculo(s.mes)}`, texto: 'Lance uma premiação: ela entra no valor a pagar, no recibo e no Excel.' })}
    ${ajustes.length ? tabelaLancamentos('ajuste', ajustes, travado) : ''}`;
  if (travado) return html`${avisoFechado()}${listas}`;
  if (celular) return html`${semConsulta()}${listas}<button type="button" class="btn btn-primario btn-largo" id="cm-lancar">${icone('mais')} Lançar premiação / ajuste</button>`;
  return html`${semConsulta()}<div class="cm-lancar">
      <form class="painel cm-premiar" id="cm-form-premio" novalidate aria-labelledby="cm-t-premio">
        <h2 class="painel-titulo" id="cm-t-premio">Lançar premiação de ${mesMinusculo(s.mes)}</h2>
        <div class="painel-corpo">
          ${camposPremio(pessoas)}
          <div class="acoes acoes-fim"><button type="submit" class="btn btn-primario">${icone('mais')} Lançar premiação</button></div>
        </div>
      </form>
      <form class="painel cm-premiar" id="cm-form-ajuste" novalidate aria-labelledby="cm-t-ajuste">
        <h2 class="painel-titulo" id="cm-t-ajuste">Lançar ajuste</h2>
        <div class="painel-corpo">
          ${camposAjuste(pessoas)}
          <div class="acoes acoes-fim"><button type="submit" class="btn btn-fantasma">${icone('mais')} Lançar ajuste</button></div>
        </div>
      </form>
    </div>
    ${listas}`;
}

// Lê e confere os campos de um lançamento dentro de `raiz` (o formulário da tela ou o diálogo).
function lerLancamento(raiz, tipo) {
  const v = k => $(`#${k}`, raiz).value;
  const premio = tipo === 'premio';
  const p = premio ? 'pr' : 'aj';
  const texto = v(premio ? 'pr-desc' : 'aj-motivo').trim().replace(/\s+/g, ' ');
  const valor = lerValor(v(`${p}-valor`));
  const erros = {};
  if (!v(`${p}-pessoa`)) erros[`${p}-pessoa`] = 'Escolha quem recebe.';
  if (texto.length < (premio ? 2 : 3)) erros[premio ? 'pr-desc' : 'aj-motivo'] = premio ? 'Informe a campanha.' : 'Escreva o motivo (3 letras ou mais).';
  if (!(valor >= 0.01 && valor <= 1000000)) erros[`${p}-valor`] = 'Valor de R$ 0,01 a R$ 1.000.000,00.';
  return { erros, tipo, comissionado_id: v(`${p}-pessoa`), texto, valor, valorTexto: v(`${p}-valor`), acrescimo: !premio && v('aj-tipo') === 'acrescimo' };
}

// Quem vendeu sem cadastro: completa o cadastro (o diálogo do Cadastro) e devolve o id novo.
// Fechou sem salvar: null, e o aviso diz que nada foi lançado.
async function garantirCadastro(x) {
  if (!String(x.comissionado_id).startsWith(PREFIXO_QLIK)) return x.comissionado_id;
  const nome = String(x.comissionado_id).slice(PREFIXO_QLIK.length);
  const novo = await completarCadastro(null, nome);
  if (!novo) {
    s?.ctx.toast(`${x.tipo === 'premio' ? 'Premiação não lançada' : 'Ajuste não lançado'}: falta o cadastro de ${nome}.`, { tom: 'erro', duracao: 7000 });
    return null;
  }
  return novo.id;
}

const aPagarDe = id => resultadoDoMes()?.linhas.find(l => String(l.id) === String(id))?.valor_pagar;

async function gravarLancamento({ tipo, comissionado_id, texto, valor, acrescimo }) {
  const c = comissoes.cadastro().find(x => String(x.id) === String(comissionado_id));
  const antes = aPagarDe(comissionado_id);
  if (tipo === 'premio') await comissoes.lancarPremiacao({ mes: s.mes, comissionado_id, descricao: texto, valor });
  else await comissoes.lancarAjuste({ mes: s.mes, comissionado_id, motivo: texto, valor: acrescimo ? valor : -valor });
  await recalcular();
  // O efeito no valor a pagar, com o resultado recalculado antes e depois.
  const depois = aPagarDe(comissionado_id);
  const efeito = antes != null && depois != null ? ` A pagar de ${c?.nome || ''}: ${r$(antes)} → ${r$(depois)}.` : '';
  s.ctx.toast(tipo === 'premio' ? `Premiação lançada.${efeito || ` ${r$(valor)} para ${c?.nome || ''}.`}`
    : `Ajuste lançado.${efeito || ` ${acrescimo ? '+' : '−'}${r$(valor)} para ${c?.nome || ''}.`}`, { tom: 'sucesso', duracao: 6000 });
}

async function lancar(form, tipo) {
  const x = lerLancamento(form, tipo);
  if (Object.keys(x.erros).length) { aplicarErros(form, x.erros); return; }
  const botao = $('button[type="submit"]', form);
  botao.disabled = true; botao.setAttribute('aria-busy', 'true');
  const liberar = () => { if (botao.isConnected) { botao.disabled = false; botao.removeAttribute('aria-busy'); } };
  try {
    const id = await garantirCadastro(x);
    if (id == null) { liberar(); return; }   // o formulário continua preenchido
    await gravarLancamento({ ...x, comissionado_id: id });
    redesenhar();
    $(`#${tipo === 'premio' ? 'pr' : 'aj'}-pessoa`, s.el)?.focus();
  } catch (e) {
    s.ctx.toast(detalhar(e).mensagem, { tom: 'erro' });
    liberar();
  }
}

// Celular: um diálogo só, com a escolha entre premiação e ajuste. pre: os valores de antes (reabrir preenchido).
// Quem não tem cadastro: o diálogo fecha, abre o do cadastro e, se ele for cancelado, este volta preenchido.
async function dialogoLancar(pre = null) {
  const pessoas = pessoasDoMes();
  const tipoIni = pre?.tipo || 'premio';
  let pendente = null;
  const v = await abrirDialogo({
    titulo: `Lançar em ${mesMinusculo(s.mes)}`,
    corpo: html`${selecao({ id: 'lc-tipo', rotulo: 'O que lançar', obrigatorio: true, valor: tipoIni, opcoes: [{ valor: 'premio', rotulo: 'Premiação de campanha' }, { valor: 'ajuste', rotulo: 'Ajuste (acréscimo ou desconto)' }] })}
      <div data-lc="premio"${tipoIni === 'premio' ? '' : html` hidden`}>${camposPremio(pessoas, tipoIni === 'premio' && pre ? { ...pre, pessoa: pre.comissionado_id } : {})}</div>
      <div data-lc="ajuste"${tipoIni === 'ajuste' ? '' : html` hidden`}>${camposAjuste(pessoas, tipoIni === 'ajuste' && pre ? { ...pre, pessoa: pre.comissionado_id } : {})}</div>`,
    acoes: [{ rotulo: 'Cancelar', valor: null, tipo: 'fantasma' }, { rotulo: 'Lançar', valor: 'lancar', tipo: 'primario', principal: true }],
    aoAbrir: d => {
      const desligar = ligarMascaras(d);
      d.addEventListener('change', e => {
        if (e.target.id !== 'lc-tipo') return;
        for (const g of d.querySelectorAll('[data-lc]')) g.hidden = g.dataset.lc !== e.target.value;
      });
      d.addEventListener('close', desligar, { once: true });
    },
    antesDeFechar: async (_v, d) => {
      erroNoDialogo(d, '');
      const x = lerLancamento(d, $('#lc-tipo', d).value);
      if (Object.keys(x.erros).length) { aplicarErros(d, x.erros); return false; }
      if (String(x.comissionado_id).startsWith(PREFIXO_QLIK)) { pendente = x; return true; }
      try { await gravarLancamento(x); return true; }
      catch (e) { erroNoDialogo(d, detalhar(e).mensagem); return false; }
    },
  });
  if (pendente && s) {
    const id = await garantirCadastro(pendente);
    if (id == null) { if (s) await dialogoLancar(pendente); return; }
    try { await gravarLancamento({ ...pendente, comissionado_id: id }); }
    catch (e) { s.ctx.toast(detalhar(e).mensagem, { tom: 'erro' }); }
  }
  if ((v === 'lancar' || pendente) && s) redesenhar();
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
    redesenhar();
  } catch (e) { s.ctx.toast(detalhar(e).mensagem, { tom: 'erro' }); }
}

// Passou de celular para computador (ou o contrário) com Premiações aberta: troca o diálogo pelo formulário.
function ouvirTela() {
  const mq = window.matchMedia(CELULAR);
  const mudou = () => { if (s?.aba === 'premiacoes' && !document.querySelector('dialog[open]')) redesenhar(); };
  mq.addEventListener('change', mudou);
  return () => mq.removeEventListener('change', mudou);
}

export function ligar(el) {
  return [
    ao(el, 'submit', '#cm-form-premio', (e, f) => { e.preventDefault(); lancar(f, 'premio'); }),
    ao(el, 'submit', '#cm-form-ajuste', (e, f) => { e.preventDefault(); lancar(f, 'ajuste'); }),
    ao(el, 'click', '[data-remover]', (e, b) => remover(b.dataset.remover)),
    ao(el, 'click', '#cm-lancar', dialogoLancar),
    ouvirTela(),
  ];
}
