-- ============================================================
--  09 — VALIDAÇÃO (só leitura). Esperado: 2 linhas, todas com ok = true.
-- ============================================================
select n, ok, teste from (values
  (1, exists (select 1 from information_schema.columns where table_schema='public' and table_name='campanhas' and column_name='compras_marca'),
      'campanhas tem compras_marca'),
  (2, exists (select 1 from information_schema.columns where table_schema='public' and table_name='campanhas_app' and column_name='compras_marca'),
      'view campanhas_app entrega compras_marca')
) t(n, ok, teste) order by n;
