BEFORE FINAL HANDOFF, ADD A NEW LOCKED OWNER FEATURE:

PLEXECUTE OWNER CONTROL CENTRE

This is a permanent owner/admin operating dashboard for running Plexecute as a real business and production platform.

It is NOT a temporary launch dashboard.

It must remain useful from the first 5 users through 100, 1,000, 10,000 and beyond.

Do not replace or remove the existing Admin / Operations Console.

Instead, build the Owner Control Centre as the high-level business and product command centre, using the existing admin authorization model, existing persisted data, analytics, billing, execution, calling, reward, support, provider and infrastructure systems.

PURPOSE

The Plexecute Owner Control Centre must give the owner one place to monitor:

- users
- subscriptions
- revenue
- retention
- activation
- execution
- rewards
- calling
- AI usage
- provider usage
- infrastructure
- integrations
- support
- feedback
- incidents
- releases
- operational health
- unit economics

Do not create fake analytics.

Use real persisted data and existing service truth.

ACCESS

Owner/admin only.

Ordinary users must never be able to access this surface.

Use the existing admin authorization model.

Record privileged access/actions through the existing audit system where appropriate.

PRIMARY NAVIGATION

Create the following sections:

OVERVIEW
USERS
REVENUE
RETENTION
EXECUTION
CALLS
AI & PROVIDER COSTS
INTEGRATIONS
SUPPORT
FEEDBACK
COHORTS
INFRASTRUCTURE
INCIDENTS
RELEASES
AUDIT

OVERVIEW

Create a high-level owner dashboard showing at minimum:

- total registered users
- active users
- paying users
- Free users
- Pro users
- Execute users
- new users today
- new users this week
- new users this month
- MRR
- monthly revenue
- subscription renewals
- cancellations
- failed payments
- 30-day retention
- 90-day retention
- churn rate
- Life Audit completion rate
- first accepted plan activation rate
- weekly active users
- monthly plan completion rate
- Execute rewards earned
- Execute rewards applied
- total voice minutes consumed
- call acknowledgement rate
- support issues open
- integration failures
- background-job failures
- current incident state

Allow date filtering:

- today
- last 7 days
- last 30 days
- current service month
- previous service month
- current quarter
- current year
- custom range

USERS

Create a searchable, sortable and filterable user table.

At minimum show:

- privacy-safe user identity
- signup date
- acquisition source
- current tier
- subscription status
- trial status
- renewal date
- Life Audit completed
- first plan accepted
- current plan version
- last meaningful activity
- weekly activity state
- current monthly plan completion percentage
- completed planned actions
- total qualifying planned actions
- Execute reward status
- call campaigns used
- voice minutes used
- call acknowledgement rate
- goal/outcome progress summary
- support issue flag
- cancellation state
- cancellation reason
- owner notes

Filters must include:

- Free / Pro / Execute
- active / inactive
- subscribed / cancelled
- trial / paid
- payment failed
- onboarding complete / incomplete
- plan accepted / not accepted
- reward earned / not earned / in progress
- renewal approaching
- cancellation this month
- support issue
- acquisition source
- cohort
- activity level

USER DETAIL VIEW

Clicking a user must open a privacy-safe operational detail page.

Show:

ACTIVATION
- signup
- Life Audit completion
- first plan accepted
- first task completed
- first accountability interaction
- first meaningful outcome

EXECUTION
- accepted plan versions
- planned actions
- completed actions
- skipped actions
- blocked actions
- rescheduled actions
- Recovery Mode usage
- current monthly completion
- reward qualification state

ACCOUNTABILITY
- reminders
- call campaigns
- call attempts
- calls answered
- acknowledgements
- snoozes
- reschedules
- STOP ALL state
- voice minutes

COMMERCIAL
- tier
- trial
- subscription start
- renewal date
- payment status
- Execute reward earned/applied
- subscription history
- cancellation
- cancellation reason

OUTCOMES
- Life Outcome Ledger summary
- goal progress
- adherence trend
- evidence classification summary

SUPPORT
- support issues
- feedback
- owner/admin notes
- status
- resolution history

Do NOT expose:

- passwords
- authentication secrets
- provider tokens
- full payment-card details
- raw private health payloads
- unnecessary health values
- raw Coach conversation content
- raw call audio
- full raw call transcripts
- provider API secrets

Use summaries and existing evidence classifications.

REVENUE

Show at minimum:

- MRR
- ARR
- total monthly revenue
- Pro revenue
- Execute revenue
- annual-plan revenue where applicable
- voice top-up revenue
- new subscriptions
- renewals
- upgrades
- downgrades
- cancellations
- refunds
- failed payments
- recovered payments
- Execute rewards earned
- Execute rewards applied
- total reward value issued
- average revenue per paying user
- revenue by acquisition source
- revenue by cohort

Use real billing state.

Do not estimate or invent revenue where provider data is unavailable.

RETENTION

Show:

- 7-day retention
- 14-day retention
- 30-day retention
- 60-day retention
- 90-day retention
- retention by tier
- retention by acquisition source
- retention by cohort
- renewal rate
- churn rate
- cancellation rate
- reactivation rate where applicable

Support cohort charts/tables.

EXECUTION

Show product-execution metrics including:

- Life Audit completion
- first-plan acceptance
- planned actions created
- planned actions completed
- completion rate
- plan adherence
- reschedule recovery rate
- blocked action rate
- skipped action rate
- Recovery Mode usage
- monthly full-plan completion
- Execute rewards earned
- outcomes recorded
- progress by verification class
- user goal/outcome progress

Use existing Product Analytics requirements.

Do not duplicate calculation logic where existing services already calculate these values.

CALLS

Show:

- call campaigns created
- call attempts
- calls answered
- no-answer rate
- busy rate
- machine/voicemail rate
- acknowledgement rate
- average connected duration
- total connected voice minutes
- Pro allowance usage
- Execute allowance usage
- STOP ALL activations
- retries
- failed calls
- provider errors
- call cost
- call cost by tier
- call cost per active Execute user
- call outcomes by acquisition source/cohort where useful

Do not expose raw sensitive call content.

AI & PROVIDER COSTS

Create a permanent cost-control section.

Show where available:

- OpenAI usage
- Gemini usage
- live voice usage
- transcription usage
- token usage
- AI cost by tier
- AI cost by user cohort
- average AI cost per active user
- average AI cost per Pro user
- average AI cost per Execute user
- provider failure rate
- provider fallback rate
- provider quota usage
- provider spend this month
- projected month-end provider spend based on real usage

Do not fabricate cost figures.

Only show projected spend when enough real usage data exists and clearly label it as projected.

INTEGRATIONS

Show health/state for every production integration, including where applicable:

- Stripe
- RevenueCat
- Twilio
- OpenAI
- Gemini
- email provider
- calendar providers
- WHOOP
- Oura
- Fitbit
- Strava
- Garmin
- food-data provider
- health-platform integrations
- any other production provider

For each integration show:

- connected/configured state
- credential state
- last successful request
- last error
- error rate
- webhook health
- token-refresh health
- quota/rate-limit state
- degraded state
- current incident

Do not expose secret values.

SUPPORT

Create an owner/admin support workspace showing:

- open issues
- user-reported problems
- billing issues
- calling issues
- integration issues
- missing feature requests
- confusing UX reports
- technical faults
- resolved issues
- severity
- status
- assigned owner where applicable
- created date
- resolved date

Allow issue status:

OPEN
INVESTIGATING
FIXED
CLOSED

FEEDBACK

Allow feedback records linked to a user where appropriate.

Categories:

- bug
- confusing UX
- poor recommendation
- accountability/calling issue
- billing issue
- integration issue
- missing feature
- positive feedback
- other

Each record must support:

- category
- severity
- notes
- source
- created date
- status
- resolution
- linked issue/reference

CANCELLATION REASONS

Add a cancellation reason capture flow where legally/provider-compatible.

Options:

- Too expensive
- Did not use it enough
- Did not help enough
- Calling/accountability was not useful
- Too complicated
- Missing feature
- Technical problem
- Privacy concern
- Other

Allow optional free text.

Do not obstruct cancellation.

The reason is analytics only.

COHORTS

Create permanent cohort analysis.

Allow owner/admin to create and save cohorts based on:

- signup date
- tier
- acquisition source
- campaign
- geography where lawful/available
- subscription state
- activity
- launch period
- custom tag

Default acquisition-source values:

- Waiting List
- Founding Tester
- Organic
- Paid Marketing
- Referral
- Partnership
- Other

Support permanent comparisons such as:

- launch cohort
- first 100 users
- first 100 paying users
- first 1,000 paying users
- monthly signup cohorts
- Pro cohorts
- Execute cohorts
- campaign cohorts

For each cohort show:

- activation
- Life Audit completion
- plan acceptance
- weekly activity
- monthly plan completion
- reward earned
- renewal
- retention
- churn
- revenue
- average support issue count
- call usage
- AI/provider cost
- outcome progress where appropriate

INFRASTRUCTURE

Show permanent production health:

- API health
- database health
- database saturation
- background-job health
- queue depth
- dead-letter queue
- scheduler lag
- webhook failures
- storage usage
- application errors
- latency
- deployment health
- backup state
- restore-test status
- provider outage/degraded mode
- current usage vs verified capacity envelope

Use existing observability and admin systems.

INCIDENTS

Create an incident-management view.

Show:

- active incidents
- severity
- impacted component
- start time
- current status
- mitigation
- resolved time
- post-incident notes
- linked provider/infrastructure failures

Allow existing kill switches / feature flags to be surfaced where authorized.

Do not weaken existing security controls.

RELEASES

Show:

- current production version
- current deployment
- release date
- release notes
- test status
- rollback state
- feature flags
- environment
- known issues
- previous releases

AUDIT

Provide access to privacy-safe owner/admin operational audit records.

Show:

- admin action
- actor
- time
- target/resource
- action type
- result
- audit reference

Do not expose secrets or private data unnecessarily.

UNIT ECONOMICS

Add a permanent business-health section.

Show using REAL observed data:

- revenue
- payment fees
- AI cost
- voice/call cost
- provider cost
- hosting/cloud cost where available
- reward value issued
- contribution margin
- contribution margin per paying user
- average variable cost per Free user
- average variable cost per Pro user
- average variable cost per Execute user
- gross margin by tier
- CAC where marketing spend data is available
- payback period where enough data exists
- LTV/CAC only when enough real retention data exists

Do not invent values.

Where data is incomplete, show UNKNOWN / INSUFFICIENT DATA.

PERMANENT SCALE REQUIREMENT

Do not build this page only for the first launch cohort.

It must remain performant and operational as Plexecute grows.

Do not load every user or historical event at once.

Use:

- indexed queries
- aggregation
- pagination
- lazy-loaded detail views
- caching where appropriate
- background analytics aggregation where appropriate

The Control Centre must remain usable at:

- 100 users
- 1,000 users
- 10,000 users
- and beyond

PRIVACY AND SECURITY

The Owner Control Centre must obey all existing Plexecute privacy, security and least-privilege rules.

Health values and private Coach content must not become general business analytics.

Admin access must not imply unlimited access to private user content.

Reuse existing privacy-safe support patterns.

MOBILE / DESKTOP

This is primarily a desktop owner/admin surface.

It must still remain usable on tablet/mobile.

Do not compromise desktop information density just to make it look like a consumer mobile screen.

TESTS

Add automated tests covering at minimum:

1. ordinary users cannot access the Owner Control Centre
2. owner/admin can access it
3. authorization is enforced server-side
4. summary counts match persisted records
5. revenue uses real billing state
6. MRR is calculated correctly
7. tier filtering works
8. date filtering works
9. cohort filtering works
10. activation metrics are correct
11. execution metrics use real execution data
12. monthly completion is calculated correctly
13. Execute reward state is correct
14. call usage is correct
15. AI/provider usage is correct
16. integration health is surfaced correctly
17. failed webhooks are surfaced
18. failed payments are surfaced
19. renewals are correct
20. cancellations are correct
21. cancellation reasons persist
22. support issues persist
23. feedback persists
24. issue resolution works
25. user detail does not expose forbidden data
26. pagination works
27. large datasets do not require loading all records
28. deleted users are handled correctly
29. admin actions are audited
30. unit economics show UNKNOWN when source data is unavailable rather than fabricating values

COMPLETION GATE

Do not mark this complete because the UI renders.

The Owner Control Centre is complete only when the following full chain is connected:

real user data
-> analytics
-> execution state
-> outcome data
-> billing/subscription state
-> Execute reward state
-> calling usage
-> AI/provider usage
-> integration health
-> infrastructure health
-> support/feedback
-> cohorts
-> revenue
-> unit economics
-> owner UI
-> filtering
-> detail views
-> authorization
-> auditing
-> automated tests

Reuse existing Plexecute services and persisted records wherever possible.

Do not duplicate working engines or business logic.

When complete:

1. show me the finished Owner Control Centre;
2. list every existing Plexecute service/table/system it reads from;
3. identify any metric that cannot yet display because an external production provider still requires credentials or live usage;
4. confirm those unavailable values display UNKNOWN / NOT YET AVAILABLE rather than fake data;
5. run all relevant automated tests;
6. fix all failures.

ONLY AFTER THIS OWNER CONTROL CENTRE IS FULLY IMPLEMENTED AND TESTED should you continue with the remaining production-completion steps exactly where you left off.

Do not renumber or skip the existing build plan.