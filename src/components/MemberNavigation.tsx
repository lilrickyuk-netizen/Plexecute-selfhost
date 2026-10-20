import { Link } from "@tanstack/react-router";
import {
  Apple,
  AudioLines,
  BookOpen,
  CalendarDays,
  CalendarCheck,
  CalendarClock,
  CircleCheck,
  Compass,
  ContactRound,
  CreditCard,
  Dumbbell,
  Fingerprint,
  FlaskConical,
  Heart,
  History,
  LifeBuoy,
  ListTodo,
  Map,
  MessageSquare,
  Settings,
  ShieldCheck,
  Target,
  TrendingUp,
  User,
  Users,
  Bell,
  type LucideIcon,
} from "lucide-react";

export const MEMBER_GROUPS = [
  {
    label: "Execution",
    items: [
      { to: "/app/today", label: "Today", icon: CircleCheck },
      { to: "/app/coach", label: "Coach", icon: MessageSquare },
      { to: "/app/plan", label: "Plan", icon: ListTodo },
      { to: "/app/calendar", label: "Calendar", icon: CalendarDays },
      { to: "/app/goals", label: "Goals", icon: Target },
      { to: "/app/commitments", label: "Commitments", icon: CalendarClock },
      { to: "/app/appointments", label: "Bookings", icon: CalendarCheck },
      { to: "/app/accountability", label: "Accountability calls", icon: AudioLines },
      { to: "/app/reminders", label: "Reminders", icon: Bell },
    ],
  },
  {
    label: "Life areas",
    items: [
      { to: "/app/training", label: "Training", icon: Dumbbell },
      { to: "/app/wellness", label: "Wellness & Movement", icon: Heart },
      { to: "/app/nutrition", label: "Nutrition", icon: Apple },
      { to: "/app/learning", label: "Learning", icon: BookOpen },
    ],
  },
  {
    label: "Insights",
    items: [
      { to: "/app/progress", label: "Progress", icon: TrendingUp },
      { to: "/app/patterns", label: "Your patterns", icon: Compass },
      { to: "/app/experiments", label: "Experiments", icon: FlaskConical },
      { to: "/app/twin", label: "Life Twin", icon: Fingerprint },
      { to: "/app/lifemap", label: "Life map", icon: Map },
      { to: "/app/history", label: "History", icon: History },
      { to: "/app/professionals", label: "Professional Connect", icon: Users },
      { to: "/app/clients", label: "My clients", icon: ContactRound },
    ],
  },
  {
    label: "Account",
    items: [
      { to: "/app/profile", label: "Profile", icon: User },
      { to: "/app/billing", label: "Plan & billing", icon: CreditCard },
      { to: "/app/privacy", label: "Privacy", icon: ShieldCheck },
      { to: "/app/settings", label: "Settings", icon: Settings },
      { to: "/app/help", label: "Help", icon: LifeBuoy },
    ],
  },
] as const;

export function MemberNavLink({
  item,
}: {
  item: {
    to: (typeof MEMBER_GROUPS)[number]["items"][number]["to"];
    label: string;
    icon: LucideIcon;
  };
}) {
  return (
    <Link
      to={item.to}
      title={item.label}
      className="member-nav-link"
      activeProps={{ className: "member-nav-active" }}
    >
      <item.icon size={17} aria-hidden="true" />
      <span>{item.label}</span>
    </Link>
  );
}
