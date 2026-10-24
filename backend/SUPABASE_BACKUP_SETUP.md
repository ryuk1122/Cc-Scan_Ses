# Supabase backup mirror

MongoDB remains the live database. The API keeps a small durable outbox in MongoDB and mirrors event metadata, event registrations, operator access changes, and device-revocation actions to Supabase when connectivity is available. Failed sends retry with exponential backoff; they do not fail or delay the main scan response. Raw barcodes, document photos, dates of birth, phone numbers, and other unrelated fields are not mirrored.

1. In the Supabase SQL editor, run `supabase_backup.sql`.
2. Configure these variables on the backend host (never in Expo or the APK):

   - `SUPABASE_URL`: project Data API URL, such as `https://<project-ref>.supabase.co`
   - `SUPABASE_SECRET_KEY`: a server-only Supabase secret key

3. Restart the backend and confirm its logs report successful backup batches. Without these two variables, scanning continues normally and the mirror remains disabled.

The Supabase table has RLS enabled and direct grants revoked from `anon` and `authenticated`. Only the trusted backend uses the secret key. Supabase's managed database backups are a separate protection layer; this mirror is for lightweight record recovery, not a replacement for the primary MongoDB database or a full database snapshot.
