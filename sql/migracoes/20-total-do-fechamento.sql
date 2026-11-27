-- ============================================================
--  20 — O BANCO CONFERE O TOTAL DO FECHAMENTO (v3.5.0)
--
--  Ao fechar um mês, o app manda a cópia da apuração (dados) e os totais
--  (total, total_clt, total_pj). Antes, o banco aceitava os totais como
--  vinham do navegador. Agora, ao fechar (status 'fechado'), confere com
--  tolerância zero:
--    total_clt = soma de dados->resultado->linhas[].valor_pagar (regime <> 'PJ')
--    total_pj  = a mesma soma só dos PJ
--    total     = total_clt + total_pj
--  Se não bater, o fechamento é recusado. Reabrir não muda nada.
--  O gatilho roda depois de ao_preparar_comissao_fechamento (ordem alfabética).
--
--  Pode rodar duas vezes. Pré-requisito: a 17.
--  Desfazer: 20-rollback.sql. Depois: 20-validacao.sql.
-- ============================================================

create or replace function public.validar_total_fechamento()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_linhas jsonb := new.dados->'resultado'->'linhas';
  v_clt    numeric;
  v_pj     numeric;
begin
  if new.status <> 'fechado' then return new; end if;
  if jsonb_typeof(v_linhas) is distinct from 'array' then v_linhas := '[]'::jsonb; end if;
  select coalesce(sum((l->>'valor_pagar')::numeric) filter (where coalesce(l->>'regime', '') <> 'PJ'), 0),
         coalesce(sum((l->>'valor_pagar')::numeric) filter (where l->>'regime' = 'PJ'), 0)
    into v_clt, v_pj
  from jsonb_array_elements(v_linhas) l;
  if new.total_clt <> v_clt or new.total_pj <> v_pj or new.total <> v_clt + v_pj then
    raise exception 'O total do fechamento não confere com as linhas da apuração (CLT %, PJ %). Busque as vendas de novo e feche outra vez.', v_clt, v_pj;
  end if;
  return new;
end $$;
revoke execute on function public.validar_total_fechamento() from public, anon, authenticated;

drop trigger if exists ao_validar_total_fechamento on public.comissao_fechamentos;
create trigger ao_validar_total_fechamento before insert or update on public.comissao_fechamentos
  for each row execute function public.validar_total_fechamento();
