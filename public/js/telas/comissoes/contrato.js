// Comissões → Contrato PJ: metas do mês anterior e realizado (do Qlik ou informado à mão, com motivo).
import { html, $, ao } from '../../lib/dom.js';
import { lerValor, valorCampo } from '../../lib/regras.js';
import { ehPJ, mesAnteriorFechado, entradaContrato, avaliarContrato } from '../../lib/comissoes.js';
import { comissoes } from '../../dados/comissoes.js';
import { detalhar } from '../../dados/erros.js';
import { icone } from '../../ui/icones.js';
import { vazio } from '../../ui/pecas.js';
import { abrirDialogo, erroNoDialogo } from '../../ui/avisos.js';
import { campo, areaTexto, aplicarErros, ligarMascaras } from '../../ui/campos.js';
import { s, r$, pctTxt, pct1, mesMinusculo, ativos, fechado, avisoFechado, redesenhar, recalcular } from './comum.js';

function contratoDe(c) {
  const linha = s.resultado?.linhas.find(l => l.id === c.id);
  if (linha?.contrato) return linha.contrato;
  const e = entradaContrato(c, comissoes.mesPj(s.mes, c.id), null);
  return { ...avaliarContrato(e, comissoes.parametros()), meta_origem: e.meta_origem, informado: e.informado, semQlik: !e.informado };
}

export function desenhar() {
  const ct = mesAnteriorFechado(s.mes);
  const travado = fechado();
  const pjs = travado ? (s.resultado?.linhas || []).filter(ehPJ) : ativos().filter(ehPJ);
  const origem = c => (c.meta_origem === 'cadastro' ? html`<small class="cm-sub">Meta do cadastro</small>`
    : c.meta_origem === 'misto' ? html`<small class="cm-sub">Parte da meta vem do cadastro</small>` : '');
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
  redesenhar();
  s.ctx.toast(`Contrato de ${c.nome} salvo.`, { tom: 'sucesso' });
}

export function ligar(el) {
  return [
    ao(el, 'click', '[data-contrato]', (e, b) => {
      const c = comissoes.cadastro().find(x => String(x.id) === String(b.dataset.contrato));
      if (c) editarContrato(c);
    }),
  ];
}
