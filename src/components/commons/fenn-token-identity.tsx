import {
  FENN_TOKEN_PUBLIC_IDENTITY_ROWS,
  FENN_TOKEN_PUBLIC_TICKER,
} from "@/lib/treasury/fenn-token-public-identity";

/**
 * /commons — stable $FENN identity (no live mint address on the public surface).
 */
export function FennTokenIdentity() {
  return (
    <section className="commons-block" aria-labelledby="fenn-token-identity-heading">
      <h2 id="fenn-token-identity-heading" className="commons-block__label">
        {FENN_TOKEN_PUBLIC_TICKER}
      </h2>
      <div className="commons-block__body fenn-token-identity">
        <p className="commons-section__lede">
          on-chain token of the VELL world.
        </p>
        <p className="commons-section__aside muted">
          lives on Solana.
          <br />
          entered through PONS — a public gate, not a master.
        </p>

        <dl className="fenn-token-identity__facts">
          {FENN_TOKEN_PUBLIC_IDENTITY_ROWS.map((row) => (
            <div key={row.label} className="fenn-token-identity__row">
              <dt className="fenn-token-identity__label muted">{row.label}</dt>
              <dd className="fenn-token-identity__value">{row.value}</dd>
            </div>
          ))}
        </dl>

        <div className="fenn-token-identity__compare" aria-label="LEAF and $VELL">
          <h3 className="commons-subheading">LEAF IS NOT $VELL</h3>
          <div className="fenn-token-identity__columns">
            <div className="fenn-token-identity__col">
              <p className="fenn-token-identity__col-title">LEAF</p>
              <p className="muted">
                off-chain
                <br />
                standing · contribution · recognition
              </p>
            </div>
            <div className="fenn-token-identity__col">
              <p className="fenn-token-identity__col-title">$VELL</p>
              <p className="muted">
                on-chain
                <br />
                SPL · Solana
              </p>
            </div>
          </div>
          <p className="commons-section__aside muted fenn-token-identity__note">
            LEAF does not convert, redeem, or buy $VELL here.
          </p>
        </div>

        <p className="commons-section__aside muted fenn-token-identity__note">
          PONS is the launch route. It is not the Treasury. It is not the Purse.
          <br />
          The Purse is finite $VELL under VELL&apos;s keeping — not the Treasury.
          <br />
          Initial Purse means launch intent, not a permanent balance.
        </p>
      </div>
    </section>
  );
}
