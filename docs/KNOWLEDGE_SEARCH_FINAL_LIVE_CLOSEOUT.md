# Knowledge + Search final live closeout

17 October 2026. Only D–H submitted, sequentially through authenticated Coach. A–C not rerun. Existing member account/session used; these execution requests changed its real Learning, Training and plan records. Nothing published.

## Results

Times are recorded Coach processing times, not browser polling delays. Browser-visible completion was approximately 7–9 seconds later (polling/stabilisation included). D's original runner waited 522 seconds because its message-count detection was wrong; the saved reply actually completed in 24.5 seconds and its screenshot confirmed it.

| Test | Knowledge | Member context | Live research | Systems invoked | Processing time | Result |
| --- | --- | --- | --- | --- | --- | --- |
| D: organic marketing | Yes: le-1, lc-le-1, lc-pr-1 | Yes: existing Learning searches/goals and occupied plan times read by the bridge | Yes on first discovery, within Learning; no new search on repeat | build_learning_pathway → existing Learning discovery, learning_searches/topics/resources and execution queue | 24.5s first; 7.5s repeat | PASS |
| E: £10,000 / 18 months | Yes: finance passages lc-fi-1/lc-fi-2 | Yes: get_life_twin, get_goals | No | Existing Coach knowledge/context reads; no mutations on retry | 9.7s after fix (initial failed clarification: 5.7s) | PASS after live failure fix |
| F: stronger at home, no equipment | Yes: lc-rt-5, pa-3, lc-pr-1 | Yes: goals, mission, schedule, training context/history | No new research; final turn also read previously saved research | Existing Training programme/version and prescriptions; update_goal, change_training_programme, request_replan | 32.5s final | PASS after live failure fixes |
| G: current UK social-worker qualifications | Yes: career/learning background only | No: general factual question | Yes: fresh research_topic + get_research_findings | Existing research system | 108.1s | PASS |
| H: leave job, retrain, save, keep training | Yes: career/transitions, finance, goals and training | Yes: get_life_intelligence, get_mission, get_goals, get_plan | Yes initially for qualification/funding options (233.5s browser-observed completion); no new research on final repeat because current research was already available | Existing Goal Mission, goals, execution queue and weekly planner | 49.9s final | PASS after live schedule fix |

## Concrete verification

- D saved five relevant resources and five ordered Learning topics. First discovery scheduled three protected study sessions. Repeating the identical request reused the same goal/search/resources; one matching goal, zero duplicate resource URLs. Subsequent general replans also scheduled learning time. Learning page read-back displayed all five resources.
- E calculated £10,000 / 18 = £555.56 monthly, displayed approximately £556, with a clearly stated £0 starting-balance/no-interest assumption. Current savings and affordability remained unknown rather than invented. Finance knowledge cited Money and Pensions Service. No research or mission/plan writes on the successful retry.
- F saved a bodyweight programme and actual floor-only prescriptions: squats, push-ups, glute bridges, pike push-ups, prone W raises, planks and calf raises. No dumbbells, bands, table or towel required. Prone W raises provide scapular work, not an equivalent to loaded pulling. Training page read-back confirmed the exercises. Existing 07:00 preference remained; actual Monday/Friday placement moved to 07:30 around preserved wake-up time, Wednesday stayed 07:00.
- G distinguished England, Scotland, Wales and Northern Ireland, approved qualifications and registration. A dated 2024 Step Up source was labelled and current programme criteria were explicitly left to checking. Clickable links preserved in saved response and visible Coach.
- H retained income while researching retraining, treated £556 as an affordability benchmark rather than a confirmed budget, preserved learning/training and scheduled a real budget-baseline task. Social work was treated as an option from prior conversation, not an assumed chosen career. Final database check: zero future planned-block overlaps and zero overlaps with active saved commitments. Existing work/study constraints were supplied to the planner.

## Research sources

D's Learning discovery: [HubSpot Academy](https://academy.hubspot.com/courses/digital-marketing), [University of Minnesota Open Textbook Library](https://open.umn.edu/opentextbooks/textbooks/emarketing-the-essential-guide-to-marketing-in-a-digital-world), [organic marketing video](https://www.youtube.com/watch?v=IQPo6MUkkIo), [Domestika tutorials](https://www.domestika.org/en/blog/9309-9-free-digital-marketing-tutorials-to-grow-your-brand), [Girls in Marketing](https://www.girlsinmarketing.com/free-marketing-courses).

G: [GOV.UK regulated profession](https://www.regulated-professions.service.gov.uk/professions/social-worker-3), [Social Work England approved courses](https://www.socialworkengland.org.uk/education-training/search-approved-courses/), [SSSC](https://www.sssc.uk.com/careers-and-education/social-work/), [Social Care Wales](https://socialcare.wales/qualifications-funding/social-work-qualifications), [NISCC](https://niscc.info/degree-in-social-work/), [government qualification routes](https://support-for-social-workers.education.gov.uk/become-a-social-worker/ways-to-qualify-as-a-social-worker). Additional checked sources: National Careers Service, NHS Health Careers, Social Work England registration, government apprenticeship guidance and the explicitly dated 2024 government article.

H's initial research: government social-work qualification/apprenticeship/postgraduate routes, Social Work England, SSSC, [MoneyHelper budgeting](https://www.moneyhelper.org.uk/en/everyday-money/budgeting/beginners-guide-to-managing-your-money), [MoneyHelper planner](https://www.moneyhelper.org.uk/en/everyday-money/budgeting/budget-planner), [NHSBSA bursary guidance](https://www.nhsbsa.nhs.uk/social-work-bursary-swb), plus a JobClerk vacancy lead. No employer-demand generalisation made from that lead. Final repeat used existing context without another search.

## Changes made only after observed failures

1. E: embedded personal advice question was classified as execution, entering mission clarification and re-asking an already given horizon. Extended existing information-only classification to embedded “how should/could/can/do I/we” questions, preserving explicit execution overrides; personal “I need/I want” requests can read relevant member context. Added exact-message regression.
2. H/F: proposal considered routine occurrences replaceable but approval preserved them. Added shared occurrence eligibility that keeps routine/commitment rows fixed; live reruns removed wake/workout clashes. Added concrete 06:00–06:10 wake vs 45-minute workout regression.
3. F: Training page revealed bodyweight template table/towel rows. Classified those as requiring home equipment and replaced floor-only template slots with prone W raises; exact demo matching added. Live programme read-back and regression confirm no table/towel row.
4. Check hygiene: source review test now uses a fixed dated fixture instead of assuming the first live source is overdue after its review date was updated. Cleared formatting-only errors left by the preceding knowledge upgrade; no behaviour changes for formatting.

## Checks and verdict

- Automated suite: 814 passed, 99 skipped; no failing tests.
- ESLint: zero errors, 36 existing warnings.
- Automatic preview build: OK; no browser page errors during D–H.
- Learning, Training and Calendar read-back completed through the signed-in UI.
- No new knowledge store, no research redesign, no pricing or entitlement changes; A–C not rerun.
- **FINAL: PASS for D–H live closeout.** Nothing published. These are measured single-run timings, not a latency benchmark; fresh broad research remains materially slower than knowledge/context turns.