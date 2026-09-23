export function AdminSignIn({ configured, failed = false }: { configured: boolean; failed?: boolean }) {
  return <>
    {!configured && <p className="form-error" role="alert">Administrator sign-in is not configured. Access stays locked until the owner configures Google and both approved accounts.</p>}
    {failed && <p className="form-error" role="alert">Sign-in failed or this Google account is not an approved administrator. Start sign-in again.</p>}
    <form action="/api/auth/sign-in" method="get" className="report-form">
      <button className="button button-primary" disabled={!configured}>Continue with Google</button>
    </form>
    <p className="field-hint">No administrator registration or local dashboard bypass is available. Sessions expire after at most one hour.</p>
  </>;
}
