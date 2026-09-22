const userId = "20000000-0000-4000-8000-000000000001";
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.pathname === "/auth/v1/user") {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (headers.get("Authorization") !== "Bearer photo-fixture-session") return Response.json({ message: "Invalid synthetic session" }, { status: 401 });
    return Response.json({
      id: userId, email: "synthetic@example.invalid", aud: "authenticated", role: "authenticated",
      email_confirmed_at: "2026-01-01T00:00:00Z",
    });
  }
  if (url.pathname === "/rest/v1/profiles" && url.searchParams.get("id") === `eq.${userId}`) {
    return Response.json({ display_name: "river_walker", username_policy_checked_at: "2026-01-01", is_banned: false });
  }
  if (url.pathname === "/rest/v1/rpc/consume_content_policy_attempt") return Response.json(false);
  if (url.hostname === "127.0.0.1" && url.port === "3000") return nativeFetch(input, init);
  throw new Error("Unexpected network access in the synthetic upload fixture.");
};
