-- ============================================================
--  08 — NOTAS FISCAIS DA CAMPANHA (v2.4.0)
--
--  Na Nova campanha, o app consulta no Qlik quanto o cliente comprou do
--  laboratório (fornecedor) no período e lista as notas fiscais de venda.
--  O solicitante marca as notas que participam da campanha.
--
--  1. campanha_notas: uma linha por nota marcada (número, série, data, valor).
--     Só quem solicitou a campanha grava, e só enquanto ela está Pendente.
--     Ninguém altera nem apaga depois (igual ao resto: o registro é permanente).
--  2. campanhas.compras_periodo / compras_consultado_em: o total comprado
--     que o Qlik mostrou no momento do envio (para o aprovador conferir
--     mesmo se o Qlik mudar depois).
--
--  Só acrescenta. Pode rodar duas vezes. Desfazer: 08-rollback.sql.
--  Depois: 08-validacao.sql (todas as linhas com "t").
-- ============================================================

alter table public.campanhas add column if not exists compras_periodo       numeric(14,2);
alter table public.campanhas add column if not exists compras_consultado_em timestamptz;

create table if not exists public.campanha_notas (
  id            bigint generated always as identity primary key,
  campanha_id   bigint not null references public.campanhas(id) on delete cascade,
  numero        text not null,
  serie         text not null default '',
  data_emissao  date,
  valor         numeric(14,2) not null default 0,
  criado_em     timestamptz not null default now(),
  constraint campanha_notas_numero_valido check (btrim(numero) <> ''),
  constraint campanha_notas_unica unique (campanha_id, numero, serie)
);
create index if not exists idx_campanha_notas_campanha on public.campanha_notas (campanha_id);

alter table public.campanha_notas enable row level security;

drop policy if exists campanha_notas_leitura on public.campanha_notas;
create policy campanha_notas_leitura on public.campanha_notas
  for select to authenticated using (public.eh_ativo());

drop policy if exists campanha_notas_inclui on public.campanha_notas;
create policy campanha_notas_inclui on public.campanha_notas
  for insert to authenticated
  with check (
    public.eh_ativo()
    and exists (select 1 from public.campanhas c
                where c.id = campanha_id and c.solicitante_id = auth.uid() and c.status = 'Pendente')
  );
-- Sem policy de update/delete: nota marcada fica registrada.

revoke all on public.campanha_notas from anon;
revoke all on public.campanha_notas from authenticated;
grant select on public.campanha_notas to authenticated;
grant insert (campanha_id, numero, serie, data_emissao, valor) on public.campanha_notas to authenticated;

-- As colunas novas de campanhas entram no select da view e nos grants.
select public.reaplicar_permissoes_campanhas();
