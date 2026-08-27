-- Beach Area reservations require at least two guests.
UPDATE public.reservation_areas AS ra
SET min_party_size = 2,
    updated_at = now()
FROM public.restaurants AS r
WHERE ra.restaurant_id = r.id
  AND lower(trim(r.name)) = 'felix beach'
  AND lower(trim(ra.name)) IN ('beach', 'beach area')
  AND (ra.min_party_size IS NULL OR ra.min_party_size < 2);
