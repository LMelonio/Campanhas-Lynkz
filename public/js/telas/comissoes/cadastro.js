// Comissões → Cadastro: as pessoas vêm do Qlik; aqui só se completa regime, %, acordo e dados da PJ.
// editar() também atende "Completar cadastro" de quem está em Novos no Qlik (apuracao.js).
import { html, pintar, $, $$, ao } from '../../lib/dom.js';
import { dataBR, lerValor, valorCampo, contem } from '../../lib/regras.js';
import { REGIMES, ROTULO_REGIME, ehPJ, pctPadrao, errosComissionado, novoDoQlik } from '../../lib/comissoes.js';
import { pendenciasPj } from '../../lib/comissoes-documentos.js';
import { comissoes } from '../../dados/comissoes.js';
import { detalhar } from '../../dados/erros.js';
import { icone } from '../../ui/icones.js';
import { vazio, seloNeutro } from '../../ui/pecas.js';
import { abrirDialogo, erroNoDialogo } from '../../ui/avisos.js';
import { campo, selecao, interruptor, aplicarErros, ligarMascaras, campoBusca } from '../../ui/campos.js';
import { s, r$, pctTxt, valorPct, sufixo, redesenhar, recalcular } from './comum.js';

export function desenhar() {
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

// c: cadastro existente, ou null para completar quem chegou do Qlik (nomeDoQlik obrigatório).
export async function editar(c, nomeDoQlik = null) {
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
  redesenhar();
  s.ctx.toast(novo ? `${salvo.nome} entrou na comissão.` : 'Cadastro salvo.', { tom: 'sucesso' });
}

export function ligar(el) {
  const doCadastro = id => comissoes.cadastro().find(x => String(x.id) === String(id));
  return [
    ao(el, 'click', '[data-editar]', (e, b) => { const c = doCadastro(b.dataset.editar); if (c) editar(c); }),
    ao(el, 'change', '#cm-inativos', (e, i) => { s.inativos = i.checked; redesenhar(); }),
    // A busca redesenha só a lista: o campo não perde o foco nem o cursor.
    ao(el, 'input', '#cm-busca', (e, i) => {
      s.busca = i.value;
      const alvo = $('#cm-lista', el);
      if (alvo) pintar(alvo, listaCadastro());
    }),
  ];
}
