import "server-only";

export interface UrlContext {
  url: string;
  title?: string;
  description?: string;
  content?: string;
  source: "youtube" | "web";
}

export function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"')]+/gi;
  const matches = text.match(urlRegex) || [];
  return [...new Set(matches.map(u => u.replace(/[.,;!?]+$/, "")))];
}

export async function fetchUrlContext(urlStr: string): Promise<UrlContext | null> {
  try {
    const url = new URL(urlStr);
    const host = url.hostname.toLowerCase();

    // YouTube handler via oEmbed
    if (host.includes("youtube.com") || host.includes("youtu.be")) {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(urlStr)}&format=json`;
      const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        const d = await res.json() as { title?: string; author_name?: string };
        return {
          url: urlStr,
          title: d.title || "YouTube Video",
          description: `Kanal: ${d.author_name || "Unknown"}`,
          content: `Video YouTube dari ${d.author_name || "Unknown"}: "${d.title || ""}"`,
          source: "youtube"
        };
      }
    }

    // Generic Web scraper
    const res = await fetch(urlStr, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) FacelessStudioBot/1.0"
      },
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) return null;

    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : "";

    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
                      html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
    const description = descMatch ? descMatch[1].trim() : "";

    // Strip HTML tags for clean excerpt
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyContent = bodyMatch ? bodyMatch[1] : html;
    const cleanText = bodyContent
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 3000);

    return {
      url: urlStr,
      title: title || url.hostname,
      description,
      content: cleanText,
      source: "web"
    };
  } catch {
    return null;
  }
}
