// ============================================================
//  DIÁLOGOS DE CADASTRO — empresa e balconista.
//  Erro de gravação aparece dentro do próprio diálogo, que fica aberto.
// ============================================================
import { html, $ } from '../lib/dom.js';
import { icone } from './icones.js';
import { soDigitos, cnpjValido, maskCNPJ, maskCPF, maskTelefone, telefoneValido, errosRecebedor, hojeCivil } from '../lib/regras.js';
import { cadastros, ehDoQlik } from '../dados/cadastros.js';
import { detalhar } from '../dados/erros.js';
import { abrirDialogo, erroNoDialogo } from './avisos.js';
import { campo, areaTexto, ligarMascaras, aplicarErros } from './campos.js';

const val = (d, id) => ($('#' + id, d)?.value ?? '').trim();

// Abre o cadastro (ou edição) de empresa. Devolve a empresa gravada ou null.
export async function dialogoEmpresa(empresa = null, { nome = '' } = {}) {
  const e = empresa || {};
  const qlik = ehDoQlik(e);   // nome, CNPJ e cidade só mudam pela sincronização do Qlik
  const trava = qlik ? { readonly: true, 'aria-readonly': 'true' } : {};
  let salva = null, desligar = () => {};
  const corpo = html`
    ${qlik ? html`<p class="nota">${icone('info')}<span>Empresa do Qlik (cód. ${e.codigo_cliente}): nome, CNPJ e cidade são atualizados pela sincronização. Aqui você edita telefone e observações.</span></p>` : ''}
    ${campo({ id: 'de-nome', rotulo: 'Nome da empresa', valor: e.nome ?? nome, obrigatorio: !qlik,
              dica: qlik ? '' : 'Razão social ou nome da loja, como aparece na nota.', atributos: qlik ? trava : { autocomplete: 'organization', autofocus: true } })}
    <div class="grade-2 quebra">
      ${campo({ id: 'de-cnpj', rotulo: 'CNPJ', valor: e.cnpj ? maskCNPJ(e.cnpj) : '', mascara: 'cnpj', opcional: !qlik, atributos: trava })}
      ${campo({ id: 'de-telefone', rotulo: 'Telefone', valor: e.telefone ? maskTelefone(e.telefone) : '', mascara: 'tel', opcional: true, atributos: qlik ? { autofocus: true } : {} })}
    </div>
    ${campo({ id: 'de-cidade', rotulo: 'Cidade', valor: e.cidade ?? '', opcional: !qlik, atributos: trava })}
    ${areaTexto({ id: 'de-observacoes', rotulo: 'Observações', valor: e.observacoes ?? '', opcional: true })}`;

  await abrirDialogo({
    titulo: empresa ? 'Editar empresa' : 'Cadastrar empresa',
    corpo,
    acoes: [
      { rotulo: 'Cancelar', valor: null, tipo: 'fantasma' },
      { rotulo: empresa ? 'Salvar alterações' : 'Cadastrar empresa', valor: 'salvar', tipo: 'primario', principal: true },
    ],
    aoAbrir: d => { desligar = ligarMascaras(d); },
    antesDeFechar: async (_v, d) => {
      erroNoDialogo(d, '');
      const dados = qlik
        ? { telefone: val(d, 'de-telefone'), observacoes: val(d, 'de-observacoes') }
        : { nome: val(d, 'de-nome'), cnpj: val(d, 'de-cnpj'), telefone: val(d, 'de-telefone'),
            cidade: val(d, 'de-cidade'), observacoes: val(d, 'de-observacoes') };
      const erros = {};
      if (!qlik && dados.nome.length < 2) erros['de-nome'] = 'Informe o nome da empresa.';
      const cnpj = soDigitos(dados.cnpj);
      if (cnpj && cnpj.length !== 14) erros['de-cnpj'] = 'O CNPJ precisa ter 14 números.';
      else if (cnpj && !cnpjValido(cnpj)) erros['de-cnpj'] = 'CNPJ inválido. Confira os números.';
      else if (cnpj && cadastros.empresas({ inativas: true }).some(x => x.cnpj === cnpj && String(x.id) !== String(e.id))) {
        erros['de-cnpj'] = 'Já existe uma empresa com este CNPJ.';
      }
      if (dados.telefone && !telefoneValido(dados.telefone)) erros['de-telefone'] = 'Informe o telefone com DDD (10 ou 11 números).';
      if (aplicarErros(d, erros)) return false;
      try {
        salva = await cadastros.salvarEmpresa(dados, empresa?.id ?? null);
        return true;
      } catch (err) {
        const { mensagem, campo: c } = detalhar(err);
        if (c && $('#de-' + c, d)) aplicarErros(d, { ['de-' + c]: mensagem });
        else erroNoDialogo(d, mensagem);
        return false;
      }
    },
  });
  desligar();
  return salva;
}

