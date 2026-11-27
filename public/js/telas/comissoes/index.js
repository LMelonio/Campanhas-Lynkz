// Comissões (#/comissoes, só administrador). Casca: abas, mês e estado; cada aba é um arquivo desta pasta.
//   ?aba=apuracao     apuracao.js   vendas do mês no Qlik, cálculo de cada pessoa e Novos no Qlik
//                     documentos.js Excel, recibos e ADP dos PJ; fechar e reabrir o mês
//   ?aba=premiacoes   lancamentos.js premiações de campanha e ajustes (com motivo) do mês
//   ?aba=contrato     contrato.js   Contrato de Resultado dos PJ: metas do mês anterior e realizado
//   ?aba=cadastro     cadastro.js   comissionados: as pessoas vêm do Qlik; aqui só se completa regime, %, acordo e dados da PJ
//   ?aba=parametros   parametros.js código do Farelo, dia de corte, % padrão, Contrato de Resultado, nomes que não comissionam
//   ?aba=historico    historico.js  meses fechados (cópia do que foi pago)
//   &mes=AAAA-MM      mês das abas do mês (Apuração, Premiações e Contrato)
//   ?aba=previa é o nome antigo da Apuração: links antigos continuam abrindo.
// Cada aba exporta desenhar() (o HTML) e ligar(el) (os eventos); o estado `s` fica em comum.js.
// A tela só organiza: banco, Qlik e cálculo ficam em dados/comissoes.js e lib/comissoes.js;
// o que vai no recibo, na ADP e no Excel, em lib/comissoes-documentos.js.
import { html, pintar, ao } from '../../lib/dom.js';
import { dataBR, hojeCivil } from '../../lib/regras.js';
import { periodoApuracao, mesAnteriorFechado, somaMes, rotuloMesComissao } from '../../lib/comissoes.js';
import { comissoes } from '../../dados/comissoes.js';
import { detalhar } from '../../dados/erros.js';
import { icone } from '../../ui/icones.js';
import { vazio, carregando } from '../../ui/pecas.js';
import { selecao, ligarMascaras, ligarBusca } from '../../ui/campos.js';
import { s, iniciar, encerrar, mesMinusculo, fechado } from './comum.js';
import * as apuracao from './apuracao.js';
import * as documentos from './documentos.js';
import * as lancamentos from './lancamentos.js';
import * as contrato from './contrato.js';
import * as cadastro from './cadastro.js';
import * as parametros from './parametros.js';
import * as historico from './historico.js';

const ABAS = [
  { valor: 'apuracao', rotulo: 'Apuração', tela: apuracao },
  { valor: 'premiacoes', rotulo: 'Premiações', tela: lancamentos },
  { valor: 'contrato', rotulo: 'Contrato PJ', tela: contrato },
  { valor: 'cadastro', rotulo: 'Cadastro', tela: cadastro },
  { valor: 'parametros', rotulo: 'Parâmetros', tela: parametros },
  { valor: 'historico', rotulo: 'Histórico', tela: historico },
];
const ABAS_DO_MES = ['apuracao', 'premiacoes', 'contrato'];
const APELIDOS = { previa: 'apuracao' };

// O mês vai no endereço (#/comissoes?aba=previa&mes=2026-10) e fica lembrado aqui:
// quem sai pelo menu e volta continua no mesmo mês, com a consulta ao Qlik que está na memória.
let mesLembrado = null;
const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Mês sugerido: o da apuração que fecha hoje ou já fechou.
function mesPadrao() {
  const hoje = hojeCivil();
  const mes = hoje.slice(0, 7);
  return Number(hoje.slice(8, 10)) >= comissoes.parametros().dia_corte ? mes : somaMes(mes, -1);
}

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
  const aba = ABAS.find(a => a.valor === s.aba) || ABAS[0];
  pintar(el, html`<div class="comissoes">
    <div class="filtros cm-abas" role="group" aria-label="Seções das comissões">
      ${ABAS.map(a => html`<button type="button" class="filtro" data-aba="${a.valor}" aria-pressed="${s.aba === a.valor}">${a.rotulo}</button>`)}
    </div>
    <div id="cm-conteudo">${ABAS_DO_MES.includes(s.aba) ? seletorMes() : ''}${aba.tela.desenhar()}</div>
  </div>`);
}

