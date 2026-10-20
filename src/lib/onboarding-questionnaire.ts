export type OnboardingQuestion = {
  id: string;
  q: string;
  multi?: boolean;
  options: string[];
  exclusive?: string[];
  customLabel?: string;
  time?: boolean;
};
export type OnboardingAnswers = Record<string, string[]>;
const QUESTIONS: OnboardingQuestion[] = [
  {
    id: "areas",
    q: "Which parts of life would you like to work on?",
    multi: true,
    options: [
      "Career and work",
      "Business and entrepreneurship",
      "Education and qualifications",
      "Learning a skill or language",
      "Money and financial security",
      "Creative projects",
      "Family and relationships",
      "Home and organisation",
      "Confidence and personal growth",
      "Community and contribution",
      "Travel and lifestyle",
      "Hobbies and personal ambitions",
      "Health and wellbeing",
      "Fitness and sport",
      "Food and nutrition",
      "I'm exploring my direction",
    ],
    exclusive: ["I'm exploring my direction"],
    customLabel: "Another life area",
  },
  {
    id: "work",
    q: "What does your usual week look like?",
    multi: true,
    options: [
      "Monday to Friday, 9am to 5pm",
      "Part-time work",
      "Shift work",
      "Self-employed or running a business",
      "Studying",
      "Work and study",
      "Caring for family or someone else",
      "Looking for work",
      "Taking a career break",
      "Retired",
      "My week varies",
    ],
    customLabel: "Your days and hours",
  },
  {
    id: "wake",
    q: "When do you usually get up?",
    options: ["5:00am", "6:00am", "7:00am", "8:00am", "9:00am", "10:00am", "My routine varies"],
    customLabel: "Another wake-up time",
    time: true,
  },
  {
    id: "sleep",
    q: "When do you usually go to bed?",
    options: ["9:00pm", "10:00pm", "11:00pm", "12:00am", "1:00am", "2:00am", "My routine varies"],
    customLabel: "Another bedtime",
    time: true,
  },
  {
    id: "goalfreq",
    q: "How often would you like to work on your first goal?",
    options: [
      "1 session a week",
      "2 sessions a week",
      "3 sessions a week",
      "4 sessions a week",
      "5 sessions a week",
      "6 sessions a week",
      "7 sessions a week",
      "I'm not sure yet",
    ],
    customLabel: "Another frequency",
  },
  {
    id: "length",
    q: "How much time suits one goal session?",
    options: [
      "10 minutes",
      "15 minutes",
      "20 minutes",
      "30 minutes",
      "45 minutes",
      "60 minutes",
      "90 minutes",
      "120 minutes",
      "I'm not sure yet",
    ],
    customLabel: "Another session length",
  },
  {
    id: "free",
    q: "When could you make time for your goal?",
    multi: true,
    options: [
      "Weekday mornings",
      "Weekday lunchtimes",
      "Weekday afternoons",
      "Weekday evenings",
      "Weekend mornings",
      "Weekend afternoons",
      "Weekend evenings",
      "It varies from week to week",
      "I'm not sure yet",
    ],
    exclusive: ["I'm not sure yet"],
    customLabel: "Your available days and times",
  },
  {
    id: "fixed",
    q: "What time should your plan protect?",
    multi: true,
    options: [
      "Work or study",
      "School runs or childcare",
      "Caring responsibilities",
      "Time with family or a partner",
      "Appointments",
      "Regular clubs or classes",
      "Community or religious commitments",
      "Rest and personal time",
      "None",
    ],
    exclusive: ["None"],
    customLabel: "Commitments, days and times",
  },
  {
    id: "blocker",
    q: "What tends to get in the way?",
    multi: true,
    options: [
      "Not knowing where to start",
      "Too many competing priorities",
      "Limited time",
      "An unpredictable routine",
      "Staying consistent",
      "Confidence or fear of failure",
      "Lack of knowledge or skills",
      "Money or resources",
      "Low energy or stress",
      "Support from other people",
      "Nothing in particular",
    ],
    exclusive: ["Nothing in particular"],
    customLabel: "Another challenge",
  },
  {
    id: "energy",
    q: "When do you usually feel most focused?",
    options: [
      "Early morning",
      "Late morning",
      "Afternoon",
      "Evening",
      "Late at night",
      "It changes day to day",
      "I'm not sure yet",
    ],
    customLabel: "Your focus pattern",
  },
  {
    id: "vision",
    q: "What would you like your life to look like in five years?",
    multi: true,
    options: [
      "Meaningful work or career progress",
      "A successful business",
      "Financial security",
      "A qualification or new expertise",
      "A completed creative ambition",
      "Stronger relationships",
      "A home or lifestyle that suits me",
      "More confidence and independence",
      "Contributing to my community",
      "More travel and experiences",
      "Better health and wellbeing",
      "More time for what matters",
      "I'm not sure yet",
      "I'd rather leave this for later",
    ],
    exclusive: ["I'm not sure yet", "I'd rather leave this for later"],
    customLabel: "Your longer-term direction",
  },
];
const HEALTH: OnboardingQuestion = {
  id: "health",
  q: "Anything your health-related goals need to account for?",
  multi: true,
  options: [
    "None",
    "An injury or mobility restriction",
    "A medical condition",
    "Pregnancy or postpartum recovery",
    "A food allergy or intolerance",
    "Dietary preferences",
    "I'd prefer to discuss this with Coach",
  ],
  exclusive: ["None", "I'd prefer to discuss this with Coach"],
  customLabel: "A restriction to account for",
};
export function onboardingQuestions(answers: OnboardingAnswers): OnboardingQuestion[] {
  const physical = (answers["areas"] ?? []).some((area) =>
    ["Health and wellbeing", "Fitness and sport", "Food and nutrition"].includes(area),
  );
  return physical ? [...QUESTIONS.slice(0, -1), HEALTH, ...QUESTIONS.slice(-1)] : QUESTIONS;
}
export function toggleOnboardingAnswer(
  picked: string[],
  option: string,
  question: OnboardingQuestion,
): string[] {
  if (!question.multi) return [option];
  if (picked.includes(option)) return picked.filter((x) => x !== option);
  if (question.exclusive?.includes(option)) return [option];
  return [...picked.filter((x) => !question.exclusive?.includes(x)), option];
}
export function onboardingTranscript(
  answers: OnboardingAnswers,
  custom: Record<string, string>,
  goal: string,
): string {
  const labels: Record<string, string> = {
    areas: "Life areas of interest (not separate goals)",
    work: "My work/study situation",
    wake: "Usual wake-up time",
    sleep: "Usual bedtime",
    goalfreq: "Preferred frequency for my first goal",
    length: "Preferred session length for my first goal",
    free: "Potential availability (not exact confirmed times)",
    fixed: "Time to protect (ask for exact days/times where missing)",
    blocker: "What gets in my way",
    energy: "My focus and energy pattern",
    health: "Health-related restrictions",
    vision: "In five years, my longer-term direction (not active goals)",
  };
  return [
    `My first goal to work on now: ${goal.trim()}.`,
    ...onboardingQuestions(answers).map((q) => {
      const values = (answers[q.id] ?? []).filter((v) => v !== "My own answer");
      const own = custom[q.id]?.trim();
      if ((answers[q.id] ?? []).includes("My own answer") && own) values.push(own);
      return values.length ? `${labels[q.id]}: ${values.join(", ")}.` : "";
    }),
    "Only my first goal is an active goal. Do not create goals or exact commitment times from life-area selections. Ask about unknown times; do not assume a standard work week or add training unless I requested it.",
  ]
    .filter(Boolean)
    .join("\n");
}
