import { GoogleGenAI, Type } from "@google/genai";

type ParsedRole = "user" | "assistant";

interface ParsedMessage {
  role: ParsedRole;
  content: string;
  avatar?: string;
}

interface ParsedConversation {
  title: string;
  platform: string;
  messages: ParsedMessage[];
}

const ROLE_LABELS: Record<string, ParsedRole> = {
  user: "user",
  you: "user",
  human: "user",
  prompt: "user",
  assistant: "assistant",
  ai: "assistant",
  model: "assistant",
  chatgpt: "assistant",
  claude: "assistant",
  gemini: "assistant",
  deepseek: "assistant",
};

function htmlDecode(input: string): string {
  return input
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function normalizeContent(input: unknown): string {
  if (input == null) return "";
  if (Array.isArray(input)) {
    return input.map(normalizeContent).filter(Boolean).join("\n\n");
  }
  if (typeof input === "object") {
    const value = input as Record<string, unknown>;
    return normalizeContent(
      value.text ??
      value.value ??
      value.markdown ??
      value.content ??
      value.parts ??
      value.children
    );
  }
  return htmlDecode(String(input))
    .replace(/\\n/g, "\n")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeRole(input: unknown): ParsedRole | null {
  const raw = String(input ?? "").toLowerCase().trim();
  return ROLE_LABELS[raw] ?? null;
}

function cleanMessages(messages: ParsedMessage[]): ParsedMessage[] {
  const seen = new Set<string>();
  return messages
    .map((message) => {
      let content = normalizeContent(message.content);
      const searchMatch = content.match(/^search\("([\s\S]*)"\)$/);
      if (searchMatch) {
        content = normalizeContent(searchMatch[1]);
      }

      return {
        role: searchMatch ? "user" as ParsedRole : message.role,
        content,
        avatar: message.avatar || (message.role === "assistant" ? "AI" : "U"),
      };
    })
    .filter((message) => {
      if (message.content.length < 12) return false;
      if (/^(copy|share|retry|regenerate|thumbs up|thumbs down)$/i.test(message.content)) return false;
      if (/^(assistant|user|system|sanitized)$/i.test(message.content)) return false;
      if (/^Original custom instructions/i.test(message.content)) return false;
      if (/statsigPayload|feature_gates|secondary_exposures|sessionId|authStatus/.test(message.content)) return false;
      const contentKey = message.content.slice(0, 1200);
      if (seen.has(contentKey)) return false;
      seen.add(contentKey);
      return true;
    });
}

function inferPlatform(source: string, fallback = "AI Assistant"): string {
  const lower = source.toLowerCase();
  if (lower.includes("chatgpt") || lower.includes("openai")) return "ChatGPT";
  if (lower.includes("claude") || lower.includes("anthropic")) return "Claude";
  if (lower.includes("gemini") || lower.includes("bard.google")) return "Gemini";
  if (lower.includes("deepseek")) return "DeepSeek";
  return fallback;
}

function inferTitle(source: string, messages: ParsedMessage[]): string {
  const titleMatch = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch?.[1]) {
    const title = htmlDecode(titleMatch[1])
      .replace(/\s*[-|]\s*(ChatGPT|Claude|Gemini|DeepSeek|OpenAI).*$/i, "")
      .trim();
    if (title && title.length > 3) return title;
  }

  const firstUser = messages.find((message) => message.role === "user")?.content || messages[0]?.content || "";
  const compact = firstUser.replace(/\s+/g, " ").trim();
  return compact.length > 70 ? `${compact.slice(0, 67)}...` : compact || "Shared Chat Transcript";
}

function extractTextFromHtml(html: string): string {
  return htmlDecode(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|article|section)>/gi, "\n")
      .replace(/<script[\s\S]*?<\/script>/gi, "\n")
      .replace(/<style[\s\S]*?<\/style>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractMessagesFromTranscript(text: string): ParsedMessage[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const messages: ParsedMessage[] = [];
  let currentRole: ParsedRole | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (!currentRole) return;
    const content = buffer.join("\n").trim();
    if (content) messages.push({ role: currentRole, content });
    buffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const marker = trimmed.match(/^(you|user|human|assistant|ai|model|chatgpt|claude|gemini|deepseek)(?:\s+said)?\s*:?\s*(.*)$/i);
    const role = marker ? normalizeRole(marker[1]) : null;

    if (role && (!currentRole || marker![2] || trimmed.length <= 32)) {
      flush();
      currentRole = role;
      if (marker![2]) buffer.push(marker![2]);
      continue;
    }

    if (currentRole) {
      buffer.push(line);
    }
  }

  flush();
  return cleanMessages(messages);
}

function findChatGptMapping(value: unknown): ParsedMessage[] {
  if (!value || typeof value !== "object") return [];
  const obj = value as Record<string, any>;

  if (obj.mapping && typeof obj.mapping === "object") {
    const nodes = obj.mapping as Record<string, any>;
    const roots = Object.entries(nodes)
      .filter(([, node]) => !node?.parent)
      .map(([id]) => id);
    const rootId = roots[0] || Object.keys(nodes)[0];
    const ordered: ParsedMessage[] = [];
    const visited = new Set<string>();

    const walk = (id: string) => {
      if (!id || visited.has(id)) return;
      visited.add(id);
      const node = nodes[id];
      const role = normalizeRole(node?.message?.author?.role);
      const content = normalizeContent(node?.message?.content?.parts ?? node?.message?.content);
      if (role && role !== "assistant" || role) {
        if (role !== null && content && role !== normalizeRole("system")) {
          ordered.push({ role, content });
        }
      }
      for (const childId of node?.children || []) walk(childId);
    };

    walk(rootId);
    const cleaned = cleanMessages(ordered);
    if (cleaned.length > 0) return cleaned;
  }

  for (const child of Object.values(obj)) {
    const found = findChatGptMapping(child);
    if (found.length > 0) return found;
  }

  return [];
}

function collectJsonMessages(value: unknown, output: ParsedMessage[] = []): ParsedMessage[] {
  if (!value || typeof value !== "object") return output;

  if (Array.isArray(value)) {
    value.forEach((item) => collectJsonMessages(item, output));
    return output;
  }

  const obj = value as Record<string, any>;
  const role = normalizeRole(obj.role ?? obj.sender ?? obj.speaker ?? obj.author?.role ?? obj.message?.author?.role);
  const content = normalizeContent(
    obj.content ??
    obj.text ??
    obj.markdown ??
    obj.message?.content?.parts ??
    obj.message?.content ??
    obj.parts
  );

  if (role && content) {
    output.push({ role, content });
  }

  Object.values(obj).forEach((child) => collectJsonMessages(child, output));
  return output;
}

function parseEmbeddedJsonBlocks(html: string): unknown[] {
  const blocks = new Set<string>();
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = scriptRegex.exec(html))) {
    const body = htmlDecode(match[1].trim());
    if (body.startsWith("{") || body.startsWith("[")) blocks.add(body);
  }

  return [...blocks].flatMap((block) => {
    try {
      return [JSON.parse(block)];
    } catch {
      return [];
    }
  });
}

