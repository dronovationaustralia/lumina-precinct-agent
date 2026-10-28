/**
 * Model providers behind one small interface, so Muse Spark (Meta Model API) and
 * Muse Spark Open (Baseten) are a config switch.
 *
 * `offline` is a deterministic, rule-based stand-in used for tests, CI and keyless local
 * development. It is not a Meta model; responses made with it say provider "offline".
 */
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';

import type { Fact } from '@/lib/contracts';

import { offlineComposeFromFacts, offlinePlan } from './offline';

export type ProviderId = 'meta' | 'baseten' | 'offline';

export type Usage = { input: number; output: number; reasoning?: number };

export const REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** Muse Spark always reasons; lower effort trades depth for latency. Default: low. */
export function reasoningEffort(): ReasoningEffort {
  const v = process.env.MUSE_REASONING_EFFORT as ReasoningEffort | undefined;
  return v && REASONING_EFFORTS.includes(v) ? v : 'low';
}

export interface AgentModel {
  readonly provider: ProviderId;
  readonly model: string;
  /** One planning turn: may return tool calls. */
  plan(messages: BaseMessage[], tools: StructuredToolInterface[]): Promise<AIMessage>;
  /** Compose turn: returns the raw text (JSON expected). `ctx` is used only by the offline model. */
  compose(messages: BaseMessage[], ctx: { question: string; facts: Fact[] }): Promise<{ text: string; usage: Usage }>;
}

function usageOf(m: AIMessage): Usage {
  return {
    input: m.usage_metadata?.input_tokens ?? 0,
    output: m.usage_metadata?.output_tokens ?? 0,
    reasoning: m.usage_metadata?.output_token_details?.reasoning ?? 0,
  };
}

class OpenAICompatibleModel implements AgentModel {
  private readonly llm: ChatOpenAI;
  readonly effort: ReasoningEffort | undefined;
  constructor(readonly provider: ProviderId, readonly model: string, baseURL: string, apiKey: string, effort?: ReasoningEffort) {
    this.effort = effort;
    this.llm = new ChatOpenAI({
      model,
      apiKey,
      configuration: { baseURL },
      temperature: 0.1,
      maxRetries: 1,
      timeout: 30_000,
      // Chat Completions until the Responses spike confirms LangChain's stateless replay works on Meta.
      useResponsesApi: false,
      // Meta's Chat Completions field. Passed via modelKwargs because LangChain only forwards its
      // own `reasoning` option for model names it recognises as OpenAI reasoning models.
      ...(effort ? { modelKwargs: { reasoning_effort: effort } } : {}),
    });
  }
  async plan(messages: BaseMessage[], tools: StructuredToolInterface[]) {
    // Meta supports tool_choice "auto" only, so none is set.
    return (await this.llm.bindTools(tools).invoke(messages)) as AIMessage;
  }
  async compose(messages: BaseMessage[]) {
    const m = (await this.llm.invoke(messages)) as AIMessage;
    return { text: m.text, usage: usageOf(m) };
  }
}

class OfflineModel implements AgentModel {
  readonly provider = 'offline' as const;
  readonly model = 'offline-rules-v1';
  async plan(messages: BaseMessage[]) {
    return offlinePlan(messages);
  }
  async compose(_messages: BaseMessage[], ctx: { question: string; facts: Fact[] }) {
    return { text: offlineComposeFromFacts(ctx.question, ctx.facts), usage: { input: 0, output: 0 } };
  }
}

export function getModel(requested?: ProviderId): AgentModel {
  const provider = requested ?? (process.env.LUMINA_PROVIDER as ProviderId | undefined) ?? (process.env.MODEL_API_KEY ? 'meta' : 'offline');
  if (provider === 'meta') {
    const key = process.env.MODEL_API_KEY;
    if (!key) throw new Error('MODEL_API_KEY is not set');
    return new OpenAICompatibleModel('meta', process.env.MUSE_SPARK_MODEL ?? 'muse-spark-1.3', process.env.META_BASE_URL ?? 'https://api.meta.ai/v1', key, reasoningEffort());
  }
  if (provider === 'baseten') {
    const key = process.env.BASETEN_API_KEY;
    if (!key) throw new Error('BASETEN_API_KEY is not set');
    return new OpenAICompatibleModel(
      'baseten',
      process.env.MUSE_SPARK_OPEN_MODEL ?? 'meta-models/muse-spark-open-1026',
      process.env.BASETEN_BASE_URL ?? 'https://inference.baseten.co/v1',
      key,
    );
  }
  return new OfflineModel();
}

export { usageOf };
