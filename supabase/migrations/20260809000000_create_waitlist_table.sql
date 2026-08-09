CREATE TABLE public.waitlist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

-- Allow anonymous inserts (so anyone can join the waitlist)
CREATE POLICY "Allow anonymous inserts to waitlist" ON public.waitlist
    FOR INSERT TO anon, authenticated
    WITH CHECK (true);

-- Only authenticated users (admins) can view the waitlist
CREATE POLICY "Allow authenticated read waitlist" ON public.waitlist
    FOR SELECT TO authenticated
    USING (true);
