-- ============================================================
--  19 — CONSULTA DO QLIK DO MÊS GRAVADA (v3.5.0)
--
--  A resposta do Qlik das comissões (vendas por vendedor e o cubo do Contrato)
--  ficava só na memória da aba: ao recarregar, a Apuração voltava vazia e era
--  preciso buscar de novo (uns 7 s). Agora cada busca grava a consulta do mês.
--    - comissao_consultas: uma linha por mês, com { apuracao, contrato,
--      cod_farelo, dia_corte } em `dados`, quem consultou e quando.
--    - conferido_em / conferido_por: "Conferido com o mês anterior" (v3.6).
--      Uma consulta nova zera a conferência.
--    - Mês fechado não aceita consulta nova (mesma regra da 17).
--  A base linha a linha do Excel continua sob demanda e não é gravada.
--  RLS eh_aprovador() para ler, criar e alterar; ninguém apaga.
--
--  Pode rodar duas vezes. Pré-requisito: a 17.
--  Desfazer: 19-rollback.sql. Depois: 19-validacao.sql.
-- ============================================================

create table if not exists public.comissao_consultas (
  id             bigint generated always as identity primary key,
  mes            text   not null,
  dados          jsonb  not null,           -- { apuracao, contrato, cod_farelo, dia_corte }
  consultado_em  timestamptz not null default now(),
  consultado_por uuid references public.perfis(id),
  conferido_em   timestamptz,
  conferido_por  uuid references public.perfis(id),
  constraint comissao_consultas_mes_unico unique (mes),
  constraint comissao_consultas_mes check (mes ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint comissao_consultas_dados check (jsonb_typeof(dados) = 'object'),
  constraint comissao_consultas_tamanho check (pg_column_size(dados) < 2000000)
);

-- Carimbos do banco (o app não escolhe quem nem quando) e trava do mês fechado.
create or replace function public.preparar_comissao_consulta()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Quem não é administrador para no RLS logo depois: não conta nada sobre o mês aqui.
  if not public.eh_aprovador() then return new; end if;
  if exists (select 1 from public.comissao_fechamentos f
              where f.status = 'fechado' and (f.mes = new.mes or (tg_op = 'UPDATE' and f.mes = old.mes))) then
    raise exception 'O mês % está fechado. Reabra o mês para consultar o Qlik de novo.', new.mes;
  end if;
  if tg_op = 'INSERT' then
    new.consultado_em := now(); new.consultado_por := auth.uid();
    new.conferido_em := null;  new.conferido_por := null;
    return new;
  end if;
  new.mes := old.mes;
  if new.dados is distinct from old.dados then
    -- Consulta nova: o que foi conferido antes não vale mais.
    new.consultado_em := now(); new.consultado_por := auth.uid();
    new.conferido_em := null;  new.conferido_por := null;
  else
    new.consultado_em := old.consultado_em; new.consultado_por := old.consultado_por;
    if new.conferido_em is null then new.conferido_por := null;
    elsif old.conferido_em is null then new.conferido_em := now(); new.conferido_por := auth.uid();
    else new.conferido_em := old.conferido_em; new.conferido_por := old.conferido_por;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.preparar_comissao_consulta() from public, anon, authenticated;
drop trigger if exists ao_preparar_comissao_consulta on public.comissao_consultas;
create trigger ao_preparar_comissao_consulta before insert or update on public.comissao_consultas
  for each row execute function public.preparar_comissao_consulta();

alter table public.comissao_consultas enable row level security;
revoke all on table public.comissao_consultas from public, anon, authenticated;
grant select on table public.comissao_consultas to authenticated;
grant insert (mes, dados) on table public.comissao_consultas to authenticated;
grant update (dados, conferido_em) on table public.comissao_consultas to authenticated;

drop policy if exists comissao_consultas_admin_le on public.comissao_consultas;
create policy comissao_consultas_admin_le on public.comissao_consultas for select to authenticated using (public.eh_aprovador());
drop policy if exists comissao_consultas_admin_cria on public.comissao_consultas;
create policy comissao_consultas_admin_cria on public.comissao_consultas for insert to authenticated with check (public.eh_aprovador());
drop policy if exists comissao_consultas_admin_altera on public.comissao_consultas;
create policy comissao_consultas_admin_altera on public.comissao_consultas for update to authenticated
  using (public.eh_aprovador()) with check (public.eh_aprovador());
