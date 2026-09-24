import { GoogleIcon } from "@/lib/components/GoogleIcon";

export function SignInForm({ configured, registrationOpen, failed = false }: {
  configured: boolean; registrationOpen: boolean; failed?: boolean;
}) {
  return <>
    {!registrationOpen && <p className="field-hint">Registration is closed. Only invited Google accounts can join this test deployment.</p>}
    {failed && <p className="form-error" role="alert">Sign-in could not be completed. Start again with an invited Google account. An expired or already-used sign-in link cannot be reused.</p>}
    {!configured && <p className="field-hint">Google sign-in is not configured yet on this deployment. You can still explore the map.</p>}
    <form action="/api/auth/sign-in" method="get" className="auth-form">
      <button className="button button-google" disabled={!configured}>
        <GoogleIcon /> <span>Sign in with your Google account</span>
      </button>
      <p className="field-hint google-hint">Uses whichever Google or Gmail account you&apos;re already signed into.</p>
    </form>
    <p className="field-hint"><strong>You stay pseudonymous either way</strong> - straight after signing in you pick your own public username, and your Google name and email are never shown or used as it. No app password or confirmation email needed. Sessions last at most 24 hours.</p>
  </>;
}
