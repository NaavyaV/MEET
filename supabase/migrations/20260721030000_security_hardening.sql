-- Keep trigger-only functions out of the public Data API and ensure views
-- evaluate the caller's RLS policies rather than the migration owner's.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

revoke execute on function public.request_connection_by_identifier(text) from public, anon;
grant execute on function public.request_connection_by_identifier(text) to authenticated;

alter view public.public_profiles set (security_invoker = true);
