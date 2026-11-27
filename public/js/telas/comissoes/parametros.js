// Comissões → Parâmetros: dia de corte, fornecedor principal e secundários (com % por regime), % de quem
// completar o cadastro, Contrato de Resultado e nomes que não comissionam.
// Fornecedores (migração 21): o principal é "todos menos os secundários" ou uma lista; venda fora das listas
// vai para "Outros fornecedores". Cada secundário tem % por regime e "vale a partir de" (mês).
import { html, $, ao } from '../../lib/dom.js';
import { dataBR, lerValor } from '../../lib/regras.js';
import { nomeQlik, rotuloMesComissao } from '../../lib/comissoes.js';
import { comissoes } from '../../dados/comissoes.js';
import { detalhar } from '../../dados/erros.js';
import { icone } from '../../ui/icones.js';
import { seloNeutro } from '../../ui/pecas.js';
import { abrirDialogo, erroNoDialogo } from '../../ui/avisos.js';
import { campo, areaTexto, interruptor, aplicarErros, ligarMascaras } from '../../ui/campos.js';
import { s, pctTxt, valorPct, sufixo, redesenhar } from './comum.js';

const PCT_PRINCIPAL = ['pct_clt_principal', 'pct_televendas_principal', 'pct_pj_principal'];
const PCT_OUTROS = ['pct_outros_clt', 'pct_outros_televendas', 'pct_outros_pj'];
const CONTRATO = ['contrato_gatilho_faturamento', 'contrato_gatilho_positivacao', 'contrato_pct_faixa1', 'contrato_limite_faixa', 'contrato_pct_faixa2'];
const LIMITES_PARAM = { contrato_gatilho_faturamento: [1, 500], contrato_gatilho_positivacao: [1, 500], contrato_limite_faixa: [1, 500] };
const pctOuTraco = v => (v == null ? '—' : pctTxt(v));

function secundariosHtml() {
  const lista = comissoes.fornecedores().filter(f => f.grupo === 'secundario');
  return html`<section class="painel" aria-labelledby="cp-t-sec"><h2 class="painel-titulo" id="cp-t-sec">Fornecedores secundários
      <button type="button" class="btn btn-fantasma btn-pequeno" id="cp-novo-sec">${icone('mais')} Adicionar fornecedor secundário</button></h2>
    <div class="painel-corpo">
      <p class="campo-dica">Cada secundário tem o seu % por regime. Um % diferente para uma pessoa fica no Cadastro dela.</p>
    </div>
    ${lista.length ? html`<div class="tabela-caixa"><table class="tabela cm-tabela cm-tabela-forn">
      <thead><tr><th scope="col">Fornecedor</th><th scope="col" class="num">CLT</th><th scope="col" class="num">Televendas</th><th scope="col" class="num">PJ</th>
        <th scope="col">Vale a partir de</th><th scope="col">Ativo</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead>
      <tbody>${lista.map(f => html`<tr>
        <td data-rotulo="Fornecedor" class="principal"><strong>${f.nome}</strong><small class="cm-sub">Código ${f.codigo}</small></td>
        <td data-rotulo="CLT" class="num tabular">${pctOuTraco(f.pct_clt)}</td>
        <td data-rotulo="Televendas" class="num tabular">${pctOuTraco(f.pct_televendas)}</td>
        <td data-rotulo="PJ" class="num tabular">${pctOuTraco(f.pct_pj)}</td>
        <td data-rotulo="Vale a partir de">${f.vale_de <= '2000-01' ? 'Sempre' : rotuloMesComissao(f.vale_de)}</td>
        <td data-rotulo="Ativo">${f.ativo === false ? seloNeutro('Desligado') : 'Sim'}</td>
        <td data-rotulo="" class="cm-acao"><button type="button" class="btn btn-texto btn-pequeno" data-editar-sec="${f.id}" aria-label="Editar ${f.nome}">${icone('editar')} Editar</button></td>
      </tr>`)}</tbody></table></div>`
      : html`<p class="painel-corpo campo-dica">Nenhum secundário: toda a venda conta como principal.</p>`}
  </section>`;
}

