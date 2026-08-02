"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { useDeskGate } from "@/components/desk/desk-gate";
import type {
  DeskCampaignListItem,
  DeskHollowFilter,
} from "@/lib/desk/hollow-types";
import type { DeskRegisterMemberListItem } from "@/lib/desk/register-types";
import type { HollowRewardType } from "@/lib/greenwood/hollow/types";
import { ROBINHOOD_CHAIN_ID } from "@/lib/treasury/chain-definition";

const FILTERS: { id: DeskHollowFilter; label: string }[] = [
  { id: "all", label: "all" },
  { id: "requires_attention", label: "attention" },
  { id: "draft", label: "draft" },
  { id: "resolved", label: "resolved" },
  { id: "available", label: "available" },
  { id: "completed", label: "completed" },
  { id: "completed_partial", label: "partial" },
  { id: "cancelled", label: "cancelled" },
  { id: "leaf", label: "LEAF" },
  { id: "on_chain", label: "on-chain" },
];

function readQueryParam(key: string): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get(key) ?? "";
}

type SelectedProfile = {
  profileId: string;
  displayName: string;
  outlawNumberLabel: string;
  greenwoodMember: boolean;
  sigil: DeskRegisterMemberListItem["sigil"];
};

export function DeskHollowBoard() {
  const { getAuthHeaders } = useDeskGate();
  const [filter, setFilter] = useState<DeskHollowFilter>(() => {
    const raw = readQueryParam("filter") as DeskHollowFilter;
    const allowed: DeskHollowFilter[] = [
      "all",
      "draft",
      "resolved",
      "available",
      "completed",
      "completed_partial",
      "cancelled",
      "leaf",
      "on_chain",
      "requires_attention",
    ];
    return allowed.includes(raw) ? raw : "all";
  });
  const [items, setItems] = useState<DeskCampaignListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(
    () => Boolean(readQueryParam("gathering") || readQueryParam("profile")),
  );

  const [title, setTitle] = useState("Hollow remembrance");
  const [reason, setReason] = useState("left for those who raised a hand");
  const [rewardType, setRewardType] = useState<HollowRewardType>("leaf");
  const [amount, setAmount] = useState("25");
  const [gatheringId, setGatheringId] = useState(() => readQueryParam("gathering"));
  const [tokenSymbol, setTokenSymbol] = useState("ETH");
  const [tokenContract, setTokenContract] = useState("");
  const [selected, setSelected] = useState<SelectedProfile[]>([]);
  const [searchQ, setSearchQ] = useState("");
  const [searchHits, setSearchHits] = useState<DeskRegisterMemberListItem[]>([]);
  const [searching, setSearching] = useState(false);
  const initialProfile = useMemo(() => readQueryParam("profile"), []);

  const load = useCallback(async () => {
    setError(null);
    const headers = await getAuthHeaders();
    if (!headers) {
      setItems([]);
      setError("Could not open The Hollow.");
      return;
    }
    const response = await fetch(
      `/api/desk/hollow/campaigns?filter=${encodeURIComponent(filter)}`,
      { headers, cache: "no-store" },
    );
    const data = (await response.json()) as {
      ok?: boolean;
      campaigns?: DeskCampaignListItem[];
      error?: string;
    };
    if (!response.ok || !data.ok) {
      setError(data.error ?? "Could not load campaigns.");
      setItems([]);
      return;
    }
    setItems(data.campaigns ?? []);
  }, [filter, getAuthHeaders]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void load();
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (!initialProfile) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        const headers = await getAuthHeaders();
        if (!headers) return;
        const response = await fetch(`/api/desk/register/${initialProfile}`, {
          headers,
          cache: "no-store",
        });
        if (!response.ok) return;
        const data = (await response.json()) as {
          member?: DeskRegisterMemberListItem & { profileId: string };
        };
        if (!data.member) return;
        setSelected([
          {
            profileId: data.member.profileId,
            displayName: data.member.displayName,
            outlawNumberLabel: data.member.outlawNumberLabel,
            greenwoodMember: data.member.greenwoodMember,
            sigil: data.member.sigil,
          },
        ]);
      })();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [getAuthHeaders, initialProfile]);

  async function searchRegister() {
    const q = searchQ.trim();
    if (!q) {
      setSearchHits([]);
      return;
    }
    setSearching(true);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const response = await fetch(
        `/api/desk/register?q=${encodeURIComponent(q)}&limit=8`,
        { headers, cache: "no-store" },
      );
      const data = (await response.json()) as {
        members?: DeskRegisterMemberListItem[];
      };
      if (!response.ok) {
        setSearchHits([]);
        return;
      }
      setSearchHits(data.members ?? []);
    } finally {
      setSearching(false);
    }
  }

  function addProfile(member: DeskRegisterMemberListItem) {
    setSelected((prev) => {
      if (prev.some((p) => p.profileId === member.profileId)) return prev;
      return [
        ...prev,
        {
          profileId: member.profileId,
          displayName: member.displayName,
          outlawNumberLabel: member.outlawNumberLabel,
          greenwoodMember: member.greenwoodMember,
          sigil: member.sigil,
        },
      ];
    });
  }

  function removeProfile(profileId: string) {
    setSelected((prev) => prev.filter((p) => p.profileId !== profileId));
  }

  async function createDraft(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;

      const onChain = rewardType === "eth" || rewardType === "erc20";
      const amountPerRecipient =
        rewardType === "informational" ? null : Number(amount);
      const fromGathering = gatheringId.trim().length > 0;

      const path = fromGathering
        ? `/api/desk/hollow/campaigns/from-gathering/${gatheringId.trim()}`
        : "/api/desk/hollow/campaigns";

      const body = fromGathering
        ? {
            title,
            reason,
            rewardType,
            amountPerRecipient,
            assetSymbol: onChain
              ? rewardType === "eth"
                ? "ETH"
                : tokenSymbol.trim() || null
              : null,
            assetChainId: onChain ? ROBINHOOD_CHAIN_ID : null,
            assetContractAddress:
              rewardType === "erc20" ? tokenContract.trim() || null : null,
          }
        : {
            title,
            reason,
            rewardType,
            amountPerRecipient,
            recipientRule: "manual_profiles" as const,
            profileIds: selected.map((p) => p.profileId),
            assetSymbol: onChain
              ? rewardType === "eth"
                ? "ETH"
                : tokenSymbol.trim() || null
              : null,
            assetChainId: onChain ? ROBINHOOD_CHAIN_ID : null,
            assetContractAddress:
              rewardType === "erc20" ? tokenContract.trim() || null : null,
          };

      if (!fromGathering && selected.length === 0) {
        setError("Select at least one Register member.");
        return;
      }

      const response = await fetch(path, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      const data = (await response.json()) as {
        error?: string;
        campaign?: { id: string };
      };
      if (!response.ok || !data.campaign) {
        setError(data.error ?? "Could not create campaign.");
        return;
      }
      setStatus("Draft created. Recipients are not frozen yet.");
      setShowCreate(false);
      await load();
      window.location.assign(`/desk/hollow/${data.campaign.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="desk-hollow" aria-label="The Hollow">
      <div className="desk-hollow__head">
        <h2 className="desk-section-title">THE HOLLOW</h2>
        <button type="button" className="btn-text" onClick={() => void load()}>
          [ refresh ]
        </button>
        <button
          type="button"
          className="btn-text"
          onClick={() => setShowCreate((v) => !v)}
        >
          {showCreate ? "[ hide create ]" : "[ create campaign ]"}
        </button>
      </div>
      <p className="muted">
        Reward campaigns for The Hollow. Members claim LEAF themselves. On-chain
        sends are recorded by hand — never signed here.
      </p>
      {status ? <p>{status}</p> : null}
      {error ? <p className="muted">{error}</p> : null}

      <div className="desk-register__filters" role="tablist" aria-label="Filter">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={
              filter === f.id ? "btn-text desk-hollow__filter--active" : "btn-text"
            }
            onClick={() => setFilter(f.id)}
          >
            [{f.label}]
          </button>
        ))}
      </div>

      {showCreate ? (
        <form className="desk-gatherings__form" onSubmit={(e) => void createDraft(e)}>
          <h3 className="desk-overview__group-title">CREATE CAMPAIGN</h3>
          <label className="desk-register__field">
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <label className="desk-register__field">
            Reason
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <label className="desk-register__field">
            Reward type
            <select
              value={rewardType}
              onChange={(e) => setRewardType(e.target.value as HollowRewardType)}
            >
              <option value="leaf">LEAF</option>
              <option value="eth">ETH</option>
              <option value="erc20">ERC-20</option>
              <option value="informational">informational</option>
            </select>
          </label>
          {rewardType !== "informational" ? (
            <label className="desk-register__field">
              Amount per recipient
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="numeric"
                required
              />
            </label>
          ) : null}
          {rewardType === "eth" || rewardType === "erc20" ? (
            <>
              <p className="muted">
                Chain: Robinhood Chain ({ROBINHOOD_CHAIN_ID}). Transfers are not
                sent from The Desk.
              </p>
              {rewardType === "erc20" ? (
                <>
                  <label className="desk-register__field">
                    Token symbol
                    <input
                      value={tokenSymbol}
                      onChange={(e) => setTokenSymbol(e.target.value)}
                    />
                  </label>
                  <label className="desk-register__field">
                    Token contract
                    <input
                      value={tokenContract}
                      onChange={(e) => setTokenContract(e.target.value)}
                    />
                  </label>
                </>
              ) : null}
            </>
          ) : null}

          <label className="desk-register__field">
            Closed Gathering ID (optional — uses final open hands)
            <input
              value={gatheringId}
              onChange={(e) => setGatheringId(e.target.value)}
              placeholder="leave empty for manual Register selection"
            />
          </label>

          {!gatheringId.trim() ? (
            <div>
              <h4 className="desk-overview__group-title">REGISTER MEMBERS</h4>
              <div className="desk-register__filters">
                <label className="desk-register__field">
                  Search
                  <input
                    value={searchQ}
                    onChange={(e) => setSearchQ(e.target.value)}
                    placeholder="name, number, wallet, X"
                  />
                </label>
                <button
                  type="button"
                  className="btn-text"
                  disabled={searching}
                  onClick={() => void searchRegister()}
                >
                  [ search ]
                </button>
              </div>
              {searchHits.length > 0 ? (
                <ul className="desk-member__list">
                  {searchHits.map((m) => (
                    <li key={m.profileId}>
                      {m.sigil ? (
                        <pre
                          className="ascii desk-register__sigil"
                          aria-label={m.sigil.a11yLabel}
                        >
                          {m.sigil.asciiBody}
                        </pre>
                      ) : null}
                      {m.displayName} · {m.outlawNumberLabel}
                      {m.greenwoodMember ? " · Greenwood" : ""} ·{" "}
                      <button
                        type="button"
                        className="btn-text"
                        onClick={() => addProfile(m)}
                      >
                        [ add ]
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {selected.length === 0 ? (
                <p className="muted">No members selected.</p>
              ) : (
                <ul className="desk-member__list">
                  {selected.map((m) => (
                    <li key={m.profileId}>
                      {m.displayName} · {m.outlawNumberLabel} ·{" "}
                      <button
                        type="button"
                        className="btn-text"
                        onClick={() => removeProfile(m.profileId)}
                      >
                        [ remove ]
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="muted">
              Recipients will be final open hands on the closed Gathering. Draft
              creation does not freeze them.
            </p>
          )}

          <button type="submit" className="btn-text" disabled={busy}>
            [ create draft ]
          </button>
        </form>
      ) : null}

      <p className="desk-divider" aria-hidden>
        ────────────────────
      </p>

      {items === null ? (
        <p className="muted">…</p>
      ) : items.length === 0 ? (
        <p className="muted">No campaigns in this view.</p>
      ) : (
        <ul className="desk-member__list">
          {items.map((c) => (
            <li key={c.id}>
              <Link href={`/desk/hollow/${c.id}`} className="desk-register__name">
                {c.title}
              </Link>
              {" · "}
              {c.rewardType} · {c.status}
              {c.amountPerRecipient != null
                ? ` · ${c.amountPerRecipient}${c.assetSymbol ? ` ${c.assetSymbol}` : ""}`
                : ""}
              {" · "}
              {c.recipientCount} recipients
              {c.requiresAttention ? " · needs attention" : ""}
              {c.statusCounts.claimed > 0
                ? ` · claimed ${c.statusCounts.claimed}`
                : ""}
              {c.statusCounts.awaitingSend > 0
                ? ` · awaiting send ${c.statusCounts.awaitingSend}`
                : ""}
              {c.gatheringTitle ? ` · ${c.gatheringTitle}` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
