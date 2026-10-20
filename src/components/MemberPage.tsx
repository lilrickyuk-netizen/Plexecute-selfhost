import { FeatureHeader } from "@/components/FeatureHeader";
import { Utensils } from "lucide-react";
import type { ReactNode } from "react";

export function MemberPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="member-feature-page">
      <FeatureHeader title={title} icon={Utensils} />
      {children}
    </div>
  );
}
