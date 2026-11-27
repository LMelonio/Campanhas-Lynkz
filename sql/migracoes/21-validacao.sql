-- ============================================================
--  21 — VALIDAÇÃO (só leitura). Esperado: 7 linhas, todas com ok = true.
--  Rode DEPOIS de 21-fornecedores-da-comissao.sql. Linhas false = a migração não entrou.
-- ============================================================
select n, ok, teste from (values
  (1, to_regclass('public.comissao_fornecedores') is not null and to_regclass('public.comissao_excecoes') is not null,
      'tabelas comissao_fornecedores e comissao_excecoes existem'),
  (2, coalesce((select bool_and(relrowsecurity) from pg_class where oid in (to_regclass('public.comissao_fornecedores'), to_regclass('public.comissao_excecoes'))), false),
      'as duas com RLS ligada'),
  (3, not exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('comissao_fornecedores', 'comissao_excecoes') and cmd in ('DELETE', 'ALL'))
      and (select count(*) = 6 from pg_policies where schemaname = 'public' and tablename in ('comissao_fornecedores', 'comissao_excecoes')),
      'ler, criar e alterar só para administrador; ninguém apaga'),
  (4, to_regclass('public.comissao_fornecedores') is not null
      and not has_table_privilege('authenticated', 'public.comissao_fornecedores', 'delete')
      and not has_table_privilege('authenticated', 'public.comissao_excecoes', 'delete')
      and not has_table_privilege('anon', 'public.comissao_fornecedores', 'select'),
      'sem delete pela API; visitante não lê'),
  (5, exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'comissao_parametros' and column_name = 'principal_modo')
      and exists (select 1 from pg_constraint where conname = 'comissao_parametros_principal'),
      'parâmetros com principal_modo e pct_outros_*'),
  (6, to_regclass('public.comissao_fornecedores') is not null
      and exists (select 1 from public.comissao_fornecedores f join public.comissao_parametros p on f.codigo = p.cod_farelo
                  where f.grupo = 'secundario' and f.pct_clt = p.pct_clt_farelo and f.pct_televendas = p.pct_televendas_farelo and f.pct_pj = p.pct_pj_farelo),
      'Farelo semeado como secundário com os % dos Parâmetros'),
  (7, (select count(*) = 4 from pg_trigger where not tgisinternal and tgname in
        ('ao_preparar_comissao_fornecedor', 'ao_preparar_comissao_excecao', 'ao_auditar_comissao_fornecedor', 'ao_auditar_comissao_excecao')),
      'gatilhos de preparo e auditoria ligados')
) t(n, ok, teste) order by n;