export function desenhar() {
  const p = comissoes.parametros();
  const pc = (k, rotulo) => campo({ id: `cp-${k}`, rotulo, valor: valorPct(p[k]), obrigatorio: true, mascara: 'decimal', depois: sufixo });
  const comTabela = comissoes.temFornecedores();
  const lista = p.principal_modo === 'lista';
  const codigosPrincipal = comissoes.fornecedores().filter(f => f.grupo === 'principal' && f.ativo !== false).map(f => f.codigo);
  return html`<form class="cm-parametros" id="cm-form-param" novalidate>
    <section class="painel" aria-labelledby="cp-t1"><h2 class="painel-titulo" id="cp-t1">Apuração</h2><div class="painel-corpo">
      <div class="cm-duas">
        ${campo({ id: 'cp-dia_corte', rotulo: 'Dia de corte', valor: p.dia_corte, obrigatorio: true, dica: `Hoje: do dia ${Number(p.dia_corte) + 1} do mês anterior ao dia ${p.dia_corte}.`, atributos: { inputmode: 'numeric', maxlength: 2 } })}
      </div>
      ${comTabela ? html`<fieldset class="cm-bloco" id="cp-principal">
        <legend>Fornecedor principal</legend>
        <p class="campo-dica">Venda do principal paga o % principal do cadastro de cada pessoa.</p>
        <div class="pessoas">
          <label class="pessoa"><input type="radio" name="cp-principal_modo" value="todos"${lista ? '' : html` checked`}><span class="pessoa-nome">Todos, menos os secundários</span></label>
          <label class="pessoa"><input type="radio" name="cp-principal_modo" value="lista"${lista ? html` checked` : ''}><span class="pessoa-nome">Só estes fornecedores</span></label>
        </div>
        <div id="cp-lista"${lista ? '' : html` hidden`}>
          ${areaTexto({ id: 'cp-codigos_principal', rotulo: 'Códigos do principal', valor: codigosPrincipal.join('\n'), obrigatorio: true, dica: 'Um código de fornecedor por linha.', atributos: { rows: 3, inputmode: 'numeric' } })}
          <p class="campo-dica">Venda de fornecedor fora das listas entra em "Outros fornecedores", com estes %:</p>
          <div class="cm-tres">${pc('pct_outros_clt', 'Outros: CLT')}${pc('pct_outros_televendas', 'Outros: Televendas')}${pc('pct_outros_pj', 'Outros: PJ')}</div>
        </div>
      </fieldset>` : html`<p class="nota">${icone('info')}<span>Farelo: fornecedor ${p.cod_farelo}. Para cadastrar outros fornecedores secundários, rode a migração 21 no banco.</span></p>`}
      ${areaTexto({ id: 'cp-nomes_ignorados', rotulo: 'Nomes do Qlik que não comissionam', valor: p.nomes_ignorados.join('\n'), opcional: true, dica: 'Um por linha. Por exemplo: TERRAZOO, venda da própria empresa.', atributos: { rows: 3 } })}
    </div></section>
    ${comTabela ? secundariosHtml() : ''}
    <section class="painel" aria-labelledby="cp-t2"><h2 class="painel-titulo" id="cp-t2">% principal de quem completar o cadastro</h2><div class="painel-corpo">
      <p class="campo-dica">Preenchem o cadastro de quem chega do Qlik. Quem já está cadastrado continua com o % do próprio cadastro. O % dos secundários fica na linha de cada um.</p>
      <div class="cm-tres">${pc('pct_clt_principal', 'CLT')}${pc('pct_televendas_principal', 'Televendas')}${pc('pct_pj_principal', 'PJ')}</div>
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

async function salvarParametros(form) {
  const v = k => $(`#cp-${k}`, form)?.value ?? '';
  const modo = $('input[name="cp-principal_modo"]:checked', form)?.value || 'todos';
  const dados = { dia_corte: Number(v('dia_corte')), nomes_ignorados: v('nomes_ignorados').split('\n').map(nomeQlik).filter(Boolean) };
  const erros = {};
  if (!(Number.isInteger(dados.dia_corte) && dados.dia_corte >= 1 && dados.dia_corte <= 28)) erros['cp-dia_corte'] = 'De 1 a 28.';
  const lerPct = k => {
    const n = lerValor(v(k));
    const [min, max] = LIMITES_PARAM[k] || [0, 20];
    if (v(k).trim() === '' || !Number.isFinite(n) || n < min || n > max) erros[`cp-${k}`] = `De ${min} a ${max}.`;
    dados[k] = n;
  };
  [...PCT_PRINCIPAL, ...CONTRATO].forEach(lerPct);
  let codigos = null;
  if (comissoes.temFornecedores()) {
    dados.principal_modo = modo;
    if (modo === 'lista') {
      PCT_OUTROS.forEach(lerPct);
      codigos = v('codigos_principal').split(/\s+/).map(x => x.trim()).filter(Boolean);
      if (!codigos.length) erros['cp-codigos_principal'] = 'Informe pelo menos um código.';
      else if (codigos.some(c => !/^\d{1,10}$/.test(c))) erros['cp-codigos_principal'] = 'Só números, até 10 por código.';
    }
  }
  if (Object.keys(erros).length) { aplicarErros(form, erros); return; }
  const botao = $('button[type="submit"]', form);
  botao.disabled = true; botao.setAttribute('aria-busy', 'true');
  try {
    if (codigos) await comissoes.salvarListaPrincipal(codigos);
    await comissoes.salvarParametros(dados);
    s.resultado = null;   // outro corte: a apuração precisa de nova consulta
    s.ctx.toast('Parâmetros salvos.', { tom: 'sucesso' });
    redesenhar();
  } catch (e) {
    s.ctx.toast(detalhar(e).mensagem, { tom: 'erro' });
    botao.disabled = false; botao.removeAttribute('aria-busy');
  }
}