function seletorMes() {
  const p = comissoes.parametros();
  const ap = periodoApuracao(s.mes, p.dia_corte);
  const ct = mesAnteriorFechado(s.mes);
  const meses = [0, -1, -2, -3, -4, -5].map(n => somaMes(mesPadrao(), n));
  if (!meses.includes(s.mes)) meses.unshift(s.mes);
  const r = s.resultado;
  // Buscar no Qlik e o período ficam só na Apuração; Premiações e Contrato só trocam o mês.
  const naApuracao = s.aba === 'apuracao';
  return html`<div class="cm-cabeca"><div class="cm-consulta">
      ${selecao({ id: 'cm-mes', rotulo: 'Mês da apuração', opcoes: meses.map(m => ({ valor: m, rotulo: rotuloMesComissao(m) })), valor: s.mes, vazio: 'Escolha o mês' })}
      ${fechado() || !naApuracao ? '' : html`<button type="button" class="btn ${r ? 'btn-fantasma' : 'btn-primario'}" id="cm-buscar"${s.buscando ? html` aria-busy="true" disabled` : ''}>${icone('repetir')} ${s.buscando ? 'Buscando no Qlik…' : r ? 'Atualizar do Qlik' : 'Buscar vendas no Qlik'}</button>`}
    </div>
    ${naApuracao ? html`<p class="secao-nota cm-periodo">Vendas de ${dataBR(ap.inicio)} a ${dataBR(ap.fim)}<span class="cm-so-largo">, receita menos devolução, atacado regular</span>. Farelo é o fornecedor ${p.cod_farelo}.
      O Contrato de Resultado olha ${mesMinusculo(ct.mes)} inteiro.</p>` : ''}</div>`;
}

const abaDe = params => {
  const aba = APELIDOS[params?.query?.aba] || params?.query?.aba;
  return ABAS.some(a => a.valor === aba) ? aba : 'apuracao';
};
const mesDe = params => (MES_RE.test(params?.query?.mes || '') ? params.query.mes : null);
const rotaDe = (aba, mes) => `#/comissoes?aba=${aba}${mes ? `&mes=${mes}` : ''}`;
// Põe o mês no endereço sem criar entrada no histórico do navegador.
const marcarEndereco = () => { if (s?.mes) s.ctx.navegar(rotaDe(s.aba, s.mes), { substituir: true }); };

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

export function montar(el, ctx, params) {
  const meu = iniciar({
    el, ctx, aba: abaDe(params), pronto: false, erro: null, mes: mesDe(params) || mesLembrado, resultado: null,
    buscando: false, erroQlik: null, busca: '', inativos: false, gerando: null, lote: new Set(), historico: null,
    desligar: [], pintar: desenhar, trocarMes,
  });
  ctx.cabecalho({ titulo: 'Comissões' });
  meu.desligar.push(
    ao(el, 'click', '[data-aba]', (e, b) => ctx.navegar(rotaDe(b.dataset.aba, s.mes), { substituir: true })),
    ao(el, 'click', '#cm-tentar', () => { s.erro = null; desenhar(); carregar(); }),
    ao(el, 'change', '#cm-mes', (e, sel) => { if (sel.value) trocarMes(sel.value); }),
    ...ABAS.flatMap(a => a.tela.ligar(el)),
    ...documentos.ligar(el),
    ligarBusca(el),
    ligarMascaras(el),
  );
  desenhar();
  if (ctx.ehAprovador) carregar();
  return () => { meu.desligar.forEach(fn => fn && fn()); encerrar(meu); };
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
