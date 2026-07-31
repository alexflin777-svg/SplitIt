-- Supabase Migration: SplitIT Core Database Schema
-- Version: 20260731000000

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY,
    full_name TEXT NOT NULL,
    avatar_url TEXT,
    phone TEXT,
    email TEXT,
    telegram_id TEXT,
    default_currency TEXT DEFAULT 'RUB',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    category TEXT DEFAULT 'trip',
    default_currency TEXT DEFAULT 'RUB',
    created_by UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.group_members (
    group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'member',
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.exchange_rates (
    from_currency TEXT NOT NULL,
    to_currency TEXT NOT NULL,
    rate NUMERIC(14, 6) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (from_currency, to_currency)
);

CREATE TABLE IF NOT EXISTS public.expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE,
    paid_by_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'RUB',
    exchange_rate NUMERIC(14, 6) DEFAULT 1.0,
    amount_in_group_currency NUMERIC(12, 2) NOT NULL,
    category TEXT DEFAULT 'food',
    split_type TEXT DEFAULT 'equal',
    receipt_url TEXT,
    ocr_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.expense_splits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_id UUID REFERENCES public.expenses(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    amount_owed NUMERIC(12, 2) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE,
    payer_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    payee_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    amount NUMERIC(12, 2) NOT NULL,
    currency TEXT DEFAULT 'RUB',
    payment_method TEXT DEFAULT 'sbp',
    proof_url TEXT,
    status TEXT DEFAULT 'completed',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.group_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE,
    invite_code TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ,
    created_by UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS (Row Level Security) Policies
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public select profiles" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Allow individual update profiles" ON public.profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Allow group members to read groups" ON public.groups FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.group_members WHERE group_id = groups.id AND user_id = auth.uid())
    OR created_by = auth.uid()
);

CREATE POLICY "Allow all actions for demo/authenticated" ON public.groups FOR ALL USING (true);
CREATE POLICY "Allow all actions for demo members" ON public.group_members FOR ALL USING (true);
CREATE POLICY "Allow all actions for demo expenses" ON public.expenses FOR ALL USING (true);
CREATE POLICY "Allow all actions for demo splits" ON public.expense_splits FOR ALL USING (true);
CREATE POLICY "Allow all actions for demo settlements" ON public.settlements FOR ALL USING (true);
