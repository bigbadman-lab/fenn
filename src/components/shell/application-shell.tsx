import Link from "next/link";

import { ShellAuthControls } from "@/components/shell/shell-auth-controls";
import { ShellReturn } from "@/components/shell/shell-return";
import { SiteFooter } from "@/components/shell/site-footer";
import { SiteNav } from "@/components/shell/site-nav";

type ApplicationShellProps = {
  children: React.ReactNode;
};

export function ApplicationShell({ children }: ApplicationShellProps) {
  return (
    <div className="shell">
      <div className="shell__inner">
        <header className="shell__brand">
          <div className="shell__brand-row">
            <Link href="/" className="shell__identity-link">
              <pre className="shell__identity ascii" aria-label="FENN home">
                {`FENN`}
              </pre>
            </Link>
            <ShellAuthControls />
          </div>
          <p className="shell__tag">
            <Link href="/">an old corner of the wood</Link>
          </p>
        </header>

        <SiteNav />
        <ShellReturn />

        <main className="shell__main">{children}</main>

        <SiteFooter />
      </div>
    </div>
  );
}
