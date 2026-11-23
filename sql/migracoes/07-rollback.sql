-- ============================================================
--  07 — ROLLBACK: desfaz clientes do Qlik e histórico das planilhas
--
--  Tira as colunas novas de empresas (código do cliente, nome fantasia,
--  UF, vendedor, origem, sincronizado_em) e a marca campanhas.importada.
--  NÃO apaga empresas, balconistas nem campanhas: o que foi importado
--  continua no app, só sem o código do Qlik e sem o selo "Importada".
--  Antes de rodar, exporte empresas e campanhas em CSV (Table Editor).
-- ============================================================
begin;
set local lock_timeout = '5s';

drop function if exists public.unir_empresas(bigint, bigint);
drop function if exists public.importar_historico_planilha(jsonb);
drop function if exists public.importar_clientes_qlik(jsonb);
drop trigger  if exists ao_proteger_qlik on public.empresas;
drop function if exists public.proteger_dados_qlik();

alter table public.empresas drop constraint if exists empresas_cnpj_dv;
alter table public.empresas drop constraint if exists empresas_origem_valida;
drop index if exists public.empresas_codigo_cliente_unico;
drop index if exists public.idx_empresas_nome_normalizado;
alter table public.empresas
  drop column if exists sincronizado_em,
  drop column if exists origem,
  drop column if exists vendedor,
  drop column if exists uf,
  drop column if exists nome_fantasia,
  drop column if exists codigo_cliente;

-- A view depende da coluna: sai antes e volta refeita sem ela.
drop view if exists public.campanhas_app;
alter table public.campanhas drop column if exists importada;
select public.reaplicar_permissoes_campanhas();

drop function if exists public.normalizar_nome(text);
drop function if exists public.cnpj_valido(text);
commit;
