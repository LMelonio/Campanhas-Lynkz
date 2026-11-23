-- ============================================================
--  08 — VALIDAÇÃO (só leitura). Esperado: 6 linhas, todas com ok = true.
-- ============================================================
select n, ok, teste from (values
  (1, to_regclass('public.campanha_notas') is not null, 'tabela campanha_notas existe'),
  (2, (select relrowsecurity from pg_class where oid = 'public.campanha_notas'::regclass), 'segurança por linha ligada'),
  (3, exists (select 1 from information_schema.columns where table_schema='public' and table_name='campanhas_app' and column_name='compras_periodo'),
      'view campanhas_app entrega compras_periodo'),
  (4, has_table_privilege('authenticated','public.campanha_notas','SELECT')
      and not has_table_privilege('authenticated','public.campanha_notas','UPDATE')
      and not has_table_privilege('authenticated','public.campanha_notas','DELETE'),
      'app lê, mas não altera nem apaga notas'),
  (5, not has_table_privilege('anon','public.campanha_notas','SELECT'), 'visitante sem login não lê'),
  (6, exists (select 1 from pg_policies where tablename='campanha_notas' and policyname='campanha_notas_inclui'),
      'só o solicitante inclui nota')
) t(n, ok, teste) order by n;
