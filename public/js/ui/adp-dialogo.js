// ============================================================
//  DIÁLOGO "GERAR ADP" — escolhe o mês, confere as campanhas aprovadas
//  com Swile, edita o que for preciso (valor, textos, dados de quem
//  recebe) e baixa o PDF. Qualquer usuário pode gerar; nada é gravado:
//  as edições valem só para o PDF.
// ============================================================
import { html, pintar, ao, $ } from '../lib/dom.js';
import { brl, lerValor, valorCampo, hojeCivil, maskCPF, cpfValido, emailValido, nomeCompleto, soDigitos, LIMITES } from '../lib/regras.js';
import { icone } from './icones.js';
import { abrirDialogo, erroNoDialogo } from './avisos.js';
import { ligarMascaras, aplicarErros, campo, areaTexto } from './campos.js';
import { mesesAdp, mesSugerido, itensAdp, linhaAdp, rotuloMes, gerarAdp, totalAdp } from '../adp.js';

const rotuloBotao = (n, total) => (n ? `Gerar PDF (${n} · R$ ${brl(total)})` : 'Gerar PDF');
const resumoRecebedor = l => `Recebe: ${l.favorecido || '—'}${l.cpf ? ` · CPF ${l.cpf}` : ''}`;

function linhaItem(it, i) {
  if (it.motivo) {
    return html`<li class="adp-item adp-bloqueado" data-i="${i}">
      <label class="adp-marca"><input type="checkbox" data-adp-marca="${i}" disabled aria-describedby="adp-d-${i}"><span class="adp-cliente">${it.c.cliente}</span></label>
      <p class="adp-info" id="adp-d-${i}"><span>${it.c.codigo} · ${it.c.campanha}</span>
        <span class="adp-motivo">${icone('cadeado')}${it.motivo}</span></p>
    </li>`;
  }
  const l = linhaAdp(it);
  const id = s => `adp-${s}-${i}`;
  return html`<li class="adp-item" data-i="${i}">
    <label class="adp-marca">
      <input type="checkbox" data-adp-marca="${i}" checked aria-describedby="adp-d-${i}">
      <span class="adp-cliente">${it.c.cliente}</span>
    </label>
    <p class="adp-info" id="adp-d-${i}">
      <span>${it.c.codigo} · ${it.c.campanha}</span>
      <span data-adp-resumo="${i}">${resumoRecebedor(l)}</span>
    </p>
    ${campo({ id: id('v'), rotulo: 'Valor a pagar (R$)', valor: valorCampo(l.valor), mascara: 'valor', classe: 'adp-valor' })}
    <details class="adp-editar" data-adp-editar="${i}">
      <summary>${icone('editar')}Editar dados desta linha</summary>
      <div class="adp-campos">
        <div class="grade-2 quebra">
          ${campo({ id: id('cli'), rotulo: 'Cliente', valor: l.cliente, obrigatorio: true, atributos: { maxlength: 200 } })}
          ${campo({ id: id('tipo'), rotulo: 'Tipo', valor: l.tipo, obrigatorio: true, atributos: { maxlength: 120 } })}
        </div>
        ${areaTexto({ id: id('obs'), rotulo: 'Observação ao fiscal', valor: l.observacao, obrigatorio: true, atributos: { rows: 2, maxlength: 300 } })}
        <div class="grade-2 quebra">
          ${campo({ id: id('fav'), rotulo: 'Favorecido (nome completo)', valor: l.favorecido, obrigatorio: true, atributos: { autocomplete: 'off', maxlength: 150 } })}
          ${campo({ id: id('cpf'), rotulo: 'CPF', valor: l.cpf, mascara: 'cpf', obrigatorio: true })}
        </div>
        <div class="grade-2 quebra">
          ${campo({ id: id('email'), rotulo: 'E-mail Swile', tipo: 'email', valor: l.email, obrigatorio: true, atributos: { autocomplete: 'off', maxlength: 254 } })}
          ${campo({ id: id('nasc'), rotulo: 'Data de nascimento', tipo: 'date', valor: l.nascimento, obrigatorio: true })}
        </div>
      </div>
    </details>
  </li>`;
}

// ctx: o mesmo das telas (campanhas, cadastros, toast).
let aberto = false;   // dois toques rápidos no botão não abrem dois diálogos
export async function dialogoGerarAdp(ctx) {
  if (aberto) return;
  aberto = true;
  try { await abrir(ctx); } finally { aberto = false; }
}

