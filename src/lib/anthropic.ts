/**
 * The Claude API call (Build Spec §8).
 *
 * Haiku 4.5 by default, with extended thinking on a tunable budget. We stream
 * the response so the team sees the answer appear, and so only the visible
 * answer text reaches the browser — internal thinking never leaves the server.
 */

import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: config.anthropic.apiKey() });
  return client;
}

export interface AnswerStream {
  /** Async iterator of answer text chunks (visible answer only). */
  textChunks: AsyncIterable<string>;
  /** Resolves to the full answer text once streaming completes. */
  fullText: () => Promise<string>;
}

/**
 * Stream an answer from Claude. Yields only `text_delta` content (the visible
 * answer); thinking blocks are produced but never streamed to the caller.
 */
export function streamAnswer(
  systemPrompt: string,
  userMessage: string,
): AnswerStream {
  const model = config.anthropic.model();
  const thinkingBudget = config.anthropic.thinkingBudget();
  let maxTokens = config.anthropic.maxTokens();

  const thinkingOn = thinkingBudget > 0;

  // Build params. With thinking ON the API requires temperature = 1 (default),
  // so we omit it; with thinking OFF we use a low temperature for consistency
  // (Build Spec §8).
  const params: Anthropic.MessageStreamParams = {
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  };

  if (thinkingOn) {
    // budget_tokens must be >= 1024 and strictly less than max_tokens.
    const budget = Math.max(1024, thinkingBudget);
    if (maxTokens <= budget + 512) {
      maxTokens = budget + 1024;
      params.max_tokens = maxTokens;
    }
    params.thinking = { type: "enabled", budget_tokens: budget };
  } else {
    params.temperature = 0.3;
  }

  const stream = getClient().messages.stream(params);

  let resolvedFull = "";
  async function* iterate(): AsyncGenerator<string> {
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        resolvedFull += event.delta.text;
        yield event.delta.text;
      }
    }
  }

  return {
    textChunks: iterate(),
    fullText: async () => {
      const final = await stream.finalMessage();
      const text = final.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      return text || resolvedFull;
    },
  };
}