function decodeEscapedJsonString(value: string): string {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
}

function stripChatGptCitations(value: string): string {
  return value
    .replace(/îˆ€urlîˆ‚([^î]+?)îˆ‚([^î]+?)îˆ/g, "[$1]($2)")
    .replace(/url([^]+?)([^]+?)/g, "[$1]($2)");
}

function readEscapedStringAt(source: string, quoteIndex: number): { value: string; end: number } | null {
  if (source.slice(quoteIndex, quoteIndex + 2) !== '\\"') return null;

  let cursor = quoteIndex + 2;
  while (cursor < source.length) {
    const nextQuote = source.indexOf('\\"', cursor);
    if (nextQuote === -1) return null;

    let slashCount = 0;
    for (let i = nextQuote - 1; i >= 0 && source[i] === "\\"; i--) {
      slashCount++;
    }

    // RSC strings are inside an escaped JS string. Delimiters are written as \",
    // while literal quotes inside the message are usually written as \\\".
    if (slashCount === 0) {
      return {
        value: source.slice(quoteIndex + 2, nextQuote),
        end: nextQuote + 2,
      };
    }

    cursor = nextQuote + 2;
  }

  return null;
}

function readEscapedStringBefore(source: string, endQuoteIndex: number): string | null {
  let startQuoteIndex = source.lastIndexOf(',\\"', endQuoteIndex - 1);
  if (startQuoteIndex === -1) return null;

  startQuoteIndex += 1;
  const parsed = readEscapedStringAt(source, startQuoteIndex);
  if (!parsed || parsed.end !== endQuoteIndex + 2) return null;
  return parsed.value;
}

