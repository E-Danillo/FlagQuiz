-- Conta existente: executar no SQL Editor uma vez para adicionar país e idade ao perfil.

alter table public.profiles add column if not exists country text;
alter table public.profiles add column if not exists age smallint;
alter table public.profiles drop constraint if exists profiles_age_range;
alter table public.profiles add constraint profiles_age_range check (
  age is null or (age >= 6 and age <= 120)
);
