import { demoBriefing } from "./demo-data";
import type { Briefing, Story } from "./types";

export interface StoryRepository {
  getCurrentBriefing(): Promise<Briefing>;
  getStory(id: string): Promise<Story | null>;
  searchStories(query: string): Promise<Story[]>;
}

export class DemoStoryRepository implements StoryRepository {
  async getCurrentBriefing() {
    return demoBriefing;
  }

  async getStory(id: string) {
    return demoBriefing.stories.find((story) => story.id === id) ?? null;
  }

  async searchStories(query: string) {
    const needle = query.trim().toLowerCase();
    if (!needle) return demoBriefing.stories;

    return demoBriefing.stories.filter((story) =>
      [
        story.title,
        story.summary,
        story.category,
        story.country,
        story.region,
        story.tags.join(" "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }
}

export const storyRepository: StoryRepository = new DemoStoryRepository();
