-- ============================================================
--  14 — VALIDAÇÃO (só leitura). Esperado: 5 linhas, todas com ok = true.
--  Rode DEPOIS de 14-fornecedores.sql. Linhas false = a migração não entrou.
-- ============================================================
select n, ok, teste from (values
  (1, exists (select 1 from information_schema.columns where table_schema='public' and table_name='campanhas' and column_name='fornecedores'),
      'campanhas tem a coluna fornecedores'),
  (2, exists (select 1 from information_schema.columns where table_schema='public' and table_name='campanhas_app' and column_name='fornecedores'),
      'view campanhas_app entrega fornecedores'),
  -- has_column_privilege dá ERRO se a coluna não existe: o case só pergunta depois de conferir.
  (3, case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='campanhas' and column_name='fornecedores')
      then has_column_privilege('authenticated', 'public.campanhas', 'fornecedores', 'insert')
       and not has_column_privilege('authenticated', 'public.campanhas', 'fornecedores', 'update')
      else false end,
      'app grava a divisão ao criar, mas não altera depois'),
  (4, coalesce(position('fornecedores' in pg_get_functiondef('public.enviar_campanha(jsonb,jsonb,jsonb)'::regprocedure)) > 0, false),
      'enviar_campanha grava a divisão por fornecedor'),
  (5, (select count(*) = 2 from pg_constraint where conname in ('campanhas_fornecedores_valido', 'campanhas_fornecedores_max')),
      'regras no banco: divisão confere com as somas e no máximo 5 fornecedores')
) t(n, ok, teste) order by n;
