# Coach as a full execution interface

## Audit result: NOT COMPLETE

Checked against the Coach's real actions. Only appointments, calls and new goals are saved directly. Most other requests only show a link that sends the member to another page.

| Domain | Read | Create | Update | Delete/cancel | Confirmation | Status |
|---|---|---|---|---|---|---|
| Commitments / appointments | Yes | Yes (live-tested) | No | No | n/a | Gap |
| Accountability calls | Yes | Yes (live-tested) | No (can't change time) | Yes (cancel) | n/a | Gap |
| Plan (day/week) | Yes | Proposal only | Link to Plan page | No clear/remove | Proposal approval | Gap |
| Sessions (move/remove one) | Yes | No | Link only | No | none | Gap |
| Goals | Yes | Yes, proposed (live-tested) | Link only | No | Goals page | Gap |
| Milestones | Partly | No | No | No | none | Gap |
| Training / cardio / mobility | Yes | No | No | No | none | Gap |
| Nutrition / food log | Yes | Link only | No | No | Nutrition page | Gap |
| Wellness / meditation / recovery | Yes | No | No | No | none | Gap |
| Learning | Yes | No | No | No | none | Gap |
| Career research in planning | No tool | No | No | No | none | Gap |
| Notes / reflections / check-ins | Yes | No | No | No | none | Gap |
| Progress / outcomes | Yes | No | No | No | none | Gap |
| Availability | Via profile facts | Notes only | No | No | none | Gap |
| Experiments | Yes | Link only | No | No | Experiments page | Gap |
| Blocked areas (billing, keys, admin, owner) | Blocked by the system | — | — | — | — | Pass |

## What to build

1. **Commitments:** `update_commitment` and `remove_commitment` (single or bulk by day). Removing more than one, or any recurring one, becomes a pending action the member confirms in chat.
2. **Calls:** `reschedule_scheduled_call` (cancel the old one and book a new one, with the same duplicate protection).
3. **Sessions:** `move_session`, `remove_session` and `clear_day`. These call the same planning server rules as the Plan page (status checks, locks, events). Clearing or rebuilding a day goes through the existing Repair-my-day proposal, so the member approves it before anything changes.
4. **Goals and milestones:** `update_goal` (weekly frequency/minutes, title, why), `add_milestone`, `complete_milestone`, `update_milestone`. Material goal changes trigger the normal new-plan proposal.
5. **Journal:** `add_reflection`, `add_checkin` (recovery), `add_daily_note`, `record_progress`. These use the same tables and checks as their screens.
6. **Domains:** training, movement, wellness preferences, meal plan and learning tools that call the existing domain functions (safety gate included). They never write to the tables directly.
7. **Food:** `log_food` writes through the existing nutrition logic after the member confirms it in chat.
8. **Availability:** `update_availability` writes the profile availability through the same check the Settings page uses, then queues a replan proposal.
9. **Career research:** `get_research_findings`, so the plan and Coach answers use saved findings.
10. **In-chat confirmation:** a new "pending action" card in Coach chat with Confirm/Cancel buttons. Destructive or bulk actions run only after Confirm, and each one is logged in audit_events.

## Testing

- Live-test as the owner account with natural phrases, including the six destructive examples. Each test checks: the action is chosen, the confirmation appears, the record changes, it is still there after a refresh, the right page shows it, the Coach can read it back, a repeat makes no duplicate, and an audit record exists.
- Automatic checks: every write tool goes through a domain function (static scan), destructive tools need confirmation, and the blocked-table list stays in place.
- Final capability matrix reported with real results.

## Technical notes

- New tools are added to TOOL_DEFS and FREE_TOOLS per entitlements. Pending actions are stored in a `coach_pending_actions` table (user-owned, RLS, added to USER_TABLES), executed by a `confirmCoachAction` server function.
- Shared domain logic is pulled out of the existing `*.functions.ts` files into `*.server.ts` helpers, so the UI and the Coach call the same code.
- AGENTS.md rule updated: Coach writes only through domain helpers plus the pending-action confirmation.
