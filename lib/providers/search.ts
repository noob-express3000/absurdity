export type SearchHit = {
  title: string;
  url: string;
  text?: string;
};

export interface SearchProvider {
  search(query: string, limit?: number): Promise<SearchHit[]>;
}

export class ExaSearchProvider implements SearchProvider {
  constructor(private apiKey = process.env.EXA_API_KEY) {}

  async search(query: string, limit = 5) {
    if (!this.apiKey) throw new Error("Exa is not configured.");
    const response = await fetch("https://api.exa.ai/search", {
      signal: AbortSignal.timeout(20000),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify({ query, numResults: limit, type: "auto", contents: { text: { maxCharacters: 1800 } } }),
    });
    if (!response.ok) throw new Error("Exa request failed with status " + response.status);
    const payload = await response.json();
    return (payload.results || []).map((item: any) => ({
      title: item.title || item.url,
      url: item.url,
      text: item.text,
    }));
  }
}

export class TavilySearchProvider implements SearchProvider {
  constructor(private apiKey = process.env.TAVILY_API_KEY) {}

  async search(query: string, limit = 5) {
    if (!this.apiKey) throw new Error("Tavily is not configured.");
    const response = await fetch("https://api.tavily.com/search", {
      signal: AbortSignal.timeout(20000),
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        max_results: limit,
        search_depth: "basic",
        include_answer: false,
      }),
    });
    if (!response.ok) throw new Error("Tavily request failed with status " + response.status);
    const payload = await response.json();
    return (payload.results || []).map((item: any) => ({
      title: item.title || item.url,
      url: item.url,
      text: item.content,
    }));
  }
}

export function getSearchProvider(): SearchProvider | null {
  if (process.env.EXA_API_KEY) return new ExaSearchProvider();
  if (process.env.TAVILY_API_KEY) return new TavilySearchProvider();
  return null;
}