async function abrir(ctx) {
  const todas = ctx.campanhas.todas();
  const meses = mesesAdp(todas);
  if (!meses.length) {
    ctx.toast('Nenhuma campanha aprovada com pagamento Swile ainda.', { tom: 'erro', duracao: 6000 });
    return;
  }
  let mes = mesSugerido(meses, hojeCivil());
  let itens = [];
  let desligar = [];

  const corpo = html`
    <div class="grade-2 quebra">
      <div class="campo">
        <label for="adp-mes">Mês das campanhas</label>
        <select id="adp-mes" aria-describedby="adp-mes-dica">
          ${meses.map(m => html`<option value="${m.mes}"${m.mes === mes ? html` selected` : ''}>${rotuloMes(m.mes)} (${m.total})</option>`)}
        </select>
        <p class="campo-dica" id="adp-mes-dica">Pelo mês em que a campanha terminou.</p>
      </div>
      ${campo({ id: 'adp-venc', rotulo: 'Vencimento', tipo: 'date', valor: hojeCivil(), obrigatorio: true })}
    </div>
    <p class="adp-resumo" id="adp-resumo" role="status"></p>
    <ul class="adp-lista" id="adp-lista" aria-label="Campanhas da ADP"></ul>
    <p class="nota adp-nota">${icone('info')}<span>As edições valem só para este PDF: a campanha não muda.</span></p>`;

  const val = (d, id) => ($('#' + id, d)?.value ?? '').trim();

  // Lê as linhas marcadas (com as edições). erros: { idDoCampo: mensagem }.
  const ler = (d, { validar = false } = {}) => {
    const linhas = [], erros = {};
    itens.forEach((it, i) => {
      const cb = $(`[data-adp-marca="${i}"]`, d);
      if (!cb || !cb.checked || it.motivo) return;
      const id = s => `adp-${s}-${i}`;
      const l = {
        cliente: val(d, id('cli')), tipo: val(d, id('tipo')), observacao: val(d, id('obs')),
        favorecido: val(d, id('fav')).replace(/\s+/g, ' '), cpf: val(d, id('cpf')), email: val(d, id('email')).toLowerCase(),
        nascimento: val(d, id('nasc')), valor: lerValor(val(d, id('v'))),
      };
      if (validar) {
        if (!Number.isFinite(l.valor) || l.valor <= 0) erros[id('v')] = 'Informe o valor a pagar.';
        else if (l.valor > LIMITES.investimento_lynkz) erros[id('v')] = `Valor acima de R$ ${brl(LIMITES.investimento_lynkz)}.`;
        if (!l.cliente) erros[id('cli')] = 'Informe o cliente.';
        if (!l.tipo) erros[id('tipo')] = 'Informe o tipo.';
        if (!l.observacao) erros[id('obs')] = 'Escreva a observação ao fiscal.';
        if (!nomeCompleto(l.favorecido)) erros[id('fav')] = 'Informe nome e sobrenome.';
        if (!cpfValido(soDigitos(l.cpf))) erros[id('cpf')] = 'CPF inválido. Confira os números.';
        if (!emailValido(l.email)) erros[id('email')] = 'Digite um e-mail válido.';
        if (!l.nascimento) erros[id('nasc')] = 'Informe a data de nascimento.';
        else if (l.nascimento >= hojeCivil()) erros[id('nasc')] = 'A data de nascimento precisa ser no passado.';
      }
      linhas.push({ ...l, cpf: maskCPF(l.cpf) });
    });
    return { linhas, erros };
  };

  const atualizar = d => {
    const { linhas } = ler(d);
    const ok = linhas.filter(l => Number.isFinite(l.valor) && l.valor > 0);
    const total = totalAdp(ok);
    const bloqueados = itens.filter(x => x.motivo).length;
    pintar($('#adp-resumo', d), html`${linhas.length} de ${itens.length} marcada(s) · total R$ ${brl(total)}${bloqueados ? html` · <strong>${bloqueados} sem dados de quem recebe</strong>` : ''}`);
    const botao = $('.dialogo-acoes [type="submit"]', d);
    if (botao) botao.textContent = rotuloBotao(linhas.length, total);
  };

  const desenharLista = d => {
    itens = itensAdp(todas, ctx.cadastros, mes);
    pintar($('#adp-lista', d), html`${itens.map(linhaItem)}`);
    atualizar(d);
  };

  // Resumo "Recebe: …" acompanha a edição do nome e do CPF.
  const atualizarResumo = (d, campoEditado) => {
    const m = campoEditado.id.match(/^adp-(fav|cpf)-(\d+)$/);
    if (!m) return;
    const i = m[2];
    const r = $(`[data-adp-resumo="${i}"]`, d);
    if (r) r.textContent = resumoRecebedor({ favorecido: val(d, `adp-fav-${i}`), cpf: val(d, `adp-cpf-${i}`) });
  };

  await abrirDialogo({
    titulo: 'Gerar ADP',
    descricao: 'Autorização de pagamento das campanhas aprovadas com Swile. Desmarque o que não entra, ajuste o valor e, se precisar, edite os dados de cada linha.',
    corpo,
    acoes: [
      { rotulo: 'Cancelar', valor: null, tipo: 'fantasma' },
      { rotulo: 'Gerar PDF', valor: 'gerar', tipo: 'primario', principal: true },
    ],
    aoAbrir: d => {
      d.classList.add('dialogo-largo');
      desenharLista(d);
      desligar = [
        ligarMascaras(d),
        ao(d, 'change', '#adp-mes', (e, s) => { mes = s.value; erroNoDialogo(d, ''); desenharLista(d); }),
        ao(d, 'change', '[data-adp-marca]', () => atualizar(d)),
        ao(d, 'input', '.adp-valor input', () => atualizar(d)),
        ao(d, 'focusout', '.adp-valor input', () => atualizar(d)),
        ao(d, 'input', '.adp-editar input', (e, i) => atualizarResumo(d, i)),
      ];
    },
    antesDeFechar: async (_v, d) => {
      erroNoDialogo(d, '');
      const { linhas, erros } = ler(d, { validar: true });
      const venc = $('#adp-venc', d).value;
      if (!venc) erros['adp-venc'] = 'Informe o vencimento.';
      // Erro dentro de "Editar dados desta linha": abre a linha antes de marcar.
      for (const id of Object.keys(erros)) {
        const det = $('#' + id, d)?.closest('details');
        if (det) det.open = true;
      }
      if (aplicarErros(d, erros)) return false;
      if (!linhas.length) { erroNoDialogo(d, 'Marque pelo menos uma campanha.'); return false; }
      try {
        const r = await gerarAdp(linhas, {
          mes, vencimento: venc,
        });
        ctx.toast(`ADP de ${rotuloMes(mes).toLowerCase()} gerada: ${r.quantidade} campanha(s), R$ ${brl(r.total)}.`, { tom: 'sucesso' });
        return true;
      } catch (err) {
        erroNoDialogo(d, err.message || 'Não deu para gerar a ADP.');
        return false;
      }
    },
  });
  desligar.forEach(fn => fn());
}
