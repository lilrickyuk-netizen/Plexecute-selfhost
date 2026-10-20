# Universal Coach routing live acceptance

## Root cause
Execution-first prompts treated ordinary questions as goal work. Research rewrote arbitrary questions into career or product-specific searches, discarded short source text, cached empty research, and read unrelated research history without returning its interpretation.

## Wiring/regression found
The internal library remained connected, but follow-up evidence reads bypassed its common timeout/fallback helper. General questions loaded unnecessary member context. Weak research had no enforced relevance-driven retry.

## Fix made
Preserved actual queries; general information turns expose only read/research tools; isolated general questions from unrelated chat history; scoped member reads; routed evidence reads through the common existing library; added one weak-search retry and retained both passes; returned exact research IDs, discovered sources, interpretations and verified quotes separately; added write/read error checks and routing audit fields. No publishing or pricing/allowance changes.

## Live results A–F

### A
Question: I want advice on quitting smoking.
Intent: advice
Internal knowledge supplied: yes; cited in final reply: yes
Research called: no
Total saved response time: 5.88s; browser elapsed: 7.9s
Tools: get_knowledge_evidence
Knowledge references: lc-cp-1
Final external links used: []
Observed outcome: PASS: behaviour guidance and library evidence, no live search.

Final reply:
Quitting is easier with support than relying on willpower alone. Choose a quit date, and ask a doctor or pharmacist about options such as nicotine replacement or prescription medication; a quitline or counseling can help with cravings and setbacks. NICE also recommends making a specific plan, using social support, and planning for relapse in advance [NICE, 2014].

For now, note when you most want to smoke and what tends to trigger it. If you tell me what you’ve tried before and what feels hardest, I can suggest a practical next step.

### B
Question: Find current project management qualifications I can start in the UK.
Intent: research
Internal knowledge supplied: yes; cited in final reply: not explicitly
Research called: yes
Total saved response time: 64.15s; browser elapsed: 66.3s
Tools: research_topic, get_research_findings
Knowledge references: lc-ca-1, lc-le-2, lc-ca-3, lc-go-1, lc-pr-1
Search queries: ["Current UK project management qualifications courses beginner entry routes start dates costs official providers United Kingdom", "UK beginner APM PFQ courses official accredited providers upcoming start dates and total course costs United Kingdom"]
Results returned: 12; filtered/capped: 2; retries: 1; verified findings saved: 9; rejected findings: 1
Final retained discovered sources: ["https://www.icslearn.co.uk/blog/management/the-9-best-project-management-qualifications/", "https://instituteprojectmanagement.com/gb/blog/project-management-courses-uk-2026-guide-to-success/", "https://www.reddit.com/r/projectmanagement/comments/1ne5bzm/project_management_certifications_uk/", "https://www.apm.org.uk/qualifications-and-training/", "https://www.pmi.org/certifications/project-management-pmp", "https://www.trainingbytesize.com/product/apm-project-fundamentals-qualification-pfq/", "https://www.westminster.ac.uk/zone29/business-and-management-short-courses/apm-project-management-fundamentals-pfq", "https://www.careersmarter.com/course/apm-project-fundamentals-qualification-pfq/?srsltid=AU7gw4WN5y9D68bfLoxVYepjYg0NehWQ-xnpBXYh3SvWBMj09AmzDQD5", "https://www.hw.ac.uk/ebs/business-and-industry/executive-education/short-courses/apm-project-fundamentals-qualification"]
Final external links used: ["https://www.apm.org.uk/qualifications-and-training/", "https://www.apm.org.uk/qualifications-and-training/", "https://www.trainingbytesize.com/product/apm-project-fundamentals-qualification-pfq/", "https://www.hw.ac.uk/ebs/business-and-industry/executive-education/short-courses/apm-project-fundamentals-qualification", "https://www.westminster.ac.uk/zone29/business-and-management-short-courses/apm-project-management-fundamentals-pfq"]
Observed outcome: PASS: researched current qualification providers, fees and a listed future course date; availability caveat retained.

Final reply:
For a beginner, start with APM’s Project Fundamentals Qualification (PFQ). APM describes it as a way to gain an understanding of project management principles.

Current UK options I found:

