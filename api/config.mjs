export default function handler(_request, response) {
  const supabaseUrl = process.env.SUPABASE_URL || "";
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";

  response.setHeader("Cache-Control", "no-store");
  response.status(200).json({
    enabled: Boolean(supabaseUrl && supabaseAnonKey),
    supabaseUrl,
    supabaseAnonKey,
  });
}
