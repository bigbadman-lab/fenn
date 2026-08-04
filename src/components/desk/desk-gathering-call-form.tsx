"use client";

import Link from "next/link";
import { useEffect, useId, useState, type FormEvent } from "react";

import { DeskGatheringPreview } from "@/components/desk/desk-gathering-preview";
import type {
  DeskGatheringDetail,
  DeskGatheringListItem,
} from "@/lib/desk/gatherings-types";
import {
  DEFAULT_GATHERING_ANNOUNCEMENT_STYLE,
  type GatheringAnnouncementStyle,
} from "@/lib/greenwood/gatherings/announcement-style";
import {
  GATHERING_DURATION_MAX_MINUTES,
  GATHERING_DURATION_MIN_MINUTES,
  GATHERING_DURATION_PRESETS,
  isValidGatheringDurationMinutes,
} from "@/lib/greenwood/gatherings/duration";

type CapacityMode = "unlimited" | "10" | "25" | "custom";
type DurationMode = "15" | "30" | "60" | "90" | "custom";

export type DeskGatheringCallFormProps = {
  getAuthHeaders: () => Promise<HeadersInit | null>;
  draftSeed?: DeskGatheringListItem | DeskGatheringDetail | null;
  onBegun: (gathering: DeskGatheringDetail) => void;
  onCancel?: () => void;
};

function seedDurationMinutes(
  seed: DeskGatheringListItem | DeskGatheringDetail | null | undefined,
): number {
  if (!seed) return 60;
  const s = Date.parse(seed.startsAt);
  const e = Date.parse(seed.endsAt);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 60;
  return Math.max(
    GATHERING_DURATION_MIN_MINUTES,
    Math.min(GATHERING_DURATION_MAX_MINUTES, Math.round((e - s) / 60_000)),
  );
}

function durationModeFromMinutes(minutes: number): DurationMode {
  if ((GATHERING_DURATION_PRESETS as readonly number[]).includes(minutes)) {
    return String(minutes) as DurationMode;
  }
  return "custom";
}

function capacityModeFromValue(value: number | null | undefined): CapacityMode {
  if (value == null) return "unlimited";
  if (value === 10) return "10";
  if (value === 25) return "25";
  return "custom";
}

/**
 * CALL A GATHERING — duration-based begin flow with live preview.
 */
