export type Confidence = "high" | "medium" | "low";
export type Seriousness = "harmless" | "mixed" | "serious";

export type StorySource = {
  publisher: string;
  url: string;
  publishedAt: string;
  sourceType: "primary" | "local" | "national" | "institutional" | "search" | "demo-fixture";
};

export type ResearchStep = {
  label: string;
  detail: string;
  status: "complete" | "warning";
  at: string;
};

export type Story = {
  id: string;
  rank: number;
  title: string;
  shortTitle: string;
  summary: string;
  detailedSummary: string;
  whyItsWeird: string;
  category: string;
  tags: string[];
  country: string;
  region: string;
  eventDate: string;
  publicationDate: string;
  discoveredAt: string;
  absurdityScore: number;
  noveltyScore: number;
  humorScore: number;
  seriousnessScore: number;
  credibilityScore: number;
  confidence: Confidence;
  seriousness: Seriousness;
  clusterId: string;
  sources: StorySource[];
  verificationNotes: string;
  status: "selected" | "verified" | "candidate";
  research: ResearchStep[];
  isFixture?: boolean;
};

export type Briefing = {
  id: string;
  label: string;
  mode: "demo" | "live";
  generatedAt: string;
  window: string;
  stats: {
    scanned: number;
    unusual: number;
    verified: number;
    selected: number;
    countries: number;
  };
  stories: Story[];
};


export type IngestedEvidence = {
  publisher: string;
  title: string;
  url: string;
  resolvedUrl: string;
  text: string;
  publishedAt?: string;
  fetchedAt: string;
  status: "article" | "excerpt" | "unavailable";
  method: "readability" | "rss" | "search";
  originalLength: number;
  truncated: boolean;
  contentHash: string;
  error?: string;
};
