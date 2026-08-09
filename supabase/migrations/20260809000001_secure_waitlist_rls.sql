-- Drop the overly permissive select policy
DROP POLICY "Allow authenticated read waitlist" ON public.waitlist;

-- Create a stricter policy (e.g., nobody from the client can read it, only service_role)
-- OR if we must, only a specific admin email. For now, deny all client reads to be safe.
CREATE POLICY "Deny client read waitlist" ON public.waitlist
    FOR SELECT TO authenticated
    USING (false);
