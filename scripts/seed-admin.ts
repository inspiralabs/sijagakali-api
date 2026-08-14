/**
 * Seed admin default: admin@sijagakali.com / admin123
 * Jalankan SEKALI setelah deploy migration:
 *   npm run seed:admin
 *
 * Idempoten: aman dijalankan berulang kali — skip jika sudah ada.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: 'sijagakali' },
  auth: { persistSession: false, autoRefreshToken: false },
});

const DEFAULT_EMAIL = 'admin@sijagakali.com';
const DEFAULT_PASSWORD = 'admin123';
const DEFAULT_DISPLAY_NAME = 'Administrator';

async function main() {
  console.log('Seeding default admin...');

  // Cek apakah email sudah ada di admins
  const { data: existing } = await supabase
    .from('admins')
    .select('id, email')
    .eq('email', DEFAULT_EMAIL)
    .maybeSingle();

  if (existing) {
    console.log(`Admin "${DEFAULT_EMAIL}" sudah ada (id: ${existing.id}). Skip.`);
    process.exit(0);
  }

  // Cek apakah user sudah ada di auth.users via admin API
  const { data: authList } = await supabase.auth.admin.listUsers();
  const existingAuth = authList?.users?.find((u) => u.email === DEFAULT_EMAIL);

  let userId: string;

  if (existingAuth) {
    console.log(`Auth user "${DEFAULT_EMAIL}" sudah ada, memakai id yang ada.`);
    userId = existingAuth.id;
  } else {
    // Buat user baru di Supabase Auth
    const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
      email: DEFAULT_EMAIL,
      password: DEFAULT_PASSWORD,
      email_confirm: true,
    });

    if (createErr || !newUser?.user) {
      console.error('Gagal membuat auth user:', createErr?.message);
      process.exit(1);
    }

    userId = newUser.user.id;
    console.log(`Auth user dibuat: ${userId}`);
  }

  // Insert ke sijagakali.admins
  const { error: insertErr } = await supabase.from('admins').insert({
    id: userId,
    email: DEFAULT_EMAIL,
    display_name: DEFAULT_DISPLAY_NAME,
    is_default: true,
  });

  if (insertErr) {
    console.error('Gagal insert ke admins:', insertErr.message);
    process.exit(1);
  }

  console.log(`Default admin seeded berhasil: ${DEFAULT_EMAIL} / ${DEFAULT_PASSWORD}`);
  console.log('PENTING: Ganti password setelah login pertama kali!');
}

main().catch((e) => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
