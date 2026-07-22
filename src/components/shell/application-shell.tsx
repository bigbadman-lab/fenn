import Link from "next/link";

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
          <pre className="shell__identity ascii" aria-label="FENN">
            {`FENN`}
          </pre>
          <p className="shell__tag">
            <Link href="/">an old corner of the wood</Link>
          </p>
        </header>

        <SiteNav />

        <main className="shell__main">{children}</main>

        <SiteFooter />
      </div>
    </div>
  );
}
