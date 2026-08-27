-- Replace inherited Felix-only asset URLs before the files are removed from the app.
-- Existing restaurant rows remain intact; only stale presentation assets are reset.

update public.restaurants
set logo_url = null
where logo_url ~* '(^|/)felix\.png([?#].*)?$';

update public.restaurants
set primary_image_url = null
where primary_image_url ~* '(^|/)(beach[12]|marina[12]|selimiye[123])\.jpe?g([?#].*)?$'
   or primary_image_url ~* '/garden-oRA3ycYMsw6eyb1694bRzBCKGHaF6Y\.mp4([?#].*)?$';

update public.restaurant_media
set media_url = '/placeholder.svg'
where media_url ~* '(^|/)(beach[12]|marina[12]|selimiye[123])\.jpe?g([?#].*)?$'
   or media_url ~* '(^|/)felix\.png([?#].*)?$'
   or media_url ~* '/garden-oRA3ycYMsw6eyb1694bRzBCKGHaF6Y\.mp4([?#].*)?$';
