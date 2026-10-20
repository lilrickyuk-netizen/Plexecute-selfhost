import accountabilityCover from "@/assets/cover-accountability.jpg";
import appointmentsCover from "@/assets/cover-appointments.jpg";
import billingCover from "@/assets/cover-billing.jpg";
import calendarCover from "@/assets/cover-calendar.jpg";
import clientsCover from "@/assets/cover-clients.jpg";
import commitmentsCover from "@/assets/cover-commitments.jpg";
import experimentsCover from "@/assets/cover-experiments.jpg";
import goalsCover from "@/assets/cover-goals.jpg";
import helpCover from "@/assets/cover-help.jpg";
import historyCover from "@/assets/cover-history.jpg";
import journeysCover from "@/assets/cover-journeys.jpg";
import lifemapCover from "@/assets/cover-lifemap.jpg";
import pathwayCover from "@/assets/cover-pathway.jpg";
import patternsCover from "@/assets/cover-patterns.jpg";
import professionalsCover from "@/assets/cover-professionals.jpg";
import twinCover from "@/assets/cover-twin.jpg";
import settingsCover from "@/assets/cover-settings.jpg";
import profileCover from "@/assets/cover-profile.jpg";
import privacyCover from "@/assets/cover-privacy.jpg";
import remindersCover from "@/assets/cover-reminders.jpg";

/** One distinct cover picture per member page that has no built-in picture. Never reuse one. */
export const PAGE_COVERS: Record<string, string> = {
  "/app/accountability": accountabilityCover,
  "/app/appointments": appointmentsCover,
  "/app/billing": billingCover,
  "/app/calendar": calendarCover,
  "/app/clients": clientsCover,
  "/app/commitments": commitmentsCover,
  "/app/experiments": experimentsCover,
  "/app/goals": goalsCover,
  "/app/help": helpCover,
  "/app/history": historyCover,
  "/app/journeys": journeysCover,
  "/app/lifemap": lifemapCover,
  "/app/pathway": pathwayCover,
  "/app/patterns": patternsCover,
  "/app/professionals": professionalsCover,
  "/app/twin": twinCover,
  "/app/settings": settingsCover,
  "/app/profile": profileCover,
  "/app/privacy": privacyCover,
  "/app/reminders": remindersCover,
};
