-- ============================================================
--  20 — VALIDAÇÃO (só leitura). Esperado: 3 linhas, todas com ok = true.
--  Rode DEPOIS de 20-total-do-fechamento.sql. Linhas false = a migração não entrou.
-- ============================================================
select n, ok, teste from (values
  (1, to_regprocedure('public.validar_total_fechamento()') is not null
      and coalesce((select prosecdef from pg_proc where oid = to_regprocedure('public.validar_total_fechamento()')), false),
      'função validar_total_fechamento existe (security definer)'),
  (2, exists (select 1 from pg_trigger where tgname = 'ao_validar_total_fechamento' and tgrelid = to_regclass('public.comissao_fechamentos') and not tgisinternal),
      'gatilho ligado em comissao_fechamentos'),
  (3, to_regprocedure('public.validar_total_fechamento()') is not null
      and not has_function_privilege('authenticated', 'public.validar_total_fechamento()', 'execute'),
      'o app não chama a função direto')
) t(n, ok, teste) order by n;
