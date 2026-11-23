// ============================================================
//  CONFIGURAÇÃO — este é o único arquivo que você precisa editar.
//  Pegue os dois valores no Supabase em:
//  Project Settings → Data API  (e Project Settings → API Keys)
// ============================================================

window.CONFIG = {

  // Cole aqui a "Project URL". Parece com: https://abcdefgh.supabase.co
  SUPABASE_URL: "https://clfnsuzglasmguzwodxq.supabase.co",

  // Cole aqui a chave pública "anon" / "publishable".
  // Pode ficar visível no site: ela sozinha não dá acesso a nada,
  // porque as regras de segurança estão no banco de dados.
  SUPABASE_ANON_KEY: "sb_publishable_BzXFZgmdRRsMWtzUJ4Ng8w_zJs5T_bt",

  // ---------- IDENTIDADE ----------
  // Aparece na tela de login e no rodapé.
  MARCA: "LYNKZ",
  SUBMARCA: "Campanhas",
  DOMINIO: "lynkz.com.br",
  // Aparece no login, no menu e no Perfil. Suba a cada deploy JUNTO com a
  // constante VERSAO do sw.js (as duas precisam ser iguais) para confirmar
  // no celular que a atualização chegou.
  VERSAO: "2.7.0",

  // Faixas do indicador de custo sobre a meta.
  // 0.08 = 8%. Ajuste para a régua da sua operação.
  FAIXA_VERDE: 0.08,   // até aqui, dentro do padrão
  FAIXA_AMARELA: 0.15, // até aqui, atenção; acima disso, vermelho

  // Listas dos menus suspensos. Edite à vontade.
  LABORATORIOS: ["Recurso próprio","Avert","BePet","Biogénesis Bagó Pet","Bionatural","Boehringer","Catlife","Centagro","Coolors","Farmina","Kelco","Nova D+","Nutripharme","OmniLab","Organnact Pet","Ouro Fino","Pet Delícia","Pet Next","Pet Nutrition","Premier","Special Dog","Vansil"],
  // Como cada laboratório aparece no Qlik (conferido com npm run qlik:descobrir em 23/11/2026).
  // Texto = padrão do "Nome Fantasia Fornecedor" (* = qualquer trecho, sem diferenciar maiúsculas).
  // Quem não está aqui usa *primeira palavra*. Também aceita "marca:XXX" (campo Marca do Produto).
  // BePet, Bionatural, Catlife, Coolors, Pet Next e Nova D+ NÃO têm fornecedor com esse nome no Qlik
  // (existem só como marca, sem vendas ligadas): para eles a consulta volta vazia até alguém dizer
  // com que nome vendem no Qlik.
  LABORATORIO_QLIK: {
    "Biogénesis Bagó Pet": "BIOGEN*",
    "Ouro Fino": "OURO FINO*",
    "Pet Delícia": "PET DELICIA*",
    "Pet Nutrition": "PET NUTRITION*",
  },
  TIPOS: ["Campanha de prescrição","Bonificação (leve X pague Y)","Campanha de balconista","Rebate por meta","Ponto extra / exposição","Encarte / tabloide","Combo de produtos","Ação de sell-out","Patrocínio de eventos"],
  METAS: ["Mensal","Trimestral","Anual","Do mês da campanha"],
  // "Swile" é usado como string literal numa CHECK constraint do banco
  // (campanhas_swile_valido, em schema.sql), que exige os dados do
  // recebedor sempre que essa opção é escolhida. Não renomeie nem troque
  // a grafia desse item sem migrar a constraint (e os dados já gravados)
  // junto — senão a regra do banco para de bater com o valor salvo.
  PAGTO: ["Desconto em nota","Bonificação em produto","Depósito / verba","Swile"],
  BASES: ["Bonificação","Sell-in (compras do cliente)","Sell-out (vendas do cliente)","Faturamento no período"],
  GATILHOS: ["Ao atingir 100% da meta","A partir de 80% da meta","Escalonado por faixa","Sobre todo o volume comprado"],

  // Botões de motivo rápido no diálogo de reprova (o texto continua editável).
  MOTIVOS_RAPIDOS: ["Custo acima do padrão para a meta","Falta a meta do cliente","Período da campanha inválido","Laboratório não confirmou a verba","Dados de quem recebe incompletos"]
};
