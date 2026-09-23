/**
 * Reserved system profile that anonymous ("no account needed") reports are
 * attributed to in the database, so `reports.user_id` can stay NOT NULL with
 * its existing FK to `dbo.profiles`. Nobody signs into this profile - see the
 * migration in database/sql-schema.mjs for how the row is seeded.
 */
export const ANONYMOUS_PROFILE_ID = "00000000-0000-4000-8000-000000000001";
