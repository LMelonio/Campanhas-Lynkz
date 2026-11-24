-- ============================================================
--  13 — VALIDAÇÃO (só leitura). Esperado: 5 linhas, todas com ok = true.
--  Rode DEPOIS de 13-devolucoes-da-consulta.sql. Linhas false = a migração não entrou.
-- ============================================================
select n, ok, teste from (values
  (1, exists (select 1 from information_schema.columns where table_schema='public' and table_name='campanhas' and column_name='compras_devolucoes')
      and exists (select 1 from information_schema.columns where table_schema='public' and table_name='campanhas' and column_name='compras_devolvidas'),
      'campanhas tem compras_devolucoes e compras_devolvidas'),
  (2, exists (select 1 from information_schema.columns where table_schema='public' and table_name='campanhas_app' and column_name='compras_devolucoes')
      and exists (select 1 from information_schema.columns where table_schema='public' and table_name='campanhas_app' and column_name='compras_devolvidas'),
      'view campanhas_app entrega as duas colunas'),
  -- has_column_privilege dá ERRO se a coluna não existe: o case só pergunta depois de conferir (migração não rodada = false).
  (3, case when (select count(*) from information_schema.columns where table_schema='public' and table_name='campanhas'
                  and column_name in ('compras_devolucoes', 'compras_devolvidas')) = 2
      then has_column_privilege('authenticated', 'public.campanhas', 'compras_devolucoes', 'insert')
       and has_column_privilege('authenticated', 'public.campanhas', 'compras_devolvidas', 'insert')
       and not has_column_privilege('authenticated', 'public.campanhas', 'compras_devolucoes', 'update')
      else false end,
      'app grava as colunas ao criar, mas não altera depois'),
  (4, coalesce(position('compras_devolvidas' in pg_get_functiondef('public.enviar_campanha(jsonb,jsonb,jsonb)'::regprocedure)) > 0, false),
      'enviar_campanha grava as devoluções'),
  (5, exists (select 1 from pg_constraint where conname = 'campanhas_devolucoes_faixa'),
      'limites das devoluções no banco (até R$ 10 milhões e 50 notas)')
) t(n, ok, teste) order by n;