// Cadastro (ou edição) de balconista de uma empresa. Devolve o registro ou null.
export async function dialogoBalconista(empresaId, balconista = null) {
  const b = balconista || {};
  const empresa = cadastros.empresa(empresaId);
  let salvo = null, desligar = () => {};
  const corpo = html`
    ${campo({ id: 'db-nome_completo', rotulo: 'Nome completo', valor: b.nome_completo ?? '', obrigatorio: true, atributos: { autocomplete: 'off', autofocus: true } })}
    <div class="grade-2 quebra">
      ${campo({ id: 'db-cpf', rotulo: 'CPF', valor: b.cpf ? maskCPF(b.cpf) : '', mascara: 'cpf', obrigatorio: true })}
      ${campo({ id: 'db-data_nascimento', rotulo: 'Nascimento', tipo: 'date', valor: b.data_nascimento ?? '', obrigatorio: true, atributos: { max: hojeCivil() } })}
    </div>
    ${campo({ id: 'db-email', rotulo: 'E-mail', tipo: 'email', valor: b.email ?? '', obrigatorio: true, atributos: { inputmode: 'email', autocomplete: 'off' } })}
    ${campo({ id: 'db-telefone', rotulo: 'Telefone', valor: b.telefone ? maskTelefone(b.telefone) : '', mascara: 'tel', obrigatorio: true })}`;

  await abrirDialogo({
    titulo: balconista ? 'Editar balconista' : 'Cadastrar balconista',
    descricao: empresa ? `Empresa: ${empresa.nome}` : '',
    corpo,
    acoes: [
      { rotulo: 'Cancelar', valor: null, tipo: 'fantasma' },
      { rotulo: balconista ? 'Salvar alterações' : 'Cadastrar balconista', valor: 'salvar', tipo: 'primario', principal: true },
    ],
    aoAbrir: d => { desligar = ligarMascaras(d); },
    antesDeFechar: async (_v, d) => {
      erroNoDialogo(d, '');
      const dados = {
        empresa_id: empresaId,
        nome_completo: val(d, 'db-nome_completo'), cpf: val(d, 'db-cpf'),
        data_nascimento: val(d, 'db-data_nascimento'), email: val(d, 'db-email'), telefone: val(d, 'db-telefone'),
      };
      const erros = Object.fromEntries(Object.entries(errosRecebedor(dados)).map(([k, m]) => ['db-' + k, m]));
      const cpf = soDigitos(dados.cpf);
      if (!erros['db-cpf'] && cadastros.balconistasDa(empresaId, { inativos: true }).some(x => x.cpf === cpf && String(x.id) !== String(b.id))) {
        erros['db-cpf'] = 'Já existe um balconista com este CPF nesta empresa.';
      }
      if (aplicarErros(d, erros)) return false;
      try {
        salvo = await cadastros.salvarBalconista(dados, balconista?.id ?? null);
        return true;
      } catch (err) {
        const { mensagem, campo: c } = detalhar(err);
        if (c && $('#db-' + c, d)) aplicarErros(d, { ['db-' + c]: mensagem });
        else erroNoDialogo(d, mensagem);
        return false;
      }
    },
  });
  desligar();
  return salvo;
}
