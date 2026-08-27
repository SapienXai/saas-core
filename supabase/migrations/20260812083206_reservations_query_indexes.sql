-- Supports the management seating/dashboard pattern:
-- restaurant scope + reservation date/status equality, then time ordering.
-- The existing index stops at reservation_date, which leaves Postgres to sort
-- matching rows by reservation_time as the reservations table grows.
create index if not exists idx_reservations_restaurant_date_status_time
  on public.reservations (restaurant_id, reservation_date, status, reservation_time, created_at);
