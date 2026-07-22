"use client";

import { PrivyProvider } from "@privy-io/react-auth";

import { FennAuthProvider } from "@/components/auth/fenn-auth-provider";
import { publicEnv } from "@/lib/env/public";

type ProvidersProps = {
  children: React.ReactNode;
};

/** Privy accepts only string | SVG | IMG for appearance.logo */
const fennPrivyLogo = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={72}
    height={68}
    viewBox="0 0 72 68"
    role="img"
    aria-label="FENN"
  >
    <text
      fill="#E7E3D4"
      fontFamily='ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
      fontSize={11}
      xmlSpace="preserve"
    >
      <tspan x={4} y={14}>
        {"    /\\"}
      </tspan>
      <tspan x={4} y={26}>
        {"   /  \\"}
      </tspan>
      <tspan x={4} y={38}>
        {"  /_/\\_\\"}
      </tspan>
      <tspan x={4} y={50}>
        {"    ||"}
      </tspan>
      <tspan x={4} y={62}>
        {"   FENN"}
      </tspan>
    </text>
  </svg>
);

export function Providers({ children }: ProvidersProps) {
  return (
    <PrivyProvider
      appId={publicEnv.NEXT_PUBLIC_PRIVY_APP_ID}
      config={{
        // Order is controlled by loginMethodsAndOrder (takes precedence over loginMethods).
        loginMethodsAndOrder: {
          primary: ["email", "metamask"],
        },
        appearance: {
          // Night background — Privy modulates FG/BG from this hex.
          theme: "#0A0B09",
          accentColor: "#B7F34A",
          logo: fennPrivyLogo,
          landingHeader: "",
          loginMessage: "bring a wallet.",
          showWalletLoginFirst: false,
          walletList: ["metamask"],
          walletChainType: "ethereum-only",
        },
        embeddedWallets: {
          ethereum: {
            // Create embedded EVM wallet only when the user has none yet
            // (email users). MetaMask users already have an external wallet.
            createOnLogin: "users-without-wallets",
          },
        },
      }}
    >
      <FennAuthProvider>{children}</FennAuthProvider>
    </PrivyProvider>
  );
}
