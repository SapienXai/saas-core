# Production

Configure a dedicated Supabase project, apply ordered migrations, set strict
server-only secrets, configure Supabase Auth redirect/SMTP, register Paddle
prices and webhook signing, configure Resend, VAPID and the domain provider.
Run Core Lab only behind an operator boundary.

Before rollout, verify RLS with two real users, migration history, webhook
replay/out-of-order handling, rate limits, audit writes, backup/restore and
provider reconciliation. This repository does not publish packages or mutate
external infrastructure automatically.
