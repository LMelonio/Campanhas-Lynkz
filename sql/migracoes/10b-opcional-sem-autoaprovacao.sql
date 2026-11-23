-- ============================================================
--  10b — OPCIONAL: o aprovador não decide a própria campanha.
--
--  Controle de segregação de funções: quem pede não aprova. Só rode se
--  houver pelo menos DOIS aprovadores (senão as campanhas do único
--  aprovador ficam sem ninguém para decidir).
--  Desfazer: drop trigger ao_bloquear_autoaprovacao on public.campanhas;
-- ============================================================
create or replace function public.bloquear_autoaprovacao()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and new.status <> old.status and old.solicitante_id = auth.uid() then
    raise exception 'Você não pode decidir a própria campanha. Outro aprovador decide.';
  end if;
  return new;
end $$;
revoke execute on function public.bloquear_autoaprovacao() from public, anon, authenticated;
drop trigger if exists ao_bloquear_autoaprovacao on public.campanhas;
create trigger ao_bloquear_autoaprovacao before update on public.campanhas
  for each row execute function public.bloquear_autoaprovacao();
