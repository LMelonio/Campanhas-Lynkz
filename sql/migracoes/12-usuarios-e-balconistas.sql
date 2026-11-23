-- ============================================================
--  12 — USUÁRIOS NO APP E LIMITE DE BALCONISTAS (v2.8.0)
--
--  1. definir_perfil(): o administrador (papel "aprovador") libera contas,
--     desativa e escolhe quem é administrador ou usuário, pelo próprio app.
--     Ninguém mais precisa abrir o Table Editor do Supabase para isso.
--     - só o administrador ativo executa;
--     - ninguém tira o próprio acesso nem o próprio papel de administrador
--       (assim sempre sobra pelo menos um administrador);
--     - toda troca de papel e de acesso continua indo para auditoria_perfis.
--
--  2. Cada empresa tem no máximo 2 balconistas cadastrados, contando os
--     desativados. Vale para o app (usuário logado). Cargas pelo SQL
--     Editor ou pela chave service_role (planilhas antigas) não são barradas.
--     Empresas que já passam de 2 continuam como estão; só não recebem mais.
--
--  Pode rodar duas vezes. Desfazer: 12-rollback.sql. Depois: 12-validacao.sql.
--
--  PRIMEIRO ADMINISTRADOR: se ainda não existe nenhum, rode uma vez no
--  SQL Editor (troque o e-mail):
--    update public.perfis set papel = 'aprovador', ativo = true
--     where email = 'seu.email@lynkz.com.br';
--  Daí em diante, o resto é pelo app, no menu Usuários.
-- ============================================================

-- ---------- 1. usuários ----------
create or replace function public.definir_perfil(
  p_id    uuid,
  p_papel text    default null,
  p_ativo boolean default null,
  p_nome  text    default null
) returns public.perfis
language plpgsql security definer set search_path = public as $$
declare
  r      public.perfis;
  v_nome text := nullif(btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g')), '');
begin
  if not public.eh_aprovador() then
    raise exception 'Só um administrador muda usuários.' using errcode = '42501';
  end if;
  if p_papel is not null and p_papel not in ('aprovador', 'coordenador') then
    raise exception 'Papel inválido.';
  end if;
  if p_nome is not null and (v_nome is null or length(v_nome) < 2 or length(v_nome) > 80) then
    raise exception 'O nome precisa ter de 2 a 80 caracteres.';
  end if;
  if p_id = auth.uid() and ((p_papel is not null and p_papel <> 'aprovador') or p_ativo is false) then
    raise exception 'Você não pode tirar o seu próprio acesso de administrador. Peça a outro administrador.';
  end if;

  update public.perfis set
    papel = coalesce(p_papel, papel),
    ativo = coalesce(p_ativo, ativo),
    nome  = coalesce(v_nome, nome)
  where id = p_id
  returning * into r;

  if r.id is null then
    raise exception 'Usuário não encontrado.';
  end if;
  return r;
end $$;

revoke execute on function public.definir_perfil(uuid, text, boolean, text) from public, anon;
grant  execute on function public.definir_perfil(uuid, text, boolean, text) to authenticated;

-- ---------- 2. no máximo 2 balconistas por empresa ----------
create or replace function public.limitar_balconistas_empresa()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;   -- SQL Editor / cargas
  -- Fila por empresa: dois cadastros ao mesmo tempo não passam juntos do limite.
  perform pg_advisory_xact_lock(1202, new.empresa_id::int);
  if (select count(*) from public.balconistas where empresa_id = new.empresa_id) >= 2 then
    raise exception 'Esta empresa já tem 2 balconistas cadastrados, que é o limite. Edite um deles na ficha da empresa.';
  end if;
  return new;
end $$;
revoke execute on function public.limitar_balconistas_empresa() from public, anon, authenticated;
drop trigger if exists ao_limitar_balconistas_empresa on public.balconistas;
create trigger ao_limitar_balconistas_empresa before insert on public.balconistas
  for each row execute function public.limitar_balconistas_empresa();
