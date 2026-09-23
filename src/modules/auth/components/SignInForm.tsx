export function SignInForm({ configured, registrationOpen, failed = false }: {
  configured: boolean; registrationOpen: boolean; failed?: boolean;
}) {
  return <>
    {!registrationOpen && <p className="field-hint">Registration is closed. Only invited Google accounts can join this test deployment.</p>}
    {failed && <p className="form-error" role="alert">Sign-in could not be completed. Start again with an invited Google account. An expired or already-used sign-in link cannot be reused.</p>}
    {!configured && <p className="field-hint">Google sign-in is not configured yet. You can still explore the map.</p>}
    <form action="/api/auth/sign-in" method="get" className="auth-form">
      <button className="button button-primary" disabled={!configured}>Continue with Google</button>
    </form>
    <p className="field-hint">No app password or confirmation email. Your Google name and email are never your public username. Sessions last at most 24 hours.</p>
  </>;
}
