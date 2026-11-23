// Claude API access. Off until ANTHROPIC_API_KEY is set; everything else works without it.
//   AI_MODEL              model id (default: claude-fable-5-2, the most capable model)
//   AI_EFFORT             low | medium | high | xhigh | max (default: high)
//   AI_DAILY_CALL_LIMIT   hard cap on API calls per day (default: 200)
import Anthropic from '@anthropic-ai/sdk';

export class AiError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

export const aiConfig = () => ({
  enabled: Boolean(process.env.ANTHROPIC_API_KEY),
  model: process.env.AI_MODEL || 'claude-fable-5-2',
  effort: process.env.AI_EFFORT || 'high',
  dailyLimit: Number(process.env.AI_DAILY_CALL_LIMIT || 200),
});

const today = () => new Date().toISOString().slice(0, 10);
const usage = { day: today(), calls: 0, cacheHits: 0, errors: 0, inputTokens: 0, outputTokens: 0, lastError: null };
function roll() {
  if (usage.day !== today()) Object.assign(usage, { day: today(), calls: 0, cacheHits: 0, errors: 0, inputTokens: 0, outputTokens: 0, lastError: null });
}
export const noteCacheHit = () => {
  roll();
  usage.cacheHits++;
};
export function aiStatus() {
  roll();
  const { enabled, model, effort, dailyLimit } = aiConfig();
  return { enabled, model, effort, dailyLimit, ...usage };
}

let client;
const getClient = () => (client ||= new Anthropic());

// Models that accept a server-side fallback when a safety classifier declines a request.
const SUPPORTS_FALLBACK = /^claude-(fable-5|mythos-5|opus-5|sonnet-5-5)/;

/**
 * One structured request: returns the parsed JSON object matching `schema`.
 * `deps.client` lets tests inject a fake client.
 */
export async function completeJson({ system, user, schema, maxTokens = 16000 }, deps = {}) {
  roll();
  const cfg = aiConfig();
  if (!deps.client && !cfg.enabled) throw new AiError('disabled', 'Claude API key is not configured');
  if (usage.calls >= cfg.dailyLimit) throw new AiError('budget', 'Daily AI call limit reached');
  usage.calls++;

  const params = {
    model: cfg.model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { effort: cfg.effort, format: { type: 'json_schema', schema } },
  };
  if (SUPPORTS_FALLBACK.test(cfg.model)) {
    // If the model declines, the API retries on Anthropic's recommended fallback in the same call.
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }

  try {
    const message = await (deps.client || getClient()).beta.messages.stream(params).finalMessage();
    usage.inputTokens += message.usage?.input_tokens || 0;
    usage.outputTokens += message.usage?.output_tokens || 0;
    if (message.stop_reason === 'refusal') throw new AiError('refusal', 'The model declined this request');
    if (message.stop_reason === 'max_tokens') throw new AiError('truncated', 'The response was cut off');
    const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    try {
      return { data: JSON.parse(text), model: message.model || cfg.model };
    } catch {
      throw new AiError('invalid_json', 'The model returned malformed JSON');
    }
  } catch (e) {
    usage.errors++;
    let err = e;
    if (!(e instanceof AiError)) {
      if (e instanceof Anthropic.AuthenticationError) err = new AiError('auth', 'Claude API key was rejected');
      else if (e instanceof Anthropic.RateLimitError) err = new AiError('rate_limit', 'Claude API rate limit reached');
      else if (e instanceof Anthropic.APIConnectionError) err = new AiError('network', 'Could not reach the Claude API');
      else if (e instanceof Anthropic.APIError) err = new AiError('api', `Claude API error ${e.status ?? ''}`.trim());
      else err = new AiError('unknown', e.message);
    }
    usage.lastError = err.code;
    throw err;
  }
}
