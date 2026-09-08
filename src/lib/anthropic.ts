/**
 * The Claude API call (Build Spec §8).
 *
 * Sonnet 5 by default, with adaptive thinking at a tunable effort level. We
 * stream the response so the team sees the answer appear, and so only the
 * visible answer text reaches the browser — internal thinking never leaves the
 * server.
 *
 * The system prompt and the stable half of the user message (business name,
 * knowledge base, coverage) are cached for an hour. Everything before the
 * buyer's questions must stay byte-stable between calls for the same business,
 * or the cache is missed.
 */

import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: config.anthropic.apiKey() });
  return client;
}

export interface AnswerUsage {
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
}

export interface AnswerResult {
  stopReason: Anthropic.StopReason | null;
  usage: AnswerUsage;
  model: string;
}

export interface AnswerStream {
  /** Async iterator of answer text chunks (visible answer only). */
  textChunks: AsyncIterable<string>;
  /** Resolves to the stop reason, usage and model once streaming completes. */
  final: () => Promise<AnswerResult>;
}

/**
 * Stream an answer from Claude. Yields only `text_delta` content (the visible
 * answer); thinking blocks are produced but never streamed to the caller.
 */
export function streamAnswer(
  systemPrompt: string,
  stablePrefix: string,
  buyerQuestions: string,
): AnswerStream {
  const cache: Anthropic.CacheControlEphemeral = {
    type: "ephemeral",
    ttl: "1h",
  };

  const model = config.anthropic.model();
  // Haiku 4.5 has neither adaptive thinking nor effort, so run it plain. Keeps
  // Hermes answering if an old ANTHROPIC_MODEL value is still set in Render.
  const reasoning: Partial<Anthropic.MessageStreamParams> = model.includes(
    "haiku",
  )
    ? {}
    : {
        thinking: { type: "adaptive" },
        // The API validates the effort value; no local list to keep in sync.
        output_config: {
          effort: config.anthropic.effort() as Anthropic.OutputConfig["effort"],
        },
      };

  const stream = getClient().messages.stream({
    model,
    max_tokens: config.anthropic.maxTokens(),
    ...reasoning,
    system: [{ type: "text", text: systemPrompt, cache_control: cache }],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: stablePrefix, cache_control: cache },
          { type: "text", text: buyerQuestions },
        ],
      },
    ],
  });

  async function* iterate(): AsyncGenerator<string> {
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield event.delta.text;
      }
    }
  }

  return {
    textChunks: iterate(),
    final: async () => {
      const final = await stream.finalMessage();
      return {
        stopReason: final.stop_reason,
        model: final.model,
        usage: {
          inputTokens: final.usage.input_tokens,
          cacheReadTokens: final.usage.cache_read_input_tokens ?? 0,
          cacheCreationTokens: final.usage.cache_creation_input_tokens ?? 0,
          outputTokens: final.usage.output_tokens,
        },
      };
    },
  };
}