// Diálogo de um secundário: novo (com código) ou edição (o código não muda: as exceções apontam para ele).
async function dialogoSecundario(f = null) {
  const novo = !f;
  const base = f || { nome: '', pct_clt: null, pct_televendas: null, pct_pj: null, vale_de: '', ativo: true };
  const ID = k => `cs-${k}`;
  const pc = (k, rotulo) => campo({ id: ID(k), rotulo, valor: valorPct(base[k]), obrigatorio: true, mascara: 'decimal', depois: sufixo });
  let salvo = null;
  await abrirDialogo({
    titulo: novo ? 'Adicionar fornecedor secundário' : `Editar ${f.nome}`,
    descricao: novo ? 'A venda deste fornecedor sai do principal e paga o % do regime de cada pessoa.' : `Código ${f.codigo}.`,
    corpo: html`
      ${novo ? campo({ id: ID('codigo'), rotulo: 'Código do fornecedor no Qlik', obrigatorio: true, dica: 'O nome aparece sozinho quando o fornecedor está na última consulta.', atributos: { inputmode: 'numeric', maxlength: 10, autocomplete: 'off' } }) : ''}
      ${campo({ id: ID('nome'), rotulo: 'Nome', valor: base.nome, obrigatorio: true, atributos: { maxlength: 80 } })}
      <div class="cm-tres">${pc('pct_clt', '% CLT')}${pc('pct_televendas', '% Televendas')}${pc('pct_pj', '% PJ')}</div>
      ${campo({ id: ID('vale_de'), rotulo: 'Vale a partir de', tipo: 'month', valor: base.vale_de > '2000-01' ? base.vale_de : '', opcional: true, dica: 'Em branco: vale para todos os meses abertos.' })}
      ${novo ? '' : interruptor({ id: ID('ativo'), rotulo: 'Ativo', marcado: base.ativo !== false, dica: 'Desligado, a venda dele volta para o principal. Nada é apagado.' })}`,
    acoes: [{ rotulo: 'Cancelar', valor: null, tipo: 'fantasma' }, { rotulo: novo ? 'Adicionar' : 'Salvar', valor: 'ok', tipo: 'primario', principal: true }],
    aoAbrir: d => {
      const desligar = ligarMascaras(d);
      d.addEventListener('close', desligar, { once: true });
      $(`#${ID(novo ? 'codigo' : 'nome')}`, d).focus();
      if (!novo) return;
      const nome = $(`#${ID('nome')}`, d);
      let sugerido = '';
      d.addEventListener('input', e => {
        if (e.target.id !== ID('codigo')) return;
        const achado = comissoes.nomeFornecedorNaConsulta(e.target.value.trim());
        if (achado && (!nome.value || nome.value === sugerido)) { nome.value = achado; sugerido = achado; }
      });
    },
    antesDeFechar: async (_v, d) => {
      erroNoDialogo(d, '');
      const v = k => $(`#${ID(k)}`, d)?.value ?? '';
      const erros = {};
      const dados = { nome: v('nome').trim().replace(/\s+/g, ' '), grupo: 'secundario', vale_de: v('vale_de') || '2000-01' };
      if (novo) {
        dados.codigo = v('codigo').trim();
        if (!/^\d{1,10}$/.test(dados.codigo)) erros[ID('codigo')] = 'Só números, até 10.';
        else if (comissoes.fornecedores().some(x => x.codigo === dados.codigo)) erros[ID('codigo')] = 'Este código já está cadastrado.';
      } else dados.ativo = !!$(`#${ID('ativo')}`, d).checked;
      if (!dados.nome) erros[ID('nome')] = 'Informe o nome.';
      for (const k of ['pct_clt', 'pct_televendas', 'pct_pj']) {
        const n = lerValor(v(k));
        if (v(k).trim() === '' || !Number.isFinite(n) || n < 0 || n > 20) erros[ID(k)] = 'De 0 a 20.';
        dados[k] = n;
      }
      if (Object.keys(erros).length) { aplicarErros(d, erros); return false; }
      try { salvo = await comissoes.salvarFornecedor(dados, f?.id ?? null); return true; }
      catch (e) { erroNoDialogo(d, detalhar(e).mensagem); return false; }
    },
  });
  if (!salvo || !s) return;
  s.resultado = await comissoes.apurar(s.mes, { buscar: false }).catch(() => s.resultado);
  s.ctx.toast(novo ? `${salvo.nome} entrou nos secundários.` : `${salvo.nome} salvo.`, { tom: 'sucesso' });
  redesenhar();
}

export function ligar(el) {
  return [
    ao(el, 'submit', '#cm-form-param', (e, f) => { e.preventDefault(); salvarParametros(f); }),
    // Escolher "Só estes fornecedores" mostra a lista e os % de Outros (sem redesenhar o formulário).
    ao(el, 'change', 'input[name="cp-principal_modo"]', (e, r) => { const l = $('#cp-lista', el); if (l) l.hidden = r.value !== 'lista'; }),
    ao(el, 'click', '#cp-novo-sec', () => dialogoSecundario()),
    ao(el, 'click', '[data-editar-sec]', (e, b) => dialogoSecundario(comissoes.fornecedores().find(f => String(f.id) === b.dataset.editarSec))),
  ];
}
