ALTER TABLE public.appointment_bookings
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'appointment',
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS checkout_url text,
  ADD COLUMN IF NOT EXISTS checkout_amount_minor integer,
  ADD COLUMN IF NOT EXISTS checkout_fee_minor integer,
  ADD COLUMN IF NOT EXISTS checkout_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS checkout_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_state text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS preauthorisation jsonb;
ALTER TABLE public.appointment_bookings ADD CONSTRAINT appointment_bookings_kind_check CHECK (kind IN ('appointment','reservation','order'));
ALTER TABLE public.appointment_bookings ADD CONSTRAINT appointment_bookings_payment_state_check CHECK (payment_state IN ('none','checkout_ready','paid_confirmed','expired','abandoned'));
ALTER TABLE public.appointment_bookings DROP CONSTRAINT IF EXISTS appointment_bookings_status_check;
ALTER TABLE public.appointment_bookings ADD CONSTRAINT appointment_bookings_status_check CHECK (status IN ('searching','awaiting_confirmation','booking_in_progress','checkout_ready','expired','confirmed','failed','cancellation_requested','cancelled'));
ALTER TABLE public.appointment_bookings ADD CONSTRAINT appointment_bookings_checkout_https CHECK (checkout_url IS NULL OR checkout_url ~ '^https://');
COMMENT ON COLUMN public.appointment_bookings.details IS 'Category-specific booking/order details (party size, cuisine, dietary, recipient, vehicle...). Never payment card data.';