export function DeskGatheringCallForm({
  getAuthHeaders,
  draftSeed = null,
  onBegun,
  onCancel,
}: DeskGatheringCallFormProps) {
  const errorId = useId();
  const [title, setTitle] = useState(draftSeed?.title ?? "");
  const [summary, setSummary] = useState(draftSeed?.summary ?? "");
  const seedMins = seedDurationMinutes(draftSeed);
  const [durationMode, setDurationMode] = useState<DurationMode>(
    durationModeFromMinutes(seedMins),
  );
  const [customDuration, setCustomDuration] = useState(
    durationModeFromMinutes(seedMins) === "custom" ? String(seedMins) : "45",
  );
  const [capacityMode, setCapacityMode] = useState<CapacityMode>(
    capacityModeFromValue(draftSeed?.capacity ?? null),
  );
  const [customCapacity, setCustomCapacity] = useState(
    capacityModeFromValue(draftSeed?.capacity) === "custom"
      ? String(draftSeed?.capacity)
      : "40",
  );
  const [limitOpen, setLimitOpen] = useState(draftSeed?.capacity != null);
  const [afterOpen, setAfterOpen] = useState(
    draftSeed?.rewardLeafPreview != null,
  );
  const [rewardPreview, setRewardPreview] = useState(
    draftSeed?.rewardLeafPreview != null
      ? String(draftSeed.rewardLeafPreview)
      : "25",
  );
  const [announcementStyle, setAnnouncementStyle] =
    useState<GatheringAnnouncementStyle>(
      draftSeed?.announcementStyle ?? DEFAULT_GATHERING_ANNOUNCEMENT_STYLE,
    );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!draftSeed) return;
    setTitle(draftSeed.title);
    setSummary(draftSeed.summary);
    setAnnouncementStyle(draftSeed.announcementStyle);
  }, [draftSeed]);

  const durationMinutes =
    durationMode === "custom"
      ? Number(customDuration)
      : Number(durationMode);

  const capacity =
    capacityMode === "unlimited"
      ? null
      : capacityMode === "custom"
        ? Number(customCapacity)
        : Number(capacityMode);

  const rewardLeafPreview = afterOpen
    ? rewardPreview.trim()
      ? Number(rewardPreview)
      : null
    : null;

  const formValid =
    title.trim().length > 0 &&
    summary.trim().length > 0 &&
    isValidGatheringDurationMinutes(durationMinutes) &&
    (capacity == null ||
      (Number.isInteger(capacity) && capacity > 0 && capacity <= 10_000)) &&
    (rewardLeafPreview == null ||
      (Number.isInteger(rewardLeafPreview) &&
        rewardLeafPreview >= 0 &&
        rewardLeafPreview <= 1_000_000));

  async function begin(event: FormEvent) {
    event.preventDefault();
    if (busy || !formValid) return;
    setBusy(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) {
        setError("Keeper access is required.");
        return;
      }
      const response = await fetch("/api/desk/gatherings/begin", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          summary: summary.trim(),
          durationMinutes,
          capacity,
          rewardLeafPreview,
          announcementStyle,
          draftId: draftSeed?.id ?? null,
        }),
        cache: "no-store",
      });
      const data = (await response.json()) as {
        ok?: boolean;
        gathering?: DeskGatheringDetail;
        error?: string;
      };
      if (!response.ok || !data.gathering) {
        setError(data.error ?? "The Gathering could not be called.");
        const el = document.getElementById(errorId);
        el?.focus();
        return;
      }
      onBegun(data.gathering);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="desk-gathering-call" aria-label="Call a Gathering">
      <div className="desk-gathering-call__layout">
        <form
          className="desk-gathering-call__form"
          onSubmit={(e) => void begin(e)}
          noValidate
        >
          <h2 className="desk-section-title">CALL A GATHERING</h2>
          <p className="muted desk-gathering-call__lede">
            Press Begin Gathering and the Fire opens now. Times are set by the
            server when the call begins.
          </p>

          {error ? (
            <p
              id={errorId}
              className="desk-gathering-call__error"
              role="alert"
              tabIndex={-1}
            >
              {error}
            </p>
          ) : null}

          <label className="desk-gathering-call__field">
            <span className="desk-gathering-call__label">
              WHY ARE WE GATHERING?
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="The Greenwood meets to..."
              required
              maxLength={200}
              disabled={busy}
            />
          </label>

          <label className="desk-gathering-call__field">
            <span className="desk-gathering-call__label">
              WHAT SHOULD OUTLAWS KNOW?
            </span>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="This is what Greenwood members will read at the Fire."
              required
              rows={5}
              maxLength={2000}
              disabled={busy}
            />
          </label>

          <fieldset className="desk-gathering-call__fieldset">
            <legend className="desk-gathering-call__label">
              HOW LONG WILL THE GATHERING LAST?
            </legend>
            <div
              className="desk-gathering-call__choices"
              role="radiogroup"
              aria-label="Duration"
            >
              {GATHERING_DURATION_PRESETS.map((mins) => (
                <button
                  key={mins}
                  type="button"
                  role="radio"
                  aria-checked={durationMode === String(mins)}
                  className={
                    durationMode === String(mins)
                      ? "desk-gathering-call__choice desk-gathering-call__choice--selected"
                      : "desk-gathering-call__choice"
                  }
                  disabled={busy}
                  onClick={() => setDurationMode(String(mins) as DurationMode)}
                >
                  {mins} MIN
                </button>
              ))}
              <button
                type="button"
                role="radio"
                aria-checked={durationMode === "custom"}
                className={
                  durationMode === "custom"
                    ? "desk-gathering-call__choice desk-gathering-call__choice--selected"
                    : "desk-gathering-call__choice"
                }
                disabled={busy}
                onClick={() => setDurationMode("custom")}
              >
                CUSTOM
              </button>
            </div>
            {durationMode === "custom" ? (
              <label className="desk-gathering-call__field">
                <span className="muted">Minutes ({GATHERING_DURATION_MIN_MINUTES}–{GATHERING_DURATION_MAX_MINUTES})</span>
                <input
                  inputMode="numeric"
                  value={customDuration}
                  onChange={(e) =>
                    setCustomDuration(e.target.value.replace(/[^\d]/g, ""))
                  }
                  disabled={busy}
                />
              </label>
            ) : null}
          </fieldset>

          <div className="desk-gathering-call__fixed">
            <p className="desk-gathering-call__label">WHO IS CALLED?</p>
            <p>Greenwood members</p>
          </div>

          <fieldset className="desk-gathering-call__fieldset">
            <legend className="desk-gathering-call__label">
              HOW SHOULD THE GREENWOOD HEAR?
            </legend>
            <div className="desk-gathering-call__style-cards">
              <button
                type="button"
                role="radio"
                aria-checked={announcementStyle === "quiet"}
                className={
                  announcementStyle === "quiet"
                    ? "desk-gathering-call__style desk-gathering-call__style--selected"
                    : "desk-gathering-call__style"
                }
                disabled={busy}
                onClick={() => setAnnouncementStyle("quiet")}
              >
                <span className="desk-gathering-call__style-title">
                  QUIET NOTICE
                </span>
                <span className="muted">
                  The Gathering appears at the Fire.
                </span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={announcementStyle === "fire_calling"}
                className={
                  announcementStyle === "fire_calling"
                    ? "desk-gathering-call__style desk-gathering-call__style--selected"
                    : "desk-gathering-call__style"
                }
                disabled={busy}
                onClick={() => setAnnouncementStyle("fire_calling")}
              >
                <span className="desk-gathering-call__style-title">
                  THE FIRE CALLS
                </span>
                <span className="muted">
                  The Gathering appears at the Fire and across the Greenwood as
                  a live call.
                </span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={announcementStyle === "world_call"}
                className={
                  announcementStyle === "world_call"
                    ? "desk-gathering-call__style desk-gathering-call__style--selected"
                    : "desk-gathering-call__style"
                }
                disabled={busy}
                onClick={() => setAnnouncementStyle("world_call")}
              >
                <span className="desk-gathering-call__style-title">
                  WORLD CALL
                </span>
                <span className="muted">
                  Promote this Gathering at the Greenwood and on the homepage
                  map.
                </span>
              </button>
            </div>
          </fieldset>

          <div className="desk-gathering-call__advanced">
            <button
              type="button"
              className="btn-text desk-gathering-call__advanced-toggle"
              onClick={() => setLimitOpen((v) => !v)}
              aria-expanded={limitOpen}
            >
              LIMIT THE FIRE {limitOpen ? "▴" : "▾"}
            </button>
            {limitOpen ? (
              <div className="desk-gathering-call__advanced-body">
                <div
                  className="desk-gathering-call__choices"
                  role="radiogroup"
                  aria-label="Capacity"
                >
                  {(
                    [
                      ["unlimited", "No limit"],
                      ["10", "First 10"],
                      ["25", "First 25"],
                      ["custom", "Custom"],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={capacityMode === mode}
                      className={
                        capacityMode === mode
                          ? "desk-gathering-call__choice desk-gathering-call__choice--selected"
                          : "desk-gathering-call__choice"
                      }
                      disabled={busy}
                      onClick={() => setCapacityMode(mode)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {capacityMode === "custom" ? (
                  <label className="desk-gathering-call__field">
                    <span className="muted">Custom capacity</span>
                    <input
                      inputMode="numeric"
                      value={customCapacity}
                      onChange={(e) =>
                        setCustomCapacity(e.target.value.replace(/[^\d]/g, ""))
                      }
                      disabled={busy}
                    />
                  </label>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="desk-gathering-call__advanced">
            <button
              type="button"
              className="btn-text desk-gathering-call__advanced-toggle"
              onClick={() => setAfterOpen((v) => !v)}
              aria-expanded={afterOpen}
            >
              AFTER THE FIRE {afterOpen ? "▴" : "▾"}
            </button>
            {afterOpen ? (
              <div className="desk-gathering-call__advanced-body">
                <label className="desk-gathering-call__field">
                  <span className="desk-gathering-call__label">
                    Possible Hollow reward
                  </span>
                  <span className="muted desk-gathering-call__hint">
                    This is a preview only. LEAF is not granted automatically.
                  </span>
                  <input
                    inputMode="numeric"
                    value={rewardPreview}
                    onChange={(e) =>
                      setRewardPreview(e.target.value.replace(/[^\d]/g, ""))
                    }
                    disabled={busy}
                  />
                </label>
              </div>
            ) : null}
          </div>

          <div className="desk-gathering-call__actions">
            <button
              type="submit"
              className="btn-text desk-gathering-call__begin"
              disabled={busy || !formValid}
            >
              {busy ? "[ CALLING… ]" : "[ BEGIN GATHERING ]"}
            </button>
            {onCancel ? (
              <button
                type="button"
                className="btn-text"
                disabled={busy}
                onClick={onCancel}
              >
                [ back ]
              </button>
            ) : null}
            <Link href="/desk" className="btn-text">
              [ Desk ]
            </Link>
          </div>
        </form>

        <DeskGatheringPreview
          title={title}
          summary={summary}
          durationMinutes={
            isValidGatheringDurationMinutes(durationMinutes)
              ? durationMinutes
              : 60
          }
          capacity={
            capacity != null && Number.isFinite(capacity) && capacity > 0
              ? capacity
              : null
          }
          rewardLeafPreview={
            rewardLeafPreview != null && Number.isFinite(rewardLeafPreview)
              ? rewardLeafPreview
              : null
          }
          announcementStyle={announcementStyle}
        />
      </div>
    </section>
  );
}
