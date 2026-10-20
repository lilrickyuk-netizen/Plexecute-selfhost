import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { useRouterState } from "@tanstack/react-router";
import { PAGE_COVERS } from "@/lib/page-covers";

export function FeatureHeader({
  title,
  description,
  icon: Icon,
  actions,
  eyebrow,
}: {
  title: string;
  description?: string;
  icon: LucideIcon;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  const path = useRouterState({ select: (r) => r.location.pathname.replace(/\/$/, "") });
  const cover = PAGE_COVERS[path];
  return (
    <>
      <header className="member-feature-header">
        <div className="member-feature-heading">
          <span className="member-heading-icon">
            <Icon size={23} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            {eyebrow && <p className="member-heading-eyebrow">{eyebrow}</p>}
            <h1>{title}</h1>
            {description && <p className="member-heading-description">{description}</p>}
          </div>
        </div>
        {actions && <div className="member-header-actions">{actions}</div>}
      </header>
      {cover && (
        <div className="member-training-cover member-page-cover" aria-hidden="true">
          <img src={cover} width={1536} height={640} alt="" />
        </div>
      )}
    </>
  );
}
