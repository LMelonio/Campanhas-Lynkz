-- ============================================================
--  04 — ROLLBACK: desfaz a gestão de empresas e balconistas
--
--  ATENÇÃO: apaga as tabelas empresas e balconistas (e o que foi
--  cadastrado nelas) e as colunas campanhas.empresa_id / balconista_id.
--  As campanhas continuam intactas, com o nome da empresa em "cliente".
--  Antes de rodar, faça backup (Database → Backups) ou exporte as duas
--  tabelas em CSV pelo Table Editor.
--
--  Depois do rollback, publique de novo o app v1.3.1.
-- ============================================================
begin;
set local lock_timeout = '5s';

drop trigger if exists ao_vincular_campanha on public.campanhas;
drop function if exists public.vincular_campanha();

-- A view depende das colunas: sai antes delas e volta refeita sem elas.
drop view if exists public.campanhas_app;
alter table public.campanhas drop column if exists balconista_id;
alter table public.campanhas drop column if exists empresa_id;

-- Recria view e permissões por coluna (mesmas regras da parte B).
select public.reaplicar_permissoes_campanhas();
drop function if exists public.reaplicar_permissoes_campanhas();

-- Sair da tabela também tira ela da publicação de tempo real.
drop table if exists public.balconistas;
drop table if exists public.empresas;
drop function if exists public.carimbar_atualizacao();

commit;