function extractReactFlightMessages(html: string): ParsedMessage[] {
  const records: Array<{ index: number; message: ParsedMessage }> = [];
  const messageSourceMarker = '\\"message_source\\",[';
  const metadataMarker = '\\",{},{\\"_126';
  const assistantPartsMarker = "[274],[";

  let cursor = 0;
  while ((cursor = html.indexOf(assistantPartsMarker, cursor)) !== -1) {
    const contentQuote = html.indexOf('],\\"', cursor);
    if (contentQuote === -1) break;

    const parsedContent = readEscapedStringAt(html, contentQuote + 2);
    if (parsedContent) {
      records.push({
        index: cursor,
        message: { role: "assistant", content: stripChatGptCitations(decodeEscapedJsonString(parsedContent.value)) },
      });
    }

    cursor = contentQuote + 1;
  }

  cursor = 0;
  while ((cursor = html.indexOf(messageSourceMarker, cursor)) !== -1) {
    const contentQuote = html.indexOf('],\\"', cursor);
    if (contentQuote === -1) break;

    const parsedContent = readEscapedStringAt(html, contentQuote + 2);
    if (!parsedContent) {
      cursor = contentQuote + 1;
      continue;
    }

    const roleQuote = html.indexOf(',\\"', parsedContent.end);
    const parsedRole = roleQuote === -1 ? null : readEscapedStringAt(html, roleQuote + 1);
    const role = normalizeRole(parsedRole?.value);

    if (role) {
      records.push({
        index: cursor,
        message: { role, content: stripChatGptCitations(decodeEscapedJsonString(parsedContent.value)) },
      });
    }

    cursor = parsedContent.end;
  }

  cursor = 0;
  while ((cursor = html.indexOf(metadataMarker, cursor)) !== -1) {
    const rawContent = readEscapedStringBefore(html, cursor);
    const metadata = html.slice(cursor, cursor + 900);
    let role: ParsedRole = "assistant";
    if (metadata.includes('\\"_280\\":281') || metadata.includes('\\"_140\\"') || metadata.includes('\\"_147\\"')) {
      role = "user";
    } else if (metadata.includes('\\"_280\\":308')) {
      role = "assistant";
    }

    if (rawContent) {
      records.push({
        index: cursor,
        message: { role, content: stripChatGptCitations(decodeEscapedJsonString(rawContent)) },
      });
    }

    cursor += metadataMarker.length;
  }

  const newestFirst = cleanMessages(
    records
      .sort((a, b) => a.index - b.index)
      .map((record) => record.message)
  );

  return newestFirst.reverse();
}

function deterministicExtract(source: string, isHtml: boolean): ParsedConversation | null {
  const embeddedJson = isHtml ? parseEmbeddedJsonBlocks(source) : [];
  let messages: ParsedMessage[] = [];

  if (isHtml) {
    messages = extractReactFlightMessages(source);
  }

  if (messages.length === 0) {
    for (const json of embeddedJson) {
      messages = findChatGptMapping(json);
      if (messages.length > 0) break;
    }
  }

  if (messages.length === 0) {
    messages = cleanMessages(embeddedJson.flatMap((json) => collectJsonMessages(json, [])));
  }

  if (messages.length === 0 && !isHtml) {
    messages = extractMessagesFromTranscript(source);
  }

  if (messages.length === 0) return null;

  return {
    title: inferTitle(source, messages),
    platform: inferPlatform(source),
    messages,
  };
}

function hasUsableMessages(value: any): value is ParsedConversation {
  return Array.isArray(value?.messages) && cleanMessages(value.messages).length > 0;
}

function getGeminiApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
}

export function getAiClient(): GoogleGenAI | null {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return null;
  }

  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

