// Comissões (#/comissoes, só administrador).
//   ?aba=previa       vendas do mês no Qlik e o cálculo de cada pessoa (nada é gravado)
//   ?aba=cadastro     comissionados: regime, %, nomes do Qlik, acordo, metas do Contrato, dados da PJ
//   ?aba=parametros   código do Farelo, dia de corte, % padrão, Contrato de Resultado, nomes que não comissionam
// A tela só organiza: banco, Qlik e cálculo ficam em dados/comissoes.js e lib/comissoes.js.
import { html, pintar, $, $$, ao } from '../lib/dom.js';
import { brl, dataBR, horaBR, lerValor, valorCampo, contem, hojeCivil } from '../lib/regras.js';
import {
  REGIMES, ROTULO_REGIME, ehPJ, pctPadrao, periodoApuracao, mesAnteriorFechado,
  somaMes, rotuloMesComissao, errosComissionado, nomeQlik,
} from '../lib/comissoes.js';
import { comissoes } from '../dados/comissoes.js';
import { detalhar } from '../dados/erros.js';
import { icone } from '../ui/icones.js';
import { vazio, carregando, seloNeutro } from '../ui/pecas.js';
import { abrirDialogo, erroNoDialogo, confirmar } from '../ui/avisos.js';
import { campo, selecao, areaTexto, interruptor, aplicarErros, ligarMascaras, campoBusca, ligarBusca } from '../ui/campos.js';

const ABAS = [
  { valor: 'previa', rotulo: 'Prévia do mês' },
  { valor: 'cadastro', rotulo: 'Comissionados' },
  { valor: 'parametros', rotulo: 'Parâmetros' },
];

let s = null;   // { el, ctx, aba, pronto, erro, mes, resultado, buscando, erroQlik, busca, inativos, desligar[] }

