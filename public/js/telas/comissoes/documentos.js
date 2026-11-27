// Comissões → documentos do mês: Excel, recibos e ADP dos PJ; fechar e reabrir o mês (histórico).
// O que vai em cada documento é de lib/comissoes-documentos.js; quem desenha, comissoes-excel.js e comissoes-pdf.js.
import { html, pintar, $, ao } from '../../lib/dom.js';
import { lerValor, valorCampo } from '../../lib/regras.js';
import { rotuloMesComissao } from '../../lib/comissoes.js';
import { recibosDoMes, linhasAdpPj, totalLinhas, NF_RE } from '../../lib/comissoes-documentos.js';
import { comissoes } from '../../dados/comissoes.js';
import { detalhar } from '../../dados/erros.js';
import { vencimentoPadrao, DIAS_UTEIS_VENCIMENTO } from '../../adp.js';
import { icone } from '../../ui/icones.js';
import { abrirDialogo, erroNoDialogo, confirmar } from '../../ui/avisos.js';
import { campo, areaTexto, aplicarErros, ligarMascaras } from '../../ui/campos.js';
import { s, r$, mesMinusculo, redesenhar, recalcular, ocupar } from './comum.js';

const NF = ['número da NF', 'valor da NF'];

// rotulo pode ser [antes, essencial, depois]: no celular só a parte essencial aparece (e é o nome do botão ali).
function botao(id, ic, rotulo, ocupado, tipo = 'btn-fantasma') {
  const [antes, meio, depois] = Array.isArray(rotulo) ? rotulo : ['', rotulo, ''];
  const texto = html`${antes ? html`<span class="cm-so-largo">${antes}</span>` : ''}${meio}${depois ? html`<span class="cm-so-largo">${depois}</span>` : ''}`;
  // O texto num <span> só: o .btn é flex com gap, e cada pedaço solto virava um item (espaço dobrado).
  return html`<button type="button" class="btn ${tipo}" id="${id}"${s.gerando ? html` disabled` : ''}${ocupado ? html` aria-busy="true"` : ''}>${icone(ic)}<span>${texto}${ocupado ? '…' : ''}</span></button>`;
}

// Na Apuração, os documentos ficam no fim, junto de "Fechar mês" (ou sozinhos, com Reabrir, no mês fechado).
export function documentosHtml(r) {
  const g = s.gerando;
  return html`<div class="acoes cm-documentos" role="group" aria-label="Documentos do mês">
      ${botao('cm-excel', 'baixar', ['Baixar ', 'Excel', ''], g === 'excel')}
      ${botao('cm-recibos', 'baixar', ['', 'Recibos', ' dos PJ'], g === 'recibos')}
      ${botao('cm-adp', 'moeda', ['Gerar ', 'ADP', ' dos PJ'], g === 'adp')}
      ${r.fechado ? botao('cm-reabrir', 'cadeado', 'Reabrir mês', g === 'reabrir') : ''}
    </div>`;
}

// O que conferir antes de fechar o mês. Cada item: { ok, texto } (o texto já diz o que falta).
export function antesDeFechar(r) {
  const pjs = linhasAdpPj(r, comissoes.contextoDocumentos(r.mes).cadastro);
  const semNf = pjs.filter(l => !l.nf || l.nf_valor == null).map(l => l.nome);
  const semCadastro = pjs.filter(l => l.falta.some(x => !NF.includes(x))).map(l => l.nome);
  const n = r.semCadastro.length;
  const nd = new Set((r.desativados || []).map(x => x.id)).size;
  const orfaos = r.lancamentosOrfaos || [];
  return [
    { ok: !n, texto: n ? `${n} ${n === 1 ? 'vendedor' : 'vendedores'} em Novos no Qlik, fora da comissão` : 'Ninguém em Novos no Qlik' },
    ...(nd ? [{ ok: false, texto: `${nd} ${nd === 1 ? 'desativado' : 'desativados'} com venda no Qlik, fora da comissão` }] : []),
    ...(orfaos.length ? [{ ok: false, texto: `Premiação ou ajuste de quem está desativado: ${orfaos.map(o => `${o.nome} (${r$(o.valor)})`).join(', ')}` }] : []),
    { ok: !semCadastro.length, texto: semCadastro.length ? `Cadastro do PJ incompleto: ${semCadastro.join(', ')}` : 'Cadastro dos PJ completo para o recibo e a ADP' },
    { ok: !semNf.length, texto: !pjs.length ? 'Nenhum PJ a pagar neste mês' : semNf.length ? `ADP dos PJ sem a NF de ${semNf.join(', ')}` : 'ADP dos PJ gerada, com a NF de todos' },
  ];
}

