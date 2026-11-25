// Configuração do app: chaves públicas do Supabase, versão, listas dos menus e textos fixos.

window.CONFIG = {

  // Supabase → Project Settings → Data API (Project URL) e API Keys (chave pública).
  SUPABASE_URL: "https://clfnsuzglasmguzwodxq.supabase.co",

  // Chave pública: sozinha não dá acesso a nada (as regras estão no banco).
  SUPABASE_ANON_KEY: "sb_publishable_BzXFZgmdRRsMWtzUJ4Ng8w_zJs5T_bt",

  MARCA: "LYNKZ",
  SUBMARCA: "Campanhas",
  DOMINIO: "lynkz.com.br",
  // Igual a VERSAO do sw.js e VERSAO_APP do js/app.js.
  VERSAO: "3.0.0",

  // Faixas do custo sobre a meta (0.08 = 8%).
  FAIXA_VERDE: 0.08,   // até aqui, dentro do padrão
  FAIXA_AMARELA: 0.15, // até aqui, atenção; acima disso, vermelho

  // Fornecedores (a chave mantém o nome LABORATORIOS).
  LABORATORIOS: ["Recurso próprio","Avert","BePet","Biogénesis Bagó Pet","Bionatural","Boehringer","Catlife","Centagro","Coolors","Farmina","Kelco","Nova D+","Nutripharme","OmniLab","Organnact Pet","Ouro Fino","Pet Delícia","Pet Next","Pet Nutrition","Premier","Special Dog","Vansil"],
  // Nome de cada fornecedor no Qlik ("Nome Fantasia Fornecedor"; * = qualquer trecho; "marca:X" usa a marca).
  // Sem entrada aqui, usa *primeira palavra*. BePet, Bionatural, Catlife, Coolors, Pet Next e Nova D+ não têm
  // fornecedor com esse nome no Qlik. Para descobrir nomes: npm run qlik:descobrir.
  LABORATORIO_QLIK: {
    "Biogénesis Bagó Pet": "BIOGEN*",
    "Ouro Fino": "OURO FINO*",
    "Pet Delícia": "PET DELICIA*",
    "Pet Nutrition": "PET NUTRITION*",
  },
  TIPOS: ["Campanha de prescrição","Bonificação (leve X pague Y)","Campanha de balconista","Rebate por meta","Ponto extra / exposição","Encarte / tabloide","Combo de produtos","Ação de sell-out","Patrocínio de eventos"],
  METAS: ["Mensal","Trimestral","Anual","Do mês da campanha"],
  // "Swile" é usado pela constraint campanhas_swile_valido: não renomeie sem migrar o banco.
  PAGTO: ["Desconto em nota","Bonificação em produto","Depósito / verba","Swile"],
  BASES: ["Bonificação","Sell-in (compras do cliente)","Sell-out (vendas do cliente)","Faturamento no período"],
  GATILHOS: ["Ao atingir 100% da meta","A partir de 80% da meta","Escalonado por faixa","Sobre todo o volume comprado"],

  // Textos fixos da ADP (iguais em todas as linhas; o resto vem de cada campanha).
  ADP: {
    EMPRESA_PAGADORA: "LYNKZ DIST S.A - MATRIZ",
    LOJA: "LYNKZ - MATRIZ",
    DEPARTAMENTO: "COMERCIAL",
    FORMA: "SWILE",
    TIPO_SEM_TIPO: "PREMIAÇÃO CAMPANHA",   // quando a campanha não tem tipo
  },

  // Motivos rápidos do diálogo de reprova (o texto continua editável).
  MOTIVOS_RAPIDOS: ["Custo acima do padrão para a meta","Falta a meta do cliente","Período da campanha inválido","Fornecedor não confirmou a verba","Dados de quem recebe incompletos"]
};
