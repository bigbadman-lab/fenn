import Link from "next/link";

import { FirePresenceProvider } from "@/components/shell/fire-presence-provider";
import { ShellAuthControls } from "@/components/shell/shell-auth-controls";
import { ShellFireStatus } from "@/components/shell/shell-fire-status";
import { ShellReturn } from "@/components/shell/shell-return";
import { SiteFooter } from "@/components/shell/site-footer";

type ApplicationShellProps = {
  children: React.ReactNode;
};

export function ApplicationShell({ children }: ApplicationShellProps) {
  return (
    <FirePresenceProvider>
      <div className="shell">
        <div className="shell__inner">
          <header className="shell__brand">
            <div className="shell__brand-row">
              <Link href="/" className="shell__identity-link">
                <pre className="shell__identity ascii" aria-label="VELL home">
                  {`VELL`}
                </pre>
              </Link>
              <div className="shell__controls">
                <ShellFireStatus />
                <ShellAuthControls />
              </div>
            </div>
            <p className="shell__tag">
              <Link href="/">a clearing where the road forks</Link>
            </p>
          </header>

          <ShellReturn />

          <main className="shell__main">{children}</main>

          <SiteFooter />
        </div>
      </div>
    </FirePresenceProvider>
  );
}
