// Starter pathways: a beginner syllabus with official, link-checked resources for common goals,
// seeded when a goal is created so its first scheduled session is executable straight away.
// Only subjects listed here are seeded; anything else keeps the honest "still needs confirming" state.
// Every URL below was checked live (HTTP 200) and comes from the subject's official/recognised provider.

export type StarterTopic = {
  title: string;
  steps: string[];
  resource: { title: string; url: string; kind: string };
};
export type StarterMilestone = {
  key: string;
  title: string;
  depends_on: string[];
  actions: { title: string; minutes: number; capability: string }[];
  sources: { url: string; title: string; publisher: string }[];
  evidence_type: string;
};
export type Starter = {
  key: string;
  level: "beginner";
  topics?: StarterTopic[];
  milestones?: StarterMilestone[];
};

const PY = "Python Software Foundation";
const MDN = "MDN Web Docs (Mozilla)";
export const PYTHON_BASICS: StarterTopic[] = [
  {
    title: "Python basics: variables, numbers and text",
    steps: [
      "Read 'An informal introduction to Python'",
      "Type every example into Python yourself",
      "Write a 3-line program that stores your name and prints a greeting",
    ],
    resource: {
      title: "Python tutorial — An informal introduction",
      url: "https://docs.python.org/3/tutorial/introduction.html",
      kind: "article",
    },
  },
  {
    title: "Conditions and basic logic (if, for, while)",
    steps: [
      "Read the 'if', 'for' and 'range' sections",
      "Write a loop that prints 1 to 10",
      "Add an if that prints only even numbers",
    ],
    resource: {
      title: "Python tutorial — More control flow tools",
      url: "https://docs.python.org/3/tutorial/controlflow.html",
      kind: "article",
    },
  },
  {
    title: "Functions",
    steps: [
      "Read 'Defining functions'",
      "Write a function that adds two numbers",
      "Call it with three different inputs",
    ],
    resource: {
      title: "Python tutorial — Defining functions",
      url: "https://docs.python.org/3/tutorial/controlflow.html#defining-functions",
      kind: "article",
    },
  },
  {
    title: "Lists and dictionaries",
    steps: [
      "Read 'More on lists' and 'Dictionaries'",
      "Store 5 items in a list and loop over them",
      "Build a small phone-book dictionary",
    ],
    resource: {
      title: "Python tutorial — Data structures",
      url: "https://docs.python.org/3/tutorial/datastructures.html",
      kind: "article",
    },
  },
  {
    title: "First small project",
    steps: [
      "Pick a tiny program (to-do list or quiz)",
      "Plan it in 3 bullet points",
      "Build it using what you have learned",
    ],
    resource: {
      title: "CS50's Introduction to Programming with Python (Harvard)",
      url: "https://cs50.harvard.edu/python/",
      kind: "course",
    },
  },
];
const WEB_BASICS: StarterTopic[] = [
  {
    title: "HTML: structuring a web page",
    steps: [
      "Read MDN 'Structuring content with HTML'",
      "Build a one-page HTML profile about yourself",
      "Open it in your browser",
    ],
    resource: {
      title: "MDN — Structuring content with HTML",
      url: "https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Structuring_content",
      kind: "article",
    },
  },
  {
    title: "CSS: styling basics",
    steps: [
      "Read MDN 'CSS styling basics'",
      "Style your profile page: fonts, colours, spacing",
      "Make it readable on your phone",
    ],
    resource: {
      title: "MDN — CSS styling basics",
      url: "https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Styling_basics",
      kind: "article",
    },
  },
  {
    title: "JavaScript: first scripts",
    steps: [
      "Read MDN 'Dynamic scripting with JavaScript'",
      "Add a button that changes text on your page",
      "Fix any error the browser console shows",
    ],
    resource: {
      title: "MDN — Dynamic scripting with JavaScript",
      url: "https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Scripting",
      kind: "article",
    },
  },
];

const FULL_STACK: StarterMilestone[] = [
  {
    key: "fs_foundations",
    title: "Programming foundations",
    depends_on: [],
    evidence_type: "user_confirms",
    actions: [
      {
        title: "Complete the Python basics topics in your learning plan",
        minutes: 300,
        capability: "PLEXECUTE_EXECUTES",
      },
      {
        title: "Set up Git and save your first project",
        minutes: 60,
        capability: "MEMBER_MUST_ACT",
      },
    ],
    sources: [
      { url: "https://docs.python.org/3/tutorial/", title: "The Python tutorial", publisher: PY },
      { url: "https://git-scm.com/book/en/v2", title: "Pro Git book", publisher: "Git project" },
    ],
  },
  {
    key: "fs_frontend",
    title: "Front end: HTML, CSS and JavaScript",
    depends_on: ["fs_foundations"],
    evidence_type: "document",
    actions: [
      {
        title: "Build and publish a personal web page",
        minutes: 600,
        capability: "MEMBER_MUST_ACT",
      },
    ],
    sources: [
      {
        url: "https://developer.mozilla.org/en-US/docs/Learn_web_development",
        title: "Learn web development",
        publisher: MDN,
      },
      { url: "https://react.dev/learn", title: "React — Quick start", publisher: "React (Meta)" },
    ],
  },
  {
    key: "fs_backend",
    title: "Back end and databases",
    depends_on: ["fs_frontend"],
    evidence_type: "document",
    actions: [
      {
        title: "Build a small API that saves data to a database",
        minutes: 900,
        capability: "MEMBER_MUST_ACT",
      },
    ],
    sources: [
      {
        url: "https://nodejs.org/en/learn/getting-started/introduction-to-nodejs",
        title: "Introduction to Node.js",
        publisher: "OpenJS Foundation",
      },
      {
        url: "https://www.postgresql.org/docs/current/tutorial.html",
        title: "PostgreSQL tutorial",
        publisher: "PostgreSQL",
      },
    ],
  },
  {
    key: "fs_portfolio",
    title: "Full-stack portfolio project",
    depends_on: ["fs_backend"],
    evidence_type: "document",
    actions: [
      {
        title: "Build one complete app and put it on your CV",
        minutes: 1800,
        capability: "MEMBER_MUST_ACT",
      },
    ],
    sources: [
      {
        url: "https://www.theodinproject.com/paths/full-stack-javascript",
        title: "Full Stack JavaScript path",
        publisher: "The Odin Project",
      },
    ],
  },
];

/** Picks a starter for a goal title, or null when Plexecute has no checked route for it. */
export function starterFor(title: string, domain: string): Starter | null {
  const t = title.toLowerCase();
  if (/full[- ]?stack|software (developer|engineer)|web developer/.test(t))
    return domain === "learning"
      ? { key: "web", level: "beginner", topics: [...PYTHON_BASICS.slice(0, 2), ...WEB_BASICS] }
      : { key: "full_stack", level: "beginner", milestones: FULL_STACK };
  if (/\b(html|css|javascript|web ?dev|website)/.test(t))
    return { key: "web", level: "beginner", topics: WEB_BASICS };
  if (/\b(cod(e|ing)|program(ming)?|python)\b/.test(t))
    return { key: "python", level: "beginner", topics: PYTHON_BASICS };
  return null;
}

/** Stored on learning_resources.content so the session shows the resource for today's topic. */
export const topicTag = (topic: string) => `topic:${topic}`;

export const STARTER_TOPICS = new Map([...PYTHON_BASICS, ...WEB_BASICS].map((t) => [t.title, t]));
