-- ============================================================
--  12 — VALIDAÇÃO (só leitura). Esperado: 5 linhas, todas com ok = true.
--  A linha 5 avisa se ainda não existe administrador ativo: nesse caso,
--  rode o "PRIMEIRO ADMINISTRADOR" do topo de 12-usuarios-e-balconistas.sql.
-- ============================================================
select n, ok, teste from (values
  (1, to_regprocedure('public.definir_perfil(uuid,text,boolean,text)') is not null,
      'função definir_perfil existe'),
  (2, to_regprocedure('public.definir_perfil(uuid,text,boolean,text)') is not null
      and has_function_privilege('authenticated', 'public.definir_perfil(uuid,text,boolean,text)', 'execute')
      and not has_function_privilege('anon', 'public.definir_perfil(uuid,text,boolean,text)', 'execute'),
      'só usuário logado executa definir_perfil'),
  (3, exists (select 1 from pg_trigger where tgname = 'ao_limitar_balconistas_empresa' and not tgisinternal),
      'limite de 2 balconistas por empresa ligado'),
  (4, not has_table_privilege('authenticated', 'public.perfis', 'update'),
      'ninguém edita perfis direto pela API (só pela função)'),
  (5, exists (select 1 from public.perfis where papel = 'aprovador' and ativo),
      'existe pelo menos um administrador ativo')
) t(n, ok, teste) order by n;

-- Informativo (não reprova): empresas que já passavam de 2 balconistas.
select e.id, e.nome, count(*) as balconistas
from public.empresas e join public.balconistas b on b.empresa_id = e.id
group by e.id, e.nome having count(*) > 2 order by count(*) desc;
