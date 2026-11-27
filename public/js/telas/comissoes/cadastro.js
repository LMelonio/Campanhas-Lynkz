// Comissões → Cadastro: todos os vendedores do Qlik em cinco grupos (CLT, PJ, Sem cadastro no Qlik da última
// consulta, Não comissionam e Desativados). Aqui se completa regime, %, acordo e dados da PJ.
// editar() também atende "Completar cadastro" da Apuração e das Premiações. "Completar cadastro", "Não comissiona"
// e "Voltar a comissionar" deste grupo usam os mesmos ouvintes da Apuração (apuracao.js → ligar).
import { html, pintar, $, $$, ao } from '../../lib/dom.js';
import { dataBR, lerValor, valorCampo, contem } from '../../lib/regras.js';
import { REGIMES, ROTULO_REGIME, ehPJ, pctPadrao, errosComissionado, novoDoQlik } from '../../lib/comissoes.js';
import { pendenciasPj, errosPj } from '../../lib/comissoes-documentos.js';
import { comissoes } from '../../dados/comissoes.js';
import { detalhar } from '../../dados/erros.js';
import { icone } from '../../ui/icones.js';
import { vazio, seloNeutro } from '../../ui/pecas.js';
import { abrirDialogo, erroNoDialogo } from '../../ui/avisos.js';
import { campo, selecao, interruptor, aplicarErros, ligarMascaras, campoBusca } from '../../ui/campos.js';
import { s, r$, pctTxt, valorPct, sufixo, redesenhar, recalcular } from './comum.js';

