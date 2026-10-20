ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS reduce_motion boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS text_size text NOT NULL DEFAULT 'standard' CHECK (text_size IN ('standard','large','larger')),
  ADD COLUMN IF NOT EXISTS high_contrast boolean NOT NULL DEFAULT false;