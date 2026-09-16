// Build-time prevention of accidentally publishing a privileged provider key.
function validateOwnerPublicConfig(env) {
  const url=env.VITE_SUPABASE_URL, key=env.VITE_SUPABASE_ANON_KEY;
  if(!url&&!key)return;
  if(!url||!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url)||!key)throw new Error('Owner build needs its public Supabase URL and public key together');
  if(/^sb_publishable_[A-Za-z0-9_-]{12,}$/.test(key))return;
  let role;
  try{const parts=key.split('.');if(parts.length===3)role=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8')).role;}catch{}
  if(role!=='anon')throw new Error('Owner build rejected a non-public key. Never put a server or service-role credential in VITE settings.');
}
module.exports={validateOwnerPublicConfig};
