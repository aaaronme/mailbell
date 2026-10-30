import { ClientForm, RedirectUri, SETUP_GUIDE_URL } from '@/components/extra/ClientForm'
import { addAccount } from './SettingsPage'

function Link({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="text-foreground underline underline-offset-2" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 border-b border-foreground/10 px-4 py-3">
      <span className="w-4 shrink-0 text-foreground/40 tabular-nums">{n}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 className="font-medium">{title}</h3>
        <div className="flex flex-col gap-2 text-xs text-foreground/60">{children}</div>
      </div>
    </li>
  )
}

// First run with no OAuth client: the release ships without a shared one, so
// each user brings their own. Shown in place of the sign-in button.
export function SetupGuide() {
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 border-b border-foreground/10 px-4 py-5">
        <h2 className="font-display text-xl">Set up your Google client</h2>
        <p className="text-foreground/60">
          Google lets an app read Gmail only through an OAuth client registered in Google Cloud. Mailbell doesn't share
          one: you create your own, which is free and takes about five minutes. Your mail then goes only between this
          browser and Google, and nobody else's usage can lock you out.
        </p>
      </div>
      <ol>
        <Step n={1} title="Create a project and turn on the Gmail API">
          <p>
            In the Google Cloud console, <Link href="https://console.cloud.google.com/projectcreate">create a project</Link>{' '}
            (any name, such as “Mailbell”), then open the{' '}
            <Link href="https://console.cloud.google.com/apis/library/gmail.googleapis.com">Gmail API</Link> and click{' '}
            <strong className="font-medium text-foreground/80">Enable</strong>.
          </p>
        </Step>
        <Step n={2} title="Configure the consent screen">
          <p>
            Open <Link href="https://console.cloud.google.com/auth/overview">Google Auth Platform</Link> and click{' '}
            <strong className="font-medium text-foreground/80">Get started</strong>. Give it a name and your email, and
            choose <strong className="font-medium text-foreground/80">External</strong>.
          </p>
          <p>
            Under <strong className="font-medium text-foreground/80">Audience</strong>, either add your Google account as a
            test user (you'll sign in again every 7 days) or click{' '}
            <strong className="font-medium text-foreground/80">Publish app</strong> to skip that; no review is needed for
            your own use. Under <strong className="font-medium text-foreground/80">Data access</strong>, add the scope{' '}
            <code className="font-mono">gmail.modify</code>.
          </p>
        </Step>
        <Step n={3} title="Create the client">
          <p>
            Under <Link href="https://console.cloud.google.com/auth/clients">Clients</Link>, create a client of type{' '}
            <strong className="font-medium text-foreground/80">Web application</strong> and add this as an authorized
            redirect URI:
          </p>
          <RedirectUri />
        </Step>
        <Step n={4} title="Paste the client ID and secret">
          <ClientForm submitLabel="Save and sign in" onSaved={() => addAccount()} />
        </Step>
      </ol>
      <p className="px-4 py-3 text-xs text-foreground/40">
        Stuck? The <Link href={SETUP_GUIDE_URL}>full guide</Link> has screenshots-level detail and troubleshooting.
      </p>
    </div>
  )
}
