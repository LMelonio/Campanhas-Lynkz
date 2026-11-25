-- ============================================================
--  15 — VALIDAÇÃO (só leitura). Esperado: 6 linhas, todas com ok = true.
--  Rode DEPOIS de 15-excluir-campanha.sql. Linhas false = a migração não entrou.
-- ============================================================
select n, ok, teste from (values
  (1, to_regclass('public.campanhas_excluidas') is not null,
      'tabela campanhas_excluidas existe'),
  (2, coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.campanhas_excluidas')), false),
      'campanhas_excluidas com RLS ligada'),
  (3, to_regprocedure('public.excluir_campanha(bigint,text)') is not null
      and coalesce((select prosecdef from pg_proc where oid = to_regprocedure('public.excluir_campanha(bigint,text)')), false),
      'função excluir_campanha existe (security definer)'),
  (4, to_regprocedure('public.excluir_campanha(bigint,text)') is not null
      and has_function_privilege('authenticated', 'public.excluir_campanha(bigint,text)', 'execute')
      and not has_function_privilege('anon', 'public.excluir_campanha(bigint,text)', 'execute'),
      'só usuário logado chama a função (a regra de administrador fica dentro dela)'),
  (5, not has_table_privilege('authenticated', 'public.campanhas', 'delete'),
      'app continua sem DELETE direto na tabela campanhas'),
  (6, to_regclass('public.campanhas_excluidas') is not null
      and not has_table_privilege('authenticated', 'public.campanhas_excluidas', 'insert')
      and not has_table_privilege('authenticated', 'public.campanhas_excluidas', 'update')
      and not has_table_privilege('authenticated', 'public.campanhas_excluidas', 'delete'),
      'registro das exclusões não pode ser alterado pela API')
) t(n, ok, teste) order by n;
