import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import assert from 'node:assert/strict';

const envText = fs.readFileSync('.env.local', 'utf-8');
const extractEnv = (key) => {
  const match = envText.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match ? match[1].trim() : null;
};

const supabaseUrl = extractEnv('NEXT_PUBLIC_SUPABASE_URL');
const supabaseKey = extractEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in .env.local");
  process.exit(1);
}

// Helper to create a client for a specific user
const getClient = () => createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

const generateRandomStr = () => Math.random().toString(36).substring(2, 10);

async function runTest() {
  console.log("Starting Live Multi-User Test...");
  
  const clientA = getClient();
  const clientB = getClient();

  const emailA = `test-a-${generateRandomStr()}@example.com`;
  const emailB = `test-b-${generateRandomStr()}@example.com`;
  const password = "Password123!";

  console.log(`1. Registering User A (${emailA})`);
  const { data: authA, error: errA } = await clientA.auth.signUp({
    email: emailA, password, options: { data: { full_name: "Alice Synthetic" } }
  });
  if (errA) throw new Error(`User A signup failed: ${errA.message}`);

  console.log(`2. Registering User B (${emailB})`);
  const { data: authB, error: errB } = await clientB.auth.signUp({
    email: emailB, password, options: { data: { full_name: "Bob Synthetic" } }
  });
  if (errB) throw new Error(`User B signup failed: ${errB.message}`);

  console.log("3. User A creates a group");
  const { data: groupData, error: errGroup } = await clientA.rpc('create_group_with_owner', {
    p_name: "Multi-User Test Trip",
    p_category: "trip",
    p_default_currency: "USD"
  });
  if (errGroup) throw new Error(`Group creation failed: ${errGroup.message}`);
  const groupId = groupData;
  console.log(`   Group created: ${groupId}`);

  console.log("4. User A creates an invite link");
  const { data: inviteData, error: errInvite } = await clientA
    .from('group_invites')
    .insert({ group_id: groupId, invite_code: generateRandomStr().toUpperCase(), created_by: authA.user.id })
    .select('invite_code')
    .single();
  if (errInvite) throw new Error(`Invite creation failed: ${errInvite.message}`);
  const inviteCode = inviteData.invite_code;
  console.log(`   Invite code: ${inviteCode}`);

  console.log("5. User B attempts to redeem invite");
  const { data: redeemData, error: errRedeem } = await clientB.rpc('redeem_group_invite', {
    p_invite_code: inviteCode
  });
  if (errRedeem) throw new Error(`Invite redemption failed: ${errRedeem.message}`);
  assert.equal(redeemData, groupId, "Redeemed group ID should match original");
  console.log("   Invite redeemed successfully!");

  console.log("6. Both users fetch the group details");
  const { data: getGroupA, error: errGetA } = await clientA.from('groups').select('*').eq('id', groupId).single();
  assert.equal(getGroupA.name, "Multi-User Test Trip", "User A should see the group");
  
  const { data: getGroupB, error: errGetB } = await clientB.from('groups').select('*').eq('id', groupId).single();
  assert.equal(getGroupB.name, "Multi-User Test Trip", "User B should see the group");

  console.log("7. User A adds an expense via RPC");
  const { data: expA, error: errExpA } = await clientA.rpc('add_expense_with_splits', {
    p_group_id: groupId,
    p_paid_by_id: authA.user.id,
    p_title: "Dinner",
    p_amount: 100,
    p_currency: "USD",
    p_amount_in_group_currency: 100,
    p_category: "food",
    p_created_at: new Date().toISOString(),
    p_splits: [
        { user_id: authA.user.id, amount_owed: 50 },
        { user_id: authB.user.id, amount_owed: 50 }
    ]
  });
  if (errExpA) throw new Error(`Expense creation failed: ${errExpA.message}`);
  console.log(`   Expense added: ${expA}`);

  console.log("8. User B fetches expenses to verify visibility");
  const { data: expB, error: errExpGetB } = await clientB.from('expenses').select('*').eq('group_id', groupId);
  assert.equal(expB.length, 1, "User B should see 1 expense");
  assert.equal(expB[0].title, "Dinner", "User B should see the Dinner expense");

  console.log("✅ All live multi-user tests passed successfully!");
}

runTest().catch(e => {
  console.error(e);
  process.exit(1);
});