export function desenhar() {
  const nInativos = comissoes.cadastro().filter(c => c.ativo === false).length;
  // A última consulta gravada é lida uma vez, ao abrir; depois a tela redesenha com os "Sem cadastro".
  if (s.ultimaLida !== true) {
    s.ultimaLida = true;
    const meu = s;
    comissoes.ultimaConsulta().then(() => { if (s === meu && s.aba === 'cadastro') redesenhar(); }).catch(() => {});
  }
  const ultima = comissoes.semCadastroDaUltima();
  const nota = ultima
    ? `Todos os vendedores do Qlik da última consulta (${mesPorExtenso(ultima.mes)}). Busque um mês na Apuração para atualizar.`
    : 'Busque um mês na Apuração para ver aqui todos os vendedores do Qlik.';
  return html`
    <div class="cm-cad-topo">
      ${campoBusca({ id: 'cm-busca', rotulo: 'Buscar comissionado', valor: s.busca, placeholder: 'Nome, equipe ou nome no Qlik' })}
    </div>
    <p class="secao-nota" id="cm-cad-nota">${nota}</p>
    ${nInativos ? interruptor({ id: 'cm-inativos', rotulo: `Mostrar desativados (${nInativos})`, marcado: s.inativos }) : ''}
    <div id="cm-lista">${listaCadastro()}</div>`;
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const mesPorExtenso = mes => `${MESES[Number(mes.slice(5, 7)) - 1]} de ${mes.slice(0, 4)}`;

// Cinco grupos, nesta ordem: CLT, PJ, Sem cadastro no Qlik, Não comissionam e (com o interruptor) Desativados.
// A busca vale para todos.
function listaCadastro() {
  const busca = t => !s.busca || contem(s.busca, t);
  const doCadastro = comissoes.cadastro()
    .filter(c => busca(`${c.nome} ${c.equipe || ''} ${c.nomes_qlik.join(' ')} ${c.pj_razao_social || ''} ${ROTULO_REGIME[c.regime]}`));
  const ativosL = doCadastro.filter(c => c.ativo !== false);
  const ultima = comissoes.semCadastroDaUltima();
  const semCadastro = (ultima?.lista || []).filter(x => busca(x.vendedor));
  const ignorados = comissoes.parametros().nomes_ignorados.filter(n => busca(n));
  const desativados = s.inativos ? doCadastro.filter(c => c.ativo === false) : [];
  const grupo = (titulo, ls, item, classe = '') => (ls.length ? html`<section class="painel ${classe}" aria-label="${titulo}">
    <h2 class="painel-titulo">${titulo} <span class="contador-texto">${ls.length}</span></h2>
    <ul class="usuarios-lista">${ls.map(item)}</ul></section>` : '');
  const algo = ativosL.length + semCadastro.length + ignorados.length + desativados.length;
  return algo ? html`
    ${grupo('CLT', ativosL.filter(c => !ehPJ(c)), itemCadastro)}
    ${grupo('PJ', ativosL.filter(ehPJ), itemCadastro)}
    ${grupo('Sem cadastro no Qlik', semCadastro, x => itemSemCadastro(x, ultima.mes), 'cm-cad-sem')}
    ${grupo('Não comissionam', ignorados, itemIgnorado, 'cm-nao-comissionam')}
    ${grupo('Desativados', desativados, itemCadastro)}`
    : vazio({ icone: 'pessoa', titulo: s.busca ? 'Ninguém com esse nome' : 'Ninguém cadastrado ainda', texto: s.busca ? 'Busque pelo nome, pela equipe ou pelo nome no Qlik.' : 'Busque as vendas de um mês na Apuração: quem vendeu aparece aqui para completar.' });
}

function itemCadastro(c) {
  const falta = ehPJ(c) && c.ativo !== false ? pendenciasPj(c) : [];
  const linhaExtra = !ehPJ(c) && c.acordo_minimo
    ? html`<small>Acordo mínimo de ${r$(c.acordo_minimo)}, de ${dataBR(c.acordo_inicio)} a ${c.acordo_fim ? dataBR(c.acordo_fim) : 'sem fim'}</small>` : '';
  return html`<li class="usuario${c.ativo === false ? ' inativo' : ''}">
    <div class="usuario-avatar" aria-hidden="true">${c.nome.trim().charAt(0).toUpperCase()}</div>
    <div class="usuario-dados">
      <strong>${c.nome}${c.regime === 'TELEVENDAS' ? html` ${seloNeutro('Televendas')}` : ''}${c.ativo === false ? html` ${seloNeutro('Desativado')}` : ''}${falta.length ? html` <span class="selo selo-falta">Falta: ${falta.join(', ')}</span>` : ''}</strong>
      <small>${textoPcts(c)}${c.equipe ? `, ${c.equipe}` : ''}${ehPJ(c) && c.pj_razao_social ? `. Recebe como ${c.pj_razao_social}` : ''}</small>
      <small>No Qlik: ${c.nomes_qlik.join(', ')}</small>
      ${linhaExtra}
    </div>
    <div class="acoes"><button type="button" class="btn btn-fantasma btn-pequeno" data-editar="${c.id}" aria-label="Editar ${c.nome}">${icone('editar')} Editar</button></div>
  </li>`;
}

const itemSemCadastro = (x, mes) => html`<li class="usuario">
    <div class="usuario-avatar" aria-hidden="true">${x.vendedor.trim().charAt(0)}</div>
    <div class="usuario-dados"><strong>${x.vendedor}</strong><small class="tabular">Vendeu ${r$(x.total)} em ${mesPorExtenso(mes)}</small></div>
    <div class="acoes">
      <button type="button" class="btn btn-fantasma btn-pequeno" data-completar="${x.vendedor}" aria-label="Completar cadastro: ${x.vendedor}">${icone('pessoa')} Completar cadastro</button>
      <button type="button" class="btn btn-texto btn-pequeno" data-ignorar="${x.vendedor}" aria-label="Não comissiona: ${x.vendedor}">Não comissiona</button>
    </div>
  </li>`;

const itemIgnorado = n => html`<li class="usuario">
    <div class="usuario-dados"><strong>${n}</strong></div>
    <div class="acoes"><button type="button" class="btn btn-texto btn-pequeno" data-voltar-comissionar="${n}" aria-label="Voltar a comissionar ${n}">Voltar a comissionar</button></div>
  </li>`;

// "2,5% no principal" e, quando a pessoa tem % próprio em algum secundário, "Farelo 1,5% (só desta pessoa)".
// Sem a tabela de fornecedores (migração 21), o pct_farelo do cadastro, como antes.
function textoPcts(c) {
  if (!comissoes.temFornecedores()) return `${pctTxt(c.pct_principal)} e ${pctTxt(c.pct_farelo)} no Farelo`;
  const proprios = secundariosAtivos().map(f => ({ f, pct: excecaoDe(c, f) })).filter(x => x.pct != null);
  return [`${pctTxt(c.pct_principal)} no principal`, ...proprios.map(x => `${x.f.nome} ${pctTxt(x.pct)} (só desta pessoa)`)].join(', ');
}
const secundariosAtivos = () => comissoes.fornecedores().filter(f => f.grupo === 'secundario' && f.ativo !== false);
const padraoDe = (f, regime) => (f[{ CLT: 'pct_clt', TELEVENDAS: 'pct_televendas', PJ: 'pct_pj' }[regime] || 'pct_clt'] ?? null);
// % próprio da pessoa num secundário, só quando difere do padrão do regime (igual ao padrão = sem exceção).
function excecaoDe(c, f) {
  if (c?.id == null) return null;
  const e = comissoes.excecoes(c.id).find(x => x.fornecedor_id === f.id);
  return e && Number(e.pct) !== Number(padraoDe(f, c.regime)) ? Number(e.pct) : null;
}
const textoPadrao = (f, regime) => {
  const p = padraoDe(f, regime);
  return p == null ? `sem % para ${ROTULO_REGIME[regime]}` : `${pctTxt(p)} (padrão ${ROTULO_REGIME[regime]})`;
};

// Secundários no diálogo: o padrão do regime e, opcional, um % só para esta pessoa.
function secundariosHtml(base) {
  const lista = secundariosAtivos();
  if (!lista.length) return '';
  return html`<fieldset class="cm-bloco" id="dc-secundarios">
    <legend>Secundários</legend>
    <p class="campo-dica">Em branco, vale o % do regime (definido em Parâmetros).</p>
    ${lista.map(f => html`<div class="cm-sec-linha">
      <p class="cm-sec-padrao"><strong>${f.nome}:</strong> <span data-padrao-sec="${f.id}">${textoPadrao(f, base.regime)}</span></p>
      ${campo({ id: `dc-sec-${f.id}`, rotulo: `% só para esta pessoa no ${f.nome}`, opcional: true, valor: valorPct(excecaoDe(base, f)), mascara: 'decimal', depois: sufixo })}
    </div>`)}
  </fieldset>`;
}

const ID = k => `dc-${k.replace(/_/g, '-')}`;
const pctPadraoObj = regime => { const p = pctPadrao(regime, comissoes.parametros()); return { pct_principal: p.principal, pct_farelo: p.farelo }; };

// c: cadastro existente, ou null para completar quem chegou do Qlik (nomeDoQlik obrigatório).
// regime: o regime já escolhido (ex.: PJ escolhido no lote). Devolve o cadastro gravado ou null.
export async function editar(c, nomeDoQlik = null, { regime = 'CLT' } = {}) {
  const novo = !c;
  const base = c || novoDoQlik(nomeDoQlik, regime, comissoes.parametros());
  const comTabela = comissoes.temFornecedores();
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
      ${comTabela ? '' : campo({ id: ID('pct_farelo'), rotulo: '% sobre o Farelo', valor: valorPct(base.pct_farelo), obrigatorio: true, mascara: 'decimal', depois: sufixo })}
    </div>
    ${comTabela ? secundariosHtml(base) : ''}
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
      <p class="campo-dica">Obrigatórios para PJ: sem eles não sai o recibo nem a ADP. As metas do Contrato de Resultado ficam na aba Contrato PJ, mês a mês.</p>
      ${campo({ id: ID('pj_razao_social'), rotulo: 'Razão social', obrigatorio: true, valor: dv('pj_razao_social'), atributos: { maxlength: 120 } })}
      <div class="cm-duas">
        ${campo({ id: ID('pj_documento'), rotulo: 'CNPJ ou CPF', obrigatorio: true, valor: dv('pj_documento'), atributos: { inputmode: 'numeric', maxlength: 18, autocomplete: 'off' } })}
        ${campo({ id: ID('pj_banco'), rotulo: 'Banco', obrigatorio: true, valor: dv('pj_banco'), atributos: { maxlength: 60 } })}
      </div>
      ${campo({ id: ID('pj_pix'), rotulo: 'Chave PIX', obrigatorio: true, valor: dv('pj_pix'), atributos: { maxlength: 140, autocomplete: 'off' } })}
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
          if (inp && (!inp.value.trim() || lerValor(inp.value) === antes[k])) inp.value = valorPct(depois[k]);
        }
        for (const f of secundariosAtivos()) { const el = $(`[data-padrao-sec="${f.id}"]`, d); if (el) el.textContent = textoPadrao(f, regime); }
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
        ...(comTabela ? {} : { pct_farelo: num('pct_farelo') }),
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
      // PJ ativo: razão social, CNPJ ou CPF válido, PIX e banco (a mesma regra do recibo e do banco, migração 22).
      if (dados.regime === 'PJ' && dados.ativo) Object.assign(erros, errosPj(dados));
      if (erros.nomes_qlik) { erroNoDialogo(d, erros.nomes_qlik); delete erros.nomes_qlik; if (!Object.keys(erros).length) return false; }
      // % próprio em cada secundário: vazio = o padrão do regime.
      const proprios = comTabela ? secundariosAtivos().map(f => ({ f, pct: num(`sec-${f.id}`) })) : [];
      const errosTela = Object.fromEntries(Object.entries(erros).map(([k, m]) => [ID(k), m]));
      for (const x of proprios) if (x.pct != null && !(x.pct >= 0 && x.pct <= 20)) errosTela[`dc-sec-${x.f.id}`] = 'De 0 a 20.';
      if (Object.keys(errosTela).length) { aplicarErros(d, errosTela); return false; }
      if (comTabela) {
        // pct_farelo (obsoleto) acompanha o % efetivo do Farelo, para o rollback da 21.
        const farelo = proprios.find(x => x.f.codigo === comissoes.parametros().cod_farelo);
        dados.pct_farelo = farelo ? (farelo.pct ?? padraoDe(farelo.f, dados.regime) ?? 0) : (c?.pct_farelo ?? pctPadraoObj(dados.regime).pct_farelo);
      }
      try {
        salvo = await comissoes.salvar(dados, c?.id ?? null);
        for (const x of proprios) await comissoes.salvarExcecao(salvo.id, x.f.id, x.pct);
        return true;
      } catch (e) { erroNoDialogo(d, detalhar(e).mensagem); return false; }
    },
  });
  if (desligar) desligar();
  if (!salvo || !s) return salvo;
  await recalcular();
  redesenhar();
  s.ctx.toast(novo ? `${salvo.nome} entrou na comissão.` : 'Cadastro salvo.', { tom: 'sucesso' });
  return salvo;
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