// "Fechar mês" fica sozinho no fim da apuração, longe dos documentos, e só chama atenção quando nada falta.
export function faixaFechar(r) {
  const itens = antesDeFechar(r);
  const pronto = itens.every(i => i.ok);
  return html`<section class="painel cm-fechar${pronto ? ' cm-fechar-pronto' : ''}" aria-labelledby="cm-t-fechar">
    <h2 class="painel-titulo" id="cm-t-fechar">Fechar ${mesMinusculo(r.mes)}</h2>
    <div class="painel-corpo">
      <p class="campo-dica">Grava a cópia do que foi pago no histórico e trava premiações, ajustes, contrato e NF. Dá para reabrir, com motivo.</p>
      <ul class="cm-conferir">${itens.map(i => html`<li class="${i.ok ? 'ok' : 'falta'}">${icone(i.ok ? 'check' : 'alerta')}<span>${i.texto}<span class="so-leitor">${i.ok ? ' (pronto)' : ' (falta)'}</span></span></li>`)}</ul>
      ${documentosHtml(r)}
      <div class="acoes acoes-fim">${botao('cm-fechar', 'cadeado', pronto ? 'Fechar mês' : 'Fechar mês assim mesmo', s.gerando === 'fechar', pronto ? 'btn-primario' : 'btn-fantasma')}</div>
    </div>
  </section>`;
}

function baixarExcel() {
  return ocupar('excel', async () => {
    const r = s.resultado;
    let base = null, aviso = '';
    if (!comissoes.fechado(r.mes)) {
      try { base = (await comissoes.buscarBase(r.mes)).linhas; }
      catch (e) { aviso = `A aba da base do Qlik ficou de fora (${detalhar(e).mensagem}). As vendas foram como valor.`; }
    }
    const { baixarExcelComissoes } = await import('../../comissoes-excel.js');
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
    const { gerarRecibos } = await import('../../comissoes-pdf.js');
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
  const doCadastro = l => l.falta.filter(f => !NF.includes(f));
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
        const { gerarAdpPj } = await import('../../comissoes-pdf.js');
        const x = await gerarAdpPj(marcadas, { mes: r.mes, vencimento: venc });
        s.ctx.toast(`ADP gerada: ${x.quantidade} ${x.quantidade === 1 ? 'nota' : 'notas'}, ${r$(x.total)}.`, { tom: 'sucesso' });
        return true;
      } catch (e) { erroNoDialogo(d, detalhar(e).mensagem); return false; }
    },
  });
  if (s && !travado) { await recalcular(); redesenhar(); }
}

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
  redesenhar();
}

export function ligar(el) {
  return [
    ao(el, 'click', '#cm-excel', () => s.resultado && baixarExcel()),
    ao(el, 'click', '#cm-recibos', () => s.resultado && baixarRecibos()),
    ao(el, 'click', '[data-recibo]', (e, b) => s.resultado && baixarRecibos(b.dataset.recibo)),
    ao(el, 'click', '#cm-adp', () => s.resultado && dialogoAdp()),
    ao(el, 'click', '#cm-fechar', () => s.resultado && fecharMes()),
    ao(el, 'click', '#cm-reabrir', reabrirMes),
  ];
}
