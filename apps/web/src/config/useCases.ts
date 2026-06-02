export type UseCaseId = "dao" | "grants" | "bounty" | "allocation";

export interface UseCase {
  id: UseCaseId;
  nav: string;
  tagline: string;
  title: string;
  oneLine: string;
  inputLabel: string;
  defaultValue: number;
  traditional: string;
  subrosa: string;
  examples: Array<{ name: string; value: number }>;
}

export const USE_CASES: UseCase[] = [
  {
    id: "dao",
    nav: "DAO Vote",
    tagline: "Governance",
    title: "Join a sealed DAO vote as the last voter.",
    oneLine: "Votes stay hidden until Drand R, then anyone can open the full result.",
    inputLabel: "your vote weight",
    defaultValue: 72,
    traditional: "Late voters see momentum and can pile onto the visible winner.",
    subrosa: "Your vote is sealed on-chain; the DAO only sees the final opened set.",
    examples: [
      { name: "Member A", value: 61 },
      { name: "Member B", value: 70 },
      { name: "Member C", value: 66 },
    ],
  },
  {
    id: "grants",
    nav: "Grant Scores",
    tagline: "Judging",
    title: "Score a grant without leaking the jury board.",
    oneLine: "A final judge cannot be influenced by seeing everyone else's score.",
    inputLabel: "your score",
    defaultValue: 87,
    traditional: "The leaderboard leaks early and scoring becomes political.",
    subrosa: "Every judge commits sealed; the keeper opens all scores together.",
    examples: [
      { name: "Judge A", value: 82 },
      { name: "Judge B", value: 91 },
      { name: "Judge C", value: 76 },
    ],
  },
  {
    id: "bounty",
    nav: "Bounty Track",
    tagline: "Hackathons",
    title: "Submit a bounty evaluation without tipping the meta.",
    oneLine: "Teams cannot infer the winning range before close.",
    inputLabel: "your evaluation",
    defaultValue: 94,
    traditional: "Visible evaluations let teams optimize for leaked judging patterns.",
    subrosa: "Submissions and evaluations stay private until the reveal round.",
    examples: [
      { name: "Reviewer 1", value: 89 },
      { name: "Reviewer 2", value: 92 },
      { name: "Reviewer 3", value: 84 },
    ],
  },
  {
    id: "allocation",
    nav: "Token Allocation",
    tagline: "Distribution",
    title: "Enter an allocation round before demand is visible.",
    oneLine: "Early visibility cannot distort participation or pricing.",
    inputLabel: "your allocation signal",
    defaultValue: 120,
    traditional: "Participants see demand forming and change behavior before close.",
    subrosa: "Demand is sealed until R; clearing uses one public reveal set.",
    examples: [
      { name: "Cohort A", value: 104 },
      { name: "Cohort B", value: 133 },
      { name: "Cohort C", value: 118 },
    ],
  },
];

export function getUseCase(id: UseCaseId) {
  return USE_CASES.find((item) => item.id === id) ?? USE_CASES[0];
}
