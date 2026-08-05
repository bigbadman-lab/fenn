# Clearing — abuse surface (1.0D)

## Mitigated

| Vector | Control |
|--------|---------|
| Cookie tamper / forged id | HMAC; timing-safe verify; bad → null |
| Expired cookie | `exp` check |
| Oversized cookie blob | max length gate |
| Traveller spoof / client author fields | ignored |
| Body XSS | plain text React render; no `dangerouslySetInnerHTML` |
| Huge JSON | Content-Length + body byte cap |
| Bad content-type | 415 |
| Traveller 3-cap race | `FOR UPDATE` + count accepted (published\|hidden) |
| Rate limit race | `consume_clearing_rate_bucket` atomic upsert |
| Public mod data | no public DTO fields; log private |
| Desk spoof | `requireFennDeskAccess` wallet allowlist |
| Hide frees slots | accepted count includes **hidden** |
| Service-role cookie fallback in prod | **disabled**; dedicated secret required |

## Residual (by design for anonymous road)

- **New Traveller mint after cookie clear** — new identity + new 3 posts; mitigated by network mint window, not eliminated.
- **Multiple networks / VPNs** — inflate mint and post budgets.
- **Human spam within limits** — Desk mute/ban/read-only.
- **Compromised browser with valid cookie** — can use remaining Traveller allowance; cannot read service role, Desk, or other travellers’ cookies.
- **Compromised Outlaw session** — can post as that Outlaw until moderated (Clearing-only mute/ban).

## Cannot “bypass the whole abuse system” from one browser alone

Requires either:

- Desk/Wallet compromise, or
- API secrets leaked, or
- unbounded mint + many distinct network keys.

Launch lever: **read-only + slow mode + Desk hide/mute**.
