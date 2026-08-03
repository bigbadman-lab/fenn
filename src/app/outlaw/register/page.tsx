"use client";

import { Suspense } from "react";

import { OutlawRegisterPanel } from "@/components/outlaw/outlaw-register-panel";

export default function OutlawRegisterPage() {
  return (
    <Suspense fallback={<article className="place"><p className="muted">looking...</p></article>}>
      <OutlawRegisterPanel />
    </Suspense>
  );
}
