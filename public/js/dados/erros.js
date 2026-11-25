// Traduz erros do Supabase/Postgres para mensagens em português.

export class ErroApp extends Error {
  constructor(mensagem, original = null, campo = null) {
    super(mensagem);
    this.name = 'ErroApp';
    this.original = original;
    this.campo = campo;      // campo do formulário ligado ao erro, quando dá para saber
  }
}

// Constraint → [mensagem, campo]
const CONSTRAINTS = {
  empresas_cnpj_unico:           ['Já existe uma empresa com este CNPJ.', 'cnpj'],
  empresas_nome_valido:          ['Informe o nome da empresa (pelo menos 2 letras).', 'nome'],
  empresas_cnpj_valido:          ['O CNPJ precisa ter 14 números.', 'cnpj'],
  empresas_cnpj_dv:              ['CNPJ inválido. Confira os números.', 'cnpj'],
  empresas_telefone_valido:      ['Informe o telefone com DDD (10 ou 11 números).', 'telefone'],
  balconistas_empresa_cpf_unico: ['Já existe um balconista com este CPF nesta empresa.', 'cpf'],
  balconistas_cpf_valido:        ['CPF inválido. Confira os números.', 'cpf'],
  balconistas_nome_valido:       ['Informe nome e sobrenome.', 'nome_completo'],
  balconistas_email_valido:      ['Digite um e-mail válido.', 'email'],
  balconistas_telefone_valido:   ['Informe o telefone com DDD (10 ou 11 números).', 'telefone'],
  campanhas_swile_valido:        ['Confira os dados de quem recebe a premiação: com Swile, os 5 são obrigatórios e válidos.', null],
  campanhas_valores_faixa:       ['Algum valor passou do limite: rebate até 100%, meta até R$ 1 bilhão, investimentos e teto até R$ 10 milhões.', null],
  campanhas_devolucoes_faixa:    ['As devoluções da consulta do Qlik vieram fora do limite (até R$ 10 milhões e 50 notas). Consulte as compras de novo.', null],
  campanhas_textos_tamanho:      ['Algum texto ficou grande demais. Encurte o nome, a mecânica ou as observações.', null],
  campanhas_fornecedores_valido: ['A divisão por fornecedor não confere: cada fornecedor da campanha precisa de uma linha, e a meta e a indústria totais têm de ser a soma delas.', 'n-meta'],
  campanhas_fornecedores_max:    ['No máximo 5 fornecedores por campanha. Tire algum e envie de novo.', null],
  periodo_valido:                ['A data de fim está antes da data de início.', 'data_fim'],
};

function constraintDo(error) {
  const texto = `${error.message || ''} ${error.details || ''}`;
  return Object.keys(CONSTRAINTS).find(c => texto.includes(c)) || null;
}

export function traduzir(error) {
  return detalhar(error).mensagem;
}

export function detalhar(error) {
  if (!error) return { mensagem: 'Erro desconhecido.', campo: null };
  if (error instanceof ErroApp) return { mensagem: error.message, campo: error.campo };
  const msg = String(error.message || error || '');
  const codigo = error.code || '';

  if ((typeof navigator !== 'undefined' && navigator.onLine === false) ||
      /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(msg)) {
    return { mensagem: 'Sem conexão. Confira a internet e tente de novo.', campo: null };
  }
  if (codigo === 'PGRST301' || codigo === 'PGRST303' || error.status === 401 || /jwt|session.*(expired|missing)|refresh token/i.test(msg)) {
    return { mensagem: 'Sua sessão expirou. Saia e entre de novo.', campo: null };
  }
  // Mensagens de RAISE EXCEPTION dos triggers já estão em português.
  if (codigo === 'P0001') return { mensagem: msg, campo: null };

  const c = constraintDo(error);
  if (c) return { mensagem: CONSTRAINTS[c][0], campo: CONSTRAINTS[c][1] };

  if (codigo === '42501' || /row-level security|permission denied/i.test(msg)) {
    return { mensagem: 'Você não tem permissão para fazer isso. Se o seu acesso foi desativado, fale com a gerência.', campo: null };
  }
  if (codigo === '23505') return { mensagem: 'Este registro já existe.', campo: null };
  if (codigo === '23514' || codigo === '23502') return { mensagem: 'Algum dado está fora da regra. Confira os campos.', campo: null };
  if (codigo === '23503') return { mensagem: 'O cadastro ligado a este registro não foi encontrado. Recarregue a página.', campo: null };
  if (error.status === 429 || /rate limit/i.test(msg)) {
    return { mensagem: 'Muitos pedidos seguidos. Aguarde alguns minutos e tente de novo.', campo: null };
  }
  if (codigo === 'PGRST205' || codigo === 'PGRST202' || codigo === '42P01') {
    return { mensagem: 'O sistema está em atualização. Tente de novo em alguns minutos ou avise a gerência.', campo: null };
  }
  // O texto técnico (às vezes em inglês) vai só para o console, nunca para a tela.
  console.error('Erro sem tradução:', error);
  return { mensagem: 'Não foi possível concluir agora. Tente de novo.', campo: null };
}

// Desembrulha a resposta do Supabase: devolve data ou lança ErroApp em português.
export function exigir({ data, error }) {
  if (error) {
    const { mensagem, campo } = detalhar(error);
    throw new ErroApp(mensagem, error, campo);
  }
  return data;
}