export async function parseChatRequest(
  body: { url?: string; rawText?: string; useAiCleanup?: boolean; geminiApiKey?: string } = {},
  aiOverride?: GoogleGenAI | null
): Promise<{ statusCode: number; body: Record<string, any> }> {
  const { url, rawText, useAiCleanup = true, geminiApiKey } = body;
  
  let ai: GoogleGenAI | null = null;
  if (useAiCleanup) {
    if (aiOverride) {
      ai = aiOverride;
    } else {
      const apiKey = geminiApiKey?.trim() || getGeminiApiKey();
      if (apiKey) {
        ai = new GoogleGenAI({
          apiKey,
          httpOptions: {
            headers: {
              "User-Agent": "aistudio-build",
            },
          },
        });
      }
    }
  }

  let contentToParse = "";
  let isFetched = false;
  let targetUrl = url ? url.trim() : "";

  if (targetUrl) {
    if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
      targetUrl = "https://" + targetUrl;
    }

    try {
      console.log(`Running crawler for URL: ${targetUrl}`);
      const fetchRes = await fetch(targetUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
        signal: AbortSignal.timeout(10000),
      });

      const status = fetchRes.status;
      console.log(`Fetch responded with status code: ${status}`);

      if (status === 403 || status === 503 || status === 429) {
        return {
          statusCode: 200,
          body: {
            success: false,
            blockedByCloudflare: true,
            error: `Direct scraper was blocked by ${new URL(targetUrl).hostname}'s DDoS protection (Error 403/503).\n\nNo problem! Open the link in a browser, select all text (Ctrl+A), copy it (Ctrl+C), and paste it directly into our "Copy-Paste Text" panel instead!`,
          },
        };
      }

      if (!fetchRes.ok) {
        return {
          statusCode: 200,
          body: {
            success: false,
            error: `The server at ${new URL(targetUrl).hostname} returned error status ${status}. Try using the Copy-Paste fallback instead!`,
          },
        };
      }

      contentToParse = await fetchRes.text();
      isFetched = true;
    } catch (fetchErr: any) {
      console.error("Direct import fetch failed:", fetchErr);
      return {
        statusCode: 200,
        body: {
          success: false,
          error: `Network error: Could not reach the link. Details: ${fetchErr.message || fetchErr}. Feel free to use the manual copy-paste option!`,
        },
      };
    }
  } else if (rawText) {
    contentToParse = rawText;
  }

  if (!contentToParse || contentToParse.trim().length === 0) {
    return {
      statusCode: 200,
      body: {
        success: false,
        error: "Please enter a valid chat share link or paste raw chat contents.",
      },
    };
  }

  const deterministicResult = deterministicExtract(contentToParse, isFetched);
  if (deterministicResult) {
    return {
      statusCode: 200,
      body: {
        success: true,
        data: deterministicResult,
        isFetched,
        parser: "deterministic",
      },
    };
  }

  if (!ai) {
    return {
      statusCode: 200,
      body: {
        success: false,
        error: useAiCleanup
          ? "Could not extract full chat messages from this input, and Gemini API Key is missing for AI cleanup. Paste the visible chat transcript or click the Settings gear icon to configure your own Gemini API key."
          : "Could not automatically detect chat structure in this input. AI Cleanup is turned off — try switching it on, or paste the visible conversation text manually using the Paste Transcript tab.",
      },
    };
  }

  console.log(`Dispatching parser payload to Gemini. Character size: ${contentToParse.length}`);

  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents: `Analyze the following code, chat log transcript, or raw crawled HTML containing an AI conversation. Parse it and convert it into a neat, chronological structured list of conversation participants and messages.

Chat Log / HTML input to parse:
---
${contentToParse}
---`,
    config: {
      systemInstruction: `You are an expert AI Chat Log Parser. Your single directive is to parse cluttered raw text, markdown blocks, copied elements, or raw HTML containing a shared AI chat (from ChatGPT, Claude, Gemini, DeepSeek, or other models), strip out UI clutter, and output a perfect schema-compliant JSON format.

Remove:
- UI control elements: "Copy", "Share", "Thumbs up", "Thumbs down", "Retry", "Regenerate".
- Platform headers and footers, feedback request text, prompt helpers, user emails, profile icons, feedback buttons, etc.
- Timestamps and relative date counters (like "3 hours ago", "yesterday") unless they represent integral content of the dialogue.
- Any secondary prompts or placeholder boxes.

Structure Requirements:
- "title": Create a high-quality human-readable title centered on the core topic being discussed.
- "platform": Try to identify the system. Options are "ChatGPT", "Claude", "Gemini", "DeepSeek", or "Other".
- "messages": An array containing each message block in order:
  - "role": Value MUST be either "user" or "assistant".
  - "content": Clean formatted markdown of the original message. You MUST retain:
    - Code blocks with syntax strings (e.g. \`\`\`tsx ... \`\`\`).
    - Sub-headings, bullet lists, ordered lists, inline styling (bold, italics, etc.).
    - Mathematical formula strings in proper LaTeX typesetting ($...$ or $$...$$).
  - "avatar": A simple initial representation (e.g. "U" for user, "AI" for model, or initials).

Strict JSON Constraint: Output MUST be a single JSON object. Output no extra chat, wrapping markdown delimiters, or formatting text outside of the raw JSON.`,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          platform: { type: Type.STRING },
          messages: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                role: { type: Type.STRING, enum: ["user", "assistant"] },
                content: { type: Type.STRING },
                avatar: { type: Type.STRING },
              },
              required: ["role", "content"],
            },
          },
        },
        required: ["title", "platform", "messages"],
      },
    },
  });

  const responseText = response.text;
  if (!responseText) {
    throw new Error("Received empty response from parsing model.");
  }

  const cleanJsonStr = responseText.trim();
  const parsedConversation = JSON.parse(cleanJsonStr);
  parsedConversation.messages = cleanMessages(parsedConversation.messages || []);

  if (!hasUsableMessages(parsedConversation)) {
    return {
      statusCode: 200,
      body: {
        success: false,
        error: "Only a title/headline was detected. I could not find the actual chat messages in this input. If this is a protected share page, open it in the browser, select the visible conversation text, copy it, and paste it into the Copy-Paste tab.",
      },
    };
  }

  return {
    statusCode: 200,
    body: {
      success: true,
      data: parsedConversation,
      isFetched,
      parser: "gemini",
    },
  };
}
