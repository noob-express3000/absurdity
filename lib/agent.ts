import { demoBriefing } from "./demo-data";
import type { Story } from "./types";

export type AgentReply = {
  text: string;
  storyId?: string;
  storyIds?: string[];
  intent: string;
};

function storyLine(story: Story) {
  return "#" + story.rank + " — " + story.title + " (" + story.country + ", " + story.confidence + " confidence)";
}

function findByNumber(input: string) {
  const match = input.match(/(?:number|#)\s*(\d+)/i);
  if (!match) return null;
  const rank = Number(match[1]);
  return demoBriefing.stories.find((story) => story.rank === rank) ?? null;
}

function chooseCurrent(storyId?: string) {
  return demoBriefing.stories.find((story) => story.id === storyId) ?? demoBriefing.stories[0];
}

export function answerFromCorpus(message: string, storyId?: string): AgentReply {
  const input = message.toLowerCase().trim();
  const numbered = findByNumber(input);
  const current = numbered ?? chooseCurrent(storyId);

  if (input.includes("south africa")) {
    const matches = demoBriefing.stories.filter((story) => story.country === "South Africa");
    return {
      text: matches.length
        ? "I found one South African fixture in today's seeded briefing: " + storyLine(matches[0]) + "."
        : "There are no South African stories in this briefing.",
      storyId: matches[0]?.id,
      storyIds: matches.map((story) => story.id),
      intent: "filter-country",
    };
  }

  if (input.includes("africa")) {
    const matches = demoBriefing.stories.filter((story) => story.region === "Africa");
    return {
      text: matches.length
        ? "Africa has " + matches.length + " selected story in this seeded briefing: " + matches.map(storyLine).join(" ")
        : "There are no African stories in this briefing.",
      storyId: matches[0]?.id,
      storyIds: matches.map((story) => story.id),
      intent: "filter-region",
    };
  }

  if (input.includes("animal")) {
    const matches = demoBriefing.stories.filter((story) => story.category === "Animals" || story.tags.includes("animal"));
    return {
      text: "Animal stories in this briefing: " + matches.map(storyLine).join(" "),
      storyId: matches[0]?.id,
      storyIds: matches.map((story) => story.id),
      intent: "filter-category",
    };
  }

  if (input.includes("nothing political") || input.includes("skip politics") || input.includes("stop politics")) {
    const matches = demoBriefing.stories.filter((story) => !story.tags.includes("politics"));
    return {
      text: "Politics excluded. All " + matches.length + " seeded selections in this briefing are non-political.",
      storyIds: matches.map((story) => story.id),
      intent: "exclude-politics",
    };
  }

  if (input.includes("harmless")) {
    const matches = demoBriefing.stories.filter((story) => story.seriousness === "harmless");
    return {
      text: "I have " + matches.length + " harmless selections. The strongest is " + storyLine(matches[0]) + ".",
      storyId: matches[0]?.id,
      storyIds: matches.map((story) => story.id),
      intent: "filter-seriousness",
    };
  }

  if (input.includes("top five") || input.includes("top 5")) {
    const matches = demoBriefing.stories.slice(0, 5);
    return {
      text: matches.map(storyLine).join("\n"),
      storyId: matches[0].id,
      storyIds: matches.map((story) => story.id),
      intent: "top-five",
    };
  }

  if (input.includes("weirdest") || input.includes("strangest")) {
    return {
      text: "The strongest harmless absurdity in this briefing is " + storyLine(demoBriefing.stories[0]) + ". " + demoBriefing.stories[0].summary,
      storyId: demoBriefing.stories[0].id,
      intent: "weirdest",
    };
  }

  if (input.includes("did this actually happen") || input.includes("did that actually happen") || input.includes("believe it") || input.includes("confidence")) {
    return {
      text: current.isFixture
        ? "This is Seeded Demo Mode, so the story itself is a controlled fixture rather than a live claim. The product is demonstrating the verification model: " + current.sources.length + " fixture source(s), " + current.confidence + " confidence, and explicit notes that never masquerade as live verification."
        : current.verificationNotes,
      storyId: current.id,
      intent: "verification",
    };
  }

  if (input.includes("source")) {
    return {
      text: current.sources.map((source) => source.publisher + " — " + source.url).join("\n"),
      storyId: current.id,
      intent: "sources",
    };
  }

  if (input.includes("when did") || input.includes("event date")) {
    return {
      text: "Event date: " + current.eventDate + ". Publication date: " + current.publicationDate + ". Absurdity stores those separately so old events are not presented as new just because reporting is new.",
      storyId: current.id,
      intent: "event-date",
    };
  }

  if (input.includes("why") && input.includes("weird")) {
    return {
      text: current.whyItsWeird,
      storyId: current.id,
      intent: "why-weird",
    };
  }

  if (input.includes("go deeper") || input.includes("tell me more") || input.includes("tell me about this story")) {
    return {
      text: current.detailedSummary,
      storyId: current.id,
      intent: "deep-dive",
    };
  }

  if (numbered) {
    return {
      text: storyLine(numbered) + ". " + numbered.summary,
      storyId: numbered.id,
      intent: "select-number",
    };
  }

  if (input.includes("next")) {
    const index = demoBriefing.stories.findIndex((story) => story.id === current.id);
    const next = demoBriefing.stories[(index + 1) % demoBriefing.stories.length];
    return {
      text: storyLine(next) + ". " + next.summary,
      storyId: next.id,
      intent: "next",
    };
  }

  return {
    text: "I couldn’t answer that from the demo stories.",
    storyId: current.id,
    intent: "help",
  };
}

