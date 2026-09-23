// Shared helpers used by the portal's serverless functions.
const { createClient } = require('@supabase/supabase-js');

function getServiceClient() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// Verifies the caller's Supabase access token (sent by the browser as
// "Authorization: Bearer <token>") and returns the authenticated user, or
// null if the token is missing/invalid.
async function getCallerUser(event, supabaseAdmin) {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length);
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

async function isAdminEmail(supabaseAdmin, email) {
  if (!email) return false;
  const { data, error } = await supabaseAdmin
    .from('admins')
    .select('email')
    .eq('email', email)
    .maybeSingle();
  if (error) return false;
  return !!data;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

module.exports = { getServiceClient, getCallerUser, isAdminEmail, json };