const r$ = n => `R$ ${brl(n)}`;
const pctTxt = n => `${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const valorPct = n => (n == null || n === '' ? '' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
const mesMinusculo = mes => rotuloMesComissao(mes).replace(/^\S+/, m => m.toLowerCase());

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
  pintar(el, html`<div class="comissoes">
    <div class="filtros cm-abas" role="group" aria-label="Seções das comissões">
      ${ABAS.map(a => html`<button type="button" class="filtro" data-aba="${a.valor}" aria-pressed="${s.aba === a.valor}">${a.rotulo}</button>`)}
    </div>
    <div id="cm-conteudo">${s.aba === 'cadastro' ? telaCadastro() : s.aba === 'parametros' ? telaParametros() : telaPrevia()}</div>
  </div>`);
}

// ---------- prévia ----------
function telaPrevia() {
  const p = comissoes.parametros();
  const ap = periodoApuracao(s.mes, p.dia_corte);
  const ct = mesAnteriorFechado(s.mes);
  const meses = [0, -1, -2, -3, -4, -5].map(n => somaMes(mesPadrao(), n));
  if (!meses.includes(s.mes)) meses.unshift(s.mes);
  const r = s.resultado;
  return html`
    <div class="cm-cabeca"><div class="cm-consulta">
      ${selecao({ id: 'cm-mes', rotulo: 'Mês da apuração', opcoes: meses.map(m => ({ valor: m, rotulo: rotuloMesComissao(m) })), valor: s.mes, vazio: 'Escolha o mês' })}
      <button type="button" class="btn ${r ? 'btn-fantasma' : 'btn-primario'}" id="cm-buscar"${s.buscando ? html` aria-busy="true" disabled` : ''}>${icone('repetir')} ${s.buscando ? 'Buscando no Qlik…' : r ? 'Buscar de novo' : 'Buscar vendas no Qlik'}</button>
    </div>
    <p class="secao-nota cm-periodo">Vendas de ${dataBR(ap.inicio)} a ${dataBR(ap.fim)}, receita menos devolução, atacado regular. Farelo é o fornecedor ${p.cod_farelo}.
      O Contrato de Resultado olha ${mesMinusculo(ct.mes)} inteiro.</p></div>
    ${s.erroQlik ? html`<p class="nota nota-alerta" role="alert">${icone('alerta')}<span>${s.erroQlik}</span></p>` : ''}
    ${s.buscando && !r ? carregando(2) : r ? resultadoHtml(r) : html`<p class="nota">${icone('info')}<span>Escolha o mês e busque as vendas. É só uma prévia: nada é gravado e dá para buscar quantas vezes quiser.</span></p>`}`;
}

function resultadoHtml(r) {
  const t = r.totais;
  const semCad = r.semCadastro.reduce((x, v) => x + v.total, 0);
  return html`
    <section class="destaque cm-destaque" aria-labelledby="cm-total-t">
      <p class="destaque-rotulo" id="cm-total-t">A pagar em ${mesMinusculo(r.mes)}</p>
      <p class="cm-total num-display">${r$(t.geral.valor_pagar)}</p>
      <p class="destaque-sub">Prévia consultada às ${horaBR(r.consulta.consultado_em)}. Nada foi gravado.</p>
    </section>
    <dl class="numeros numeros-3 cm-numeros">
      <div class="numero"><dt>CLT</dt><dd class="num-display">${r$(t.clt.valor_pagar)}</dd></div>
      <div class="numero"><dt>PJ</dt><dd class="num-display">${r$(t.pj.valor_pagar)}</dd></div>
      <div class="numero${r.semCadastro.length ? ' cm-numero-alerta' : ''}"><dt>Sem cadastro</dt><dd class="num-display">${r$(semCad)}</dd></div>
    </dl>

    ${r.semCadastro.length ? html`<section class="painel cm-sem" aria-labelledby="cm-t-sem">
      <h2 class="painel-titulo" id="cm-t-sem">Vendas sem dono no cadastro</h2>
      <p class="painel-corpo campo-dica">Não entram em nenhuma comissão. Ligue o nome a quem vendeu (pode ser outro nome da mesma pessoa no Qlik) ou marque que não comissiona.</p>
      <ul class="cm-sem-lista">${r.semCadastro.map(x => html`<li>
        <div><strong>${x.vendedor}</strong><small class="tabular">${r$(x.total)}${x.farelo ? `, Farelo ${r$(x.farelo)}` : ''}</small></div>
        <div class="acoes">
          <button type="button" class="btn btn-fantasma btn-pequeno" data-ligar="${x.vendedor}" aria-label="Ligar a alguém: ${x.vendedor}">${icone('pessoa')} Ligar a alguém</button>
          <button type="button" class="btn btn-texto btn-pequeno" data-ignorar="${x.vendedor}" aria-label="Não comissiona: ${x.vendedor}">Não comissiona</button>
        </div></li>`)}</ul>
    </section>` : ''}
    ${r.consulta.sem_vendedor ? html`<p class="nota">${icone('info')}<span>${r$(r.consulta.sem_vendedor)} em vendas sem vendedor no Qlik ficaram de fora.</span></p>` : ''}

    ${tabela('Vendedores CLT', r.linhas.filter(l => !ehPJ(l)), false)}
    ${tabela('Representantes PJ', r.linhas.filter(ehPJ), true)}
    ${r.ignorados.length ? html`<p class="secao-nota">Não comissionam: ${r.ignorados.map(x => `${x.vendedor} (${r$(x.total)})`).join(', ')}. Para mudar, vá em Parâmetros.</p>` : ''}`;
}

const alertasHtml = l => (l.alertas.length ? html`<small class="cm-alerta-linha">${icone('alerta')}<span>${l.alertas.map(a => a.texto).join(' ')}</span></small>` : '');

function contratoHtml(c) {
  if (!c || c.motivo === 'Sem meta cadastrada') return html`<span class="cm-sub">Sem meta</span>`;
  const conta = `Faturamento ${c.pct_faturamento.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%, positivação ${c.positivados} de ${c.meta_positivacao}`;
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
        <th scope="col" class="num">Comissão</th><th scope="col" class="num">${pj ? 'Contrato de Resultado' : 'Acordo mínimo'}</th><th scope="col" class="num">A pagar</th></tr></thead>
      <tbody>${ls.map(l => html`<tr>
        <td data-rotulo="${pj ? 'Representante' : 'Vendedor'}" class="principal"><strong>${l.nome}</strong>
          <small class="cm-sub">${l.regime === 'TELEVENDAS' ? 'Televendas, ' : ''}${pctTxt(l.pct_principal)} e ${pctTxt(l.pct_farelo)} no Farelo${l.equipe ? `, ${l.equipe}` : ''}</small>${alertasHtml(l)}</td>
        <td data-rotulo="Venda principal" class="num tabular">${r$(l.venda_principal)}</td>
        <td data-rotulo="Farelo" class="num tabular">${r$(l.venda_farelo)}</td>
        <td data-rotulo="Comissão" class="num tabular">${r$(l.comissao_total)}</td>
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

// Recalcula com a consulta já feita (depois de mexer no cadastro ou nos parâmetros).
async function recalcular() {
  if (!s.resultado) return;
  s.resultado = await comissoes.apurar(s.mes, { buscar: false });
}

async function ignorarNome(nome) {
  const ok = await confirmar({
    titulo: `${nome} não comissiona?`,
    descricao: 'As vendas com este nome no Qlik deixam de aparecer como sem cadastro. Dá para desfazer em Parâmetros.',
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

async function ligarNome(nome) {
  const ativos = comissoes.cadastro().filter(c => c.ativo !== false);
  const v = await abrirDialogo({
    titulo: `De quem é ${nome}?`,
    descricao: 'As vendas deste nome passam a somar para a pessoa escolhida.',
    corpo: selecao({ id: 'cl-pessoa', rotulo: 'Pessoa', opcoes: ativos.map(c => ({ valor: c.id, rotulo: `${c.nome} (${ROTULO_REGIME[c.regime]})` })), vazio: 'Escolha a pessoa' }),
    acoes: [
      { rotulo: 'Cadastrar alguém novo', valor: 'novo', tipo: 'fantasma' },
      { rotulo: 'Ligar', valor: 'ligar', tipo: 'primario', principal: true },
    ],
    antesDeFechar: async (valor, d) => {
      if (valor !== 'ligar') return true;
      const id = $('#cl-pessoa', d).value;
      if (!id) { aplicarErros(d, { 'cl-pessoa': 'Escolha a pessoa.' }); return false; }
      try {
        const salvo = await comissoes.ligarNome(nome, id);
        await recalcular();
        s.ctx.toast(`${nome} agora soma para ${salvo.nome}.`, { tom: 'sucesso' });
        return true;
      } catch (e) { erroNoDialogo(d, detalhar(e).mensagem); return false; }
    },
  });
  if (v === 'ligar') desenhar();
  if (v === 'novo') editar(null, { nomes_qlik: [nome], nome: nomeLegivel(nome) });
}

const nomeLegivel = n => String(n).toLowerCase().replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
  .replace(/\b(Da|De|Do|Das|Dos|E)\b/g, x => x.toLowerCase());

// ---------- cadastro ----------
function telaCadastro() {
  const nInativos = comissoes.cadastro().filter(c => c.ativo === false).length;
  return html`
    <div class="cm-cad-topo">
      ${campoBusca({ id: 'cm-busca', rotulo: 'Buscar comissionado', valor: s.busca, placeholder: 'Nome, equipe ou nome no Qlik' })}
      <button type="button" class="btn btn-primario" id="cm-novo">${icone('mais')} Novo comissionado</button>
    </div>
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
    : vazio({ icone: 'pessoa', titulo: s.busca ? 'Ninguém com esse nome' : 'Ninguém cadastrado ainda', texto: s.busca ? 'Busque pelo nome, pela equipe ou pelo nome no Qlik.' : 'Cadastre os vendedores CLT e os representantes PJ que recebem comissão.' });
}

function itemCadastro(c) {
  const linhaExtra = ehPJ(c)
    ? (c.meta_faturamento || c.meta_positivacao
      ? html`<small>Meta de ${c.meta_faturamento != null ? r$(c.meta_faturamento) : '—'} e ${c.meta_positivacao ?? '—'} clientes${c.meta_atualizada_em ? html` <span class="cm-discreto">(alterada em ${dataBR(c.meta_atualizada_em)})</span>` : ''}</small>`
      : html`<small class="cm-falta">${icone('alerta')}<span>Sem meta do Contrato de Resultado</span></small>`)
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

async function editar(c, sugestao = {}) {
  const novo = !c;
  const base = c || { regime: 'CLT', ...pctPadraoObj('CLT'), nomes_qlik: [], ativo: true, ...sugestao };
  const dv = k => (base[k] ?? '');
  const corpo = html`
    ${campo({ id: ID('nome'), rotulo: 'Nome', valor: dv('nome'), obrigatorio: true, dica: 'Como aparece no app, no recibo e no Excel.', atributos: { maxlength: 80, autocomplete: 'off' } })}
    <div class="cm-duas">
      ${selecao({ id: ID('regime'), rotulo: 'Regime', obrigatorio: true, valor: base.regime, opcoes: REGIMES.map(r => ({ valor: r, rotulo: ROTULO_REGIME[r] })) })}
      ${campo({ id: ID('equipe'), rotulo: 'Equipe', opcional: true, valor: dv('equipe'), atributos: { maxlength: 60 } })}
    </div>
    <div class="cm-duas">
      ${campo({ id: ID('pct_principal'), rotulo: '% sobre a venda principal', valor: valorPct(base.pct_principal), obrigatorio: true, mascara: 'decimal', depois: sufixo })}
      ${campo({ id: ID('pct_farelo'), rotulo: '% sobre o Farelo', valor: valorPct(base.pct_farelo), obrigatorio: true, mascara: 'decimal', depois: sufixo })}
    </div>
    ${areaTexto({ id: ID('nomes_qlik'), rotulo: 'Nomes no Qlik', valor: (base.nomes_qlik || []).join('\n'), obrigatorio: true,
      dica: 'Um por linha, como aparece em Vendedor B2B. Mais de um nome soma tudo para a mesma pessoa.', atributos: { rows: 2 } })}
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
      <legend>Metas do Contrato de Resultado</legend>
      <p class="campo-dica">Comparadas com o mês anterior fechado. Continuam valendo nos meses seguintes até alguém mudar.${base.meta_atualizada_em ? html` <span class="cm-discreto">Alteradas em ${dataBR(base.meta_atualizada_em)}.</span>` : ''}</p>
      <div class="cm-duas">
        ${campo({ id: ID('meta_faturamento'), rotulo: 'Faturamento', opcional: true, valor: valorCampo(base.meta_faturamento), mascara: 'valor' })}
        ${campo({ id: ID('meta_positivacao'), rotulo: 'Clientes positivados', opcional: true, valor: dv('meta_positivacao'), atributos: { inputmode: 'numeric', maxlength: 6 } })}
      </div>
    </fieldset>
    <fieldset class="cm-bloco" data-so="pj"${ehPJ(base) ? '' : html` hidden`}>
      <legend>Quem recebe (recibo e ADP)</legend>
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
    titulo: novo ? 'Novo comissionado' : `Editar ${c.nome}`,
    corpo,
    acoes: [
      { rotulo: 'Cancelar', valor: null, tipo: 'fantasma' },
      { rotulo: novo ? 'Cadastrar' : 'Salvar alterações', valor: 'salvar', tipo: 'primario', principal: true },
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
        nomes_qlik: val('nomes_qlik').split(/\n|;/).map(nomeQlik).filter(Boolean),
        email: val('email').trim(),
        acordo_minimo: num('acordo_minimo'),
        acordo_inicio: val('acordo_inicio') || null,
        acordo_fim: val('acordo_fim') || null,
        meta_faturamento: num('meta_faturamento'),
        meta_positivacao: val('meta_positivacao').trim() === '' ? null : Number(val('meta_positivacao').replace(/\D/g, '')),
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
  s.ctx.toast(novo ? `${salvo.nome} cadastrado.` : 'Cadastro salvo.', { tom: 'sucesso' });
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
    <section class="painel" aria-labelledby="cp-t2"><h2 class="painel-titulo" id="cp-t2">% de quem for cadastrado</h2><div class="painel-corpo">
      <p class="campo-dica">Preenchem o cadastro de alguém novo. Quem já está cadastrado continua com os % do próprio cadastro.</p>
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
    s.resultado = null;   // outro corte ou outro Farelo: a prévia precisa de nova consulta
    s.ctx.toast('Parâmetros salvos.', { tom: 'sucesso' });
    desenhar();
  } catch (e) {
    s.ctx.toast(detalhar(e).mensagem, { tom: 'erro' });
    botao.disabled = false; botao.removeAttribute('aria-busy');
  }
}

// ---------- montagem ----------
async function carregar() {
  const meu = s;
  s.erro = null;
  try {
    await comissoes.carregar();
    if (s !== meu) return;
    s.mes ||= mesPadrao();
    s.resultado = await comissoes.apurar(s.mes, { buscar: false });
    s.pronto = true;
  } catch (e) { if (s === meu) s.erro = detalhar(e).mensagem; }
  if (s === meu) desenhar();
}

const abaDe = params => (ABAS.some(a => a.valor === params?.query?.aba) ? params.query.aba : 'previa');

export function montar(el, ctx, params) {
  s = { el, ctx, aba: abaDe(params), pronto: false, erro: null, mes: null, resultado: null, buscando: false, erroQlik: null, busca: '', inativos: false, desligar: [] };
  ctx.cabecalho({ titulo: 'Comissões' });
  s.desligar.push(
    ao(el, 'click', '[data-aba]', (e, b) => ctx.navegar(`#/comissoes?aba=${b.dataset.aba}`, { substituir: true })),
    ao(el, 'click', '#cm-tentar', () => { s.erro = null; desenhar(); carregar(); }),
    ao(el, 'click', '#cm-buscar', buscar),
    ao(el, 'change', '#cm-mes', async (e, sel) => {
      if (!sel.value) return;
      s.mes = sel.value; s.erroQlik = null;
      s.resultado = await comissoes.apurar(s.mes, { buscar: false });
      desenhar();
    }),
    ao(el, 'click', '[data-ignorar]', (e, b) => ignorarNome(b.dataset.ignorar)),
    ao(el, 'click', '[data-ligar]', (e, b) => ligarNome(b.dataset.ligar)),
    ao(el, 'click', '#cm-novo', () => editar(null)),
    ao(el, 'click', '[data-editar]', (e, b) => {
      const c = comissoes.cadastro().find(x => String(x.id) === b.dataset.editar);
      if (c) editar(c);
    }),
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
  desenhar();
}
