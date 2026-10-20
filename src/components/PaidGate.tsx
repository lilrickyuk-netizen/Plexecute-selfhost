import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useProfile } from "@/lib/data";
import { allows, CAPABILITY_MESSAGE, type Capability } from "@/lib/entitlements";

/** Mirrors the server entitlement check (entitlements.server.ts) so members see why, not an error. */
export function useAllows(cap: Capability): boolean | undefined {
  const { data } = useProfile();
  return data === undefined ? undefined : allows(data?.tier, cap);
}

export function UpgradeNote({ cap }: { cap: Capability }) {
  return (
    <div className="rounded-[16px] border border-border bg-card p-5 text-sm">
      <p className="text-foreground">{CAPABILITY_MESSAGE[cap]}</p>
      <Link
        to="/pricing"
        className="mt-2 inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
      >
        See plans and the 7-day free trial
      </Link>
    </div>
  );
}

export function PaidGate({
  cap,
  children,
  title,
}: {
  cap: Capability;
  children: ReactNode;
  title?: string;
}) {
  const ok = useAllows(cap);
  if (ok === undefined) return null;
  if (ok) return <>{children}</>;
  return (
    <div>
      {title && <h1 className="mb-4 text-3xl font-semibold">{title}</h1>}
      <UpgradeNote cap={cap} />
    </div>
  );
}
