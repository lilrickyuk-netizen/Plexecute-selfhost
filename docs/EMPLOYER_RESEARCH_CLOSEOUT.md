# Current employer research closeout

## Root cause
Searches returned board indexes and stale snippets; open-status verification and parent-employer counting were insufficient. Several adverts from one parent could masquerade as employer diversity. Weak cached research could bypass renewed verification.

## Fix
Only current-employer questions use the scoped open_employers_v3 gate. Individual vacancy text is refreshed, with a narrow HTTPS host allowlist fallback and no redirect following. Unavailable, closed and expired adverts cannot support primary current-demand claims. Short replacement queries target missing employers/sectors; parent/division aliases are counted once. Qualification context stays separate from sampled employer qualifications, skills and experience. Sufficient-only reuse requires the current employer policy version. General Coach routing is unchanged.

## Open employers/source count
Live exact question: “I want to become a project manager. What should I learn and what qualifications are employers asking for now?”

Checked 16 October 2026; four open adverts, three parent employers, three vacancy-source hosts:
- National Grid: https://careers.energyutilitiesjobs.co.uk/jobs/senior-project-manager-united-kingdom/64430-1/ — closes 22 October 2026. Engineering/project-management degree or equivalent experience and APM/PRINCE2 are desirable; significant construction/infrastructure/engineering delivery experience is essential.
- Hitachi Energy: https://www.hitachienergy.com/us/en/careers/open-jobs/details/JID3-206804 — UK role, verified “Apply now”; no closing date stated. HNC/HND/degree/MSc; Chartered Engineer or PMI PMP; over five years of systems-business PM experience and power-transmission delivery experience. The /us/en URL is a site locale, not the vacancy location.
- M Group Telecom: https://jobs.mgroupltd.com/vacancies/50800/project-manager.html — closes 13 November 2026; no qualification requirement stated, not evidence that none is required.
- M Group/Telent graduate role: https://jobs.mgroupltd.com/vacancies/49766/graduate-project-manager.html — closes 30 October 2026; relevant project/business/STEM-management degree, recent or upcoming graduate. Counted as the same parent employer as M Group Telecom.

Audit: 60 results returned across 10 queries; 45 filtered; eight final retained sources; one replacement pass. Closed WMCA and British Transport Police adverts excluded from primary evidence; unknown/unavailable adverts excluded. Employer diversity is three, not four. Findings remain a small infrastructure/telecoms/engineering-heavy sample, not a UK-wide demand survey.

## Qualification sources
APM official qualification overview and PMQ page:
- https://www.apm.org.uk/qualifications-and-training/
- https://www.apm.org.uk/qualifications-and-training/project-management-qualification/

These establish qualification routes, not employer demand. PMI PMP/PRINCE2 mentions in the answer are supported as sampled employer requirements, not universal recommendations.

## Live result
PASS: the saved Coach answer names National Grid, Hitachi Energy and M Group, distinguishes qualification routes from employer requirements and experience, preserves clickable advert links, and explicitly limits conclusions to a small checked UK sample. Read back in the authenticated Coach UI after reload; screenshot /tmp/browser/employer-closeout/result.png. Closed adverts are not presented as current evidence. Automated full suite before the final identity assertion: 798 passed, 99 skipped; final scoped suite: 28 passed including the new parent-alias assertion. ESLint: zero errors, 36 warnings. Latest automatic build: OK. Nothing published.

## PASS/FAIL
PASS for the scoped current-employer-demand closeout. Vacancy status is point-in-time and can change after verification.