• Training ByteSize: online PFQ course from £425 + VAT, including the exam; study-only option £185 + VAT. Its two-day virtual and Nantwich classroom listings show 26 October 2026, priced £895 + VAT and £1,295 + VAT respectively.
• Heriot-Watt University: two-day PFQ course for £600; the APM exam fee is extra. No date is shown, so enquire.
• University of Westminster: two-day PFQ preparation course; the listing doesn’t show a date or price.

Check availability, full cost and whether the exam is included before booking. APM’s accredited provider directory is the best place to compare providers: https://www.apm.org.uk/qualifications-and-training/

Sources: [APM qualifications and training](https://www.apm.org.uk/qualifications-and-training/), [Training ByteSize PFQ](https://www.trainingbytesize.com/product/apm-project-fundamentals-qualification-pfq/), [Heriot-Watt PFQ](https://www.hw.ac.uk/ebs/business-and-industry/executive-education/short-courses/apm-project-fundamentals-qualification), [Westminster PFQ](https://www.westminster.ac.uk/zone29/business-and-management-short-courses/apm-project-management-fundamentals-pfq).

### C
Question: I want to become a project manager. What should I learn and what qualifications are employers asking for now?
Intent: research
Internal knowledge supplied: yes; cited in final reply: yes
Research called: yes
Total saved response time: 54.50s; browser elapsed: 57.7s
Tools: research_topic, get_knowledge_evidence, get_research_findings
Knowledge references: lc-ca-1, lc-le-1, lc-le-2, lc-de-1, lc-ca-3, lc-go-1
Search queries: ["UK project manager job adverts required qualifications skills 2026 employers United Kingdom", "Find a representative 2026 sample of UK project manager job adverts and report the qualifications and skills employers explicitly require, with employer and advert links. United Kingdom"]
Results returned: 12; filtered/capped: 2; retries: 1; verified findings saved: 4; rejected findings: 1
Final retained discovered sources: ["https://www.learningpeople.com/uk/career-insights/job-market-insights/project-management/", "https://www.prospects.ac.uk/job-profiles/project-manager/", "https://www.youtube.com/watch?v=qkAVfzVvuow", "https://www.glassdoor.com/Job/united-kingdom-entry-level-project-manager-jobs-SRCH_IL.0,14_IN2_KO15,42.htm", "https://nationalcareers.service.gov.uk/job-profiles/business-project-manager", "https://www.apm.org.uk/jobs-and-careers/"]
Final external links used: []
Observed outcome: FAIL: research and retry ran and combined knowledge with general reasoning, but employer-demand sample remained insufficient and final external links were omitted.

Final reply:
Build practical delivery skills first; don’t assume you need a project-management degree. In the UK, employers’ qualification requirements vary by role and sector. The current evidence I checked doesn’t establish which qualifications employers most often request, so verify against adverts in your target field.

Focus on planning scope, timelines and budgets; tracking risks and progress; coordinating people; and communicating clearly with stakeholders. Those are core project-management duties described by Prospects. Transferable experience—organising work, meeting deadlines, handling change or coordinating colleagues—can help you demonstrate these skills.

Routes into the work include apprenticeships, direct applications, and moving into project work from another role; a degree or postgraduate qualification is another route, according to the National Careers Service. APM also provides a career pathway tool to explore relevant qualifications. Don’t pay for a certificate until you’ve checked whether your target employers ask for it.

Next, review recent adverts for “project coordinator,” “project officer” and “assistant project manager” in your preferred sector. Note repeated skills and required qualifications, then compare them with what you can already show. Try a small project or short course and speak with someone doing the job.

This staged approach follows National Careers Service guidance: assess transferable skills, check official entry routes, talk to practitioners and test the work before committing. Sources: National Careers Service; APM; Prospects; [National Careers Service (UK), 2024].

### D
Question: Find free places online where I could promote an AI Life Execution Platform.
Intent: research
Internal knowledge supplied: yes; cited in final reply: not explicitly
Research called: yes
Total saved response time: 47.15s; browser elapsed: 49.5s
Tools: research_topic, get_research_findings
Knowledge references: wt-1
Search queries: ["Free online communities and directories to promote an AI life execution platform, including self-promotion rules", "Find global free communities and directories suited to promoting an AI life-execution platform, with source-verified self-promotion rules and free-access terms."]
Results returned: 12; filtered/capped: 2; retries: 1; verified findings saved: 2; rejected findings: 0
Final retained discovered sources: ["https://circle.so/blog/best-community-platforms", "https://www.storyprompt.com/blog/community-platforms", "https://hivebrite.io/best-online-community-platforms/", "https://www.youtube.com/watch?v=Pyy6-5Lf08s", "https://databox.com/online-communities-for-promoting-your-content", "https://www.jasper.ai/", "https://impact.com/", "https://free-for.dev/", "https://www.salesforce.com/", "https://lifeai.io/global-community-code-of-conduct"]
Final external links used: ["https://databox.com/online-communities-for-promoting-your-content"]
Observed outcome: FAIL: research and retry returned discoveries, but did not verify free terms or produce a sufficiently relevant concrete shortlist.

Final reply:
I couldn’t verify specific free communities or their current self-promotion rules, so treat these as places to investigate—not confirmed free promotional listings.

• Reddit communities focused on productivity, personal development, goal-setting, and AI tools: contribute useful advice first and check each subreddit’s rules.
• Product Hunt: consider a launch to reach people who follow new software; verify current launch requirements and costs.
• Indie Hackers: share the product’s story and lessons with an audience interested in building businesses.
• Relevant Facebook and LinkedIn groups: look for productivity, coaching, and AI-tool communities, and ask moderators before posting.
• Databox’s guide to online communities for promoting content may help identify more options: https://databox.com/online-communities-for-promoting-your-content

A useful approach: describe the problem your platform solves, share a practical tip or demo, and disclose your connection to the product. Avoid dropping the same sales link into multiple groups.

The sources checked didn’t confirm fees, eligibility, or posting rules for these options, so check those before investing time.

### E
Question: I keep missing my study sessions. What should I change?
Intent: advice
Internal knowledge supplied: yes; cited in final reply: yes
Research called: no
Total saved response time: 6.62s; browser elapsed: 8.7s
Tools: get_learning_context, get_schedule_context, get_execution_history, get_plan
Knowledge references: le-2, lc-le-1, bc-3, lc-ha-4, lc-pr-3, lc-pr-1, lc-de-1
Final external links used: []
Observed outcome: PASS: relevant learning/schedule/history only, sourced advice, no search or mutations.

Final reply:
Change the session’s timing and reduce the starting hurdle. Your coding sessions are scheduled across late afternoon and evening, and today’s 21:20 session is still due. Your records show repeated rescheduling, but not why you miss sessions—so treat that as a signal to simplify, not proof of the cause.

Try starting with just 10 minutes on one specific Python exercise, at a time that fits your actual routine. Set up the materials beforehand, attach the session to a routine you already do, and silence notifications while you work. These are Plexecute’s recommendations for reducing friction and protecting focus [Plexecute, 2026; ACM CHI, 2008].

Use practice questions and spread learning across days rather than cramming [Psychological Science in the Public Interest, 2013; Psychological Bulletin, 2006]. If you miss a session, note what got in the way and protect the next one instead of trying to make up extra time [European Journal of Social Psychology, 2010].

### F
Question: What is the difference between a goal and a milestone?
Intent: comparison
Internal knowledge supplied: yes; cited in final reply: yes
Research called: no
Total saved response time: 4.76s; browser elapsed: 6.9s
Tools: get_knowledge_evidence
Knowledge references: lc-go-1, lc-go-4
Final external links used: []
Observed outcome: PASS: stable definition, library and reasoning, no external search or member-data reads.

Final reply:
A goal is the larger outcome you want to achieve. A milestone is a meaningful checkpoint on the way there.

For example, “run a 10K” is a goal; “run 5K comfortably” could be a milestone. Milestones help break a big goal into manageable progress points, often a few weeks apart. [Plexecute, 2026]

## PASS/FAIL
**FAIL overall.** A, B, E and F passed; C and D still fall short in source quality/synthesis. Automatic research execution, selective context and no-mutation behavior worked across all six. A lack of representative employer adverts or verified free terms was disclosed rather than fabricated.

Checks: 785 tests passed, 99 skipped; ESLint zero errors, 36 existing warnings; latest automatic build OK.
No account deletion, bookings, task creation or publishing occurred. Live messages and research are saved on the requesting owner account.
