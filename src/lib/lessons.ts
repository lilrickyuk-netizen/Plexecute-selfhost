export type Lesson = {
  id: string;
  title: string;
  minutes: number;
  body: string[];
  example: string;
  takeaway: string;
  action: string;
};

export const LESSONS: Lesson[] = [
  {
    id: "plan-vs-intent",
    title: "Turn an intention into an action",
    minutes: 3,
    body: [
      "A goal describes an outcome: pass an exam, become stronger, or learn a language. An action describes something you can actually do: answer practice questions, complete a set, or practise a conversation. You cannot directly execute an outcome, but you can execute the actions that move you towards it.",
      "An implementation intention links an action to a recognisable situation: ‘When this happens, I will do that.’ A useful cue can be a time, a place or an existing routine. The cue should be specific enough that you can tell whether it happened, rather than relying on ‘when I feel motivated’.",
      "Define the first observable step. ‘Study accounting’ leaves several decisions unresolved. ‘Sit at the desk, open the cash-flow questions and attempt the first question without notes’ removes those decisions from the moment you need to begin.",
      "Preparation matters too. Identify the materials, location and access you need before the session. A clear cue will not help if the textbook is missing or the chosen time clashes with a fixed commitment. Check feasibility rather than treating a missed cue as a character flaw.",
    ],
    example:
      "Intention: ‘I want to improve my Spanish.’ Action plan: ‘After breakfast at the kitchen table, I will open my saved dialogue and practise saying both parts aloud.’ Success is doing the practice, not becoming fluent in one sitting.",
    takeaway: "An executable plan connects a clear cue to a specific first action.",
    action:
      "Choose one goal. Write its next observable action, the cue that will start it, and what you need ready beforehand. Close the lesson and explain the difference between the goal and the action in your own words.",
  },
  {
    id: "minimum-dose",
    title: "Design a useful smaller session",
    minutes: 3,
    body: [
      "A smaller session is a deliberate reduction in scope when time or capacity is limited. It is not the same as pretending a full session happened. The aim is to keep a useful connection with the task while being honest about what was completed.",
      "Find the essential skill inside the original session. For studying, that might be recalling a concept and checking the answer. For writing, it might be drafting one argument. Removing setup and optional extras can preserve useful practice without demanding the original workload.",
      "Decide the smaller version before a difficult day arrives. Specify its starting action and finishing condition. ‘Do something’ is vague; ‘attempt one question, check the solution and note the error’ has a clear boundary and a learning outcome.",
      "A reduced session cannot replace every full session indefinitely. If you repeatedly need the fallback, review the workload, timing or goal priority. Rest may be more appropriate than doing a smaller version when you are ill, injured or unable to work safely.",
    ],
    example:
      "Original session: work through a chapter and its practice questions. Smaller version: answer one question from memory, compare it with the worked solution, and write what you missed. This preserves retrieval and feedback, not the full chapter's coverage.",
    takeaway:
      "Reduce the scope while preserving a useful action; do not confuse reduced work with full completion.",
    action:
      "Describe the normal session for one goal, then design a smaller version with a clear finishing condition. Name one circumstance where resting or rescheduling would be the safer choice.",
  },
  {
    id: "missed-not-failed",
    title: "Learn from a missed session",
    minutes: 4,
    body: [
      "A missed session is an observation, not a complete explanation. ‘I did not start’ tells you what happened. ‘I am lazy’ is a judgement that does not identify a change you can test. Separate the event from the story you tell about yourself.",
      "Reconstruct the sequence: what was planned, what happened just before it, and what prevented the first action? Common barriers include an overrun elsewhere, missing materials, an unclear task, competing responsibilities or insufficient energy. More than one barrier can be present.",
      "Distinguish a one-off disruption from a repeated pattern. An unexpected emergency calls for a different response from a session that is regularly scheduled immediately after an exhausting shift. Patterns are more useful than drawing a conclusion from a single day.",
      "Choose a change that addresses the barrier you observed. If setup was the problem, prepare materials. If the task was unclear, define the first step. If the workload was unrealistic, reduce or reschedule it. Adding more reminders will not solve every kind of friction.",
    ],
    example:
      "Observation: ‘I missed evening study after work on several occasions.’ Barrier: the shift overran and I arrived home tired. Testable adjustment: move the demanding study task to a feasible free window rather than doubling tomorrow's workload.",
    takeaway: "Describe the barrier precisely enough that your next adjustment can address it.",
    action:
      "For a missed session, write three separate lines: the facts, the likely barrier, and one adjustment. Explain what you would look for next time to decide whether the adjustment helped.",
  },
  {
    id: "sleep-anchor",
    title: "Understand sleep timing and recovery",
    minutes: 4,
    body: [
      "Sleep is influenced by both sleep pressure and your body clock. Sleep pressure builds while you are awake and falls during sleep. Your body clock helps organise periods of alertness and sleepiness across the day. Feeling tired and being ready to sleep are therefore not always the same thing.",
      "Light is an important timing signal for the body clock. Daylight during your waking day and a calmer, less brightly lit environment before bed can support a clear distinction between daytime and night-time. The practical timing depends on your routine, especially if you work shifts.",
      "A reasonably consistent sleep opportunity gives your routine a stable foundation. Protecting enough time for sleep is different from forcing yourself to fall asleep at an exact minute. Travel, caring responsibilities and shift work can require a different approach rather than a rigid rule.",
      "Observe patterns rather than judging recovery from a single night or a device score. Note sleep timing, how you feel and whether daily tasks are manageable. Persistent sleep difficulties, breathing problems during sleep or severe daytime sleepiness should be discussed with a qualified health professional.",
    ],
    example:
      "If late-night work repeatedly delays bedtime while the morning alarm stays fixed, the available sleep window shrinks. Changing the evening workload may help more than adding another recovery supplement or treating a wearable score as a diagnosis.",
    takeaway:
      "Sleep opportunity, timing and daily functioning matter more than chasing one perfect sleep score.",
    action:
      "Identify one part of your routine that repeatedly reduces your sleep opportunity and one feasible adjustment. Explain the difference between sleep pressure and the body clock without looking back at the lesson.",
  },
  {
    id: "progressive-overload",
    title: "Understand progressive overload",
    minutes: 4,
    body: [
      "Training provides a stimulus; adaptation happens as the body recovers from that stimulus. Progressive overload means gradually changing the demands as your capacity improves. It does not mean making every workout harder regardless of fatigue or technique.",
      "Load is only one way to change demand. Repetitions, sets, range of motion and control can also matter. Compare like with like: lifting more weight with a shorter range of motion is not necessarily an improvement in the same task.",
      "A training record makes progression interpretable. Record the exercise, load, repetitions and relevant effort or technique notes. If several things change together, it becomes harder to tell whether performance improved or the exercise simply became different.",
      "Increase demands only when the current work is manageable with suitable technique and recovery. A plateau does not automatically call for more volume: fatigue, inconsistent practice or an unsuitable exercise may need attention. Sharp pain, dizziness or other concerning symptoms are reasons to stop and seek appropriate advice, not push through for a personal best.",
    ],
    example:
      "You repeat an exercise with the same load and range of motion, but complete the planned repetitions with better control. That is useful progress. The next change can be small and deliberate rather than changing load, sets and repetitions all at once.",
    takeaway:
      "Progression is a gradual, measurable change in demand supported by technique and recovery.",
    action:
      "Choose an exercise you already perform safely. Describe what you would record, what would count as comparable progress, and what would tell you not to increase the demand yet.",
  },
  {
    id: "protein-first",
    title: "Build a balanced meal with protein",
    minutes: 3,
    body: [
      "Protein supplies amino acids used to build and maintain body tissues, including muscle. It supports recovery, but it does not replace sufficient overall food intake, training or sleep. A meal should be considered as a whole rather than judged by protein alone.",
      "Protein foods include beans, lentils, tofu, eggs, dairy, fish and meat. Different foods also supply different nutrients, so variety matters. Choose options that fit your preferences, budget, allergies and dietary needs rather than assuming one food is essential.",
      "Build the rest of the meal around its role in your day: include suitable carbohydrate foods, vegetables or fruit, and sources of fat. Carbohydrate supports activity; fats have essential roles; fibre contributes to a balanced diet. These are complementary, not competitors to protein.",
      "Food labels require attention to units. A value per 100 grams is not automatically the amount in your portion. Multiply the per-100-gram value by your portion weight divided by 100, and compare foods in the same prepared state. Personal targets should follow your individual plan; medical dietary restrictions need professional guidance.",
    ],
    example:
      "A label lists 8 grams of protein per 100 grams. A 150-gram portion supplies 12 grams: 8 × 150 ÷ 100. A lentil meal can pair that protein source with vegetables and a carbohydrate food rather than treating the protein number as the whole meal.",
    takeaway:
      "Protein is one part of a balanced meal, and the amount eaten depends on the actual portion.",
    action:
      "Choose a familiar meal and identify its protein source, carbohydrate, vegetables or fruit, and fat source. Using a food label, explain how you would calculate protein for the portion you actually eat.",
  },
  {
    id: "one-change",
    title: "Run an interpretable personal experiment",
    minutes: 4,
    body: [
      "A personal experiment starts with a question you can observe: ‘Does preparing my study materials beforehand make it easier to start?’ This is more useful than ‘How do I become more productive?’ because it names a change and a result.",
      "A baseline describes what happens before the change. Choose an outcome you can record consistently, such as whether you started the planned session. Define that outcome in advance so you do not change the meaning of success after seeing the results.",
      "Change one main factor while keeping other conditions as comparable as practical. If you change bedtime, caffeine, training and study location together, an improvement cannot be confidently assigned to any one of them. Record disruptions such as illness or unusual work hours rather than hiding them.",
      "A difference between two periods is not proof of cause. Chance, expectations and other circumstances can affect the result. Treat the outcome as evidence for a practical decision, not a universal scientific conclusion. Do not experiment by stopping prescribed treatment or ignoring medical advice.",
    ],
    example:
      "Question: does putting the book and practice questions on the desk beforehand help me start? Outcome: whether the planned study session starts. Keep the task and timing comparable, note disruptions, and compare the observations before deciding whether to keep the preparation routine.",
    takeaway:
      "A clear question, one main change and a consistent measure make an experiment easier to interpret.",
    action:
      "Write a question, the single change you would test and the outcome you would record. Name one alternative explanation for an apparent improvement and how you would notice it.",
  },
  {
    id: "weekly-review",
    title: "Review actions against outcomes",
    minutes: 5,
    body: [
      "An action measure describes what you did; an outcome measure describes what changed. Completing study sessions is an action measure. Answering exam questions more accurately is an outcome measure. Both matter: consistent activity can still need a different method if learning is not improving.",
      "Begin a review with observations rather than a verdict. What was planned, what was actually completed, and what evidence of progress is available? Separate missing information from poor results. If you did not record a result, you cannot honestly call it either success or failure.",
      "Look for patterns across comparable sessions. Repeated interruptions may indicate a timing problem; regular practice without improving accuracy may indicate that you need more feedback or a different study method. An isolated difficult session does not necessarily justify replacing the whole plan.",
      "Decide what to keep, change or pause. Keep actions that are useful and feasible. Change one clearly identified problem. Pause a lower-priority commitment when capacity is genuinely insufficient rather than silently scheduling more than you can do. Check that the revised plan still fits fixed obligations and recovery needs.",
      "Finish with a testable next step and a way to check it. ‘Try harder’ gives you no evidence to review later. ‘Attempt questions before reading the answer, then record the errors’ connects a method to an observable result.",
    ],
    example:
      "You attended each study session but repeated the same mistakes on practice questions. Attendance is improving, but accuracy is not. A useful adjustment is to review and explain the errors before adding more study time; the next review can compare whether those errors recur.",
    takeaway:
      "Review both what you did and what changed, then make a feasible, testable adjustment.",
    action:
      "For one goal, write an action measure and an outcome measure. Summarise what to keep, one change to test, and what evidence you will use at the next review.",
  },
];
