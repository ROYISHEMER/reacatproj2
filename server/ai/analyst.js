// Claude as a news analyst: reads the collected headlines for one stock and returns
// per-headline sentiment and events, plus a short analyst view in Hebrew.
// It judges only the supplied text and is never asked to predict a price: research on
// LLM forecasting shows models can "remember" outcomes from training, which inflates accuracy.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aiConfig, completeJson, noteCacheHit } from './client.js';

const DIR = process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const FILE = path.join(DIR, 'ai-cache.json');
const TTL_MS = 6 * 3600000;
const MAX_HEADLINES = 60;
export const EVENT_TYPES = ['none', 'product', 'earnings', 'regulatory', 'deal', 'capital', 'management', 'macro'];

const strings = { type: 'array', items: { type: 'string' } };
export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headlines', 'thesis_he', 'bull_case_he', 'bear_case_he', 'watch_he', 'certainty'],
  properties: {
    headlines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['i', 'sentiment', 'relevance', 'event_type', 'event_date', 'product'],
        properties: {
          i: { type: 'integer', description: 'Index of the headline as given' },
          sentiment: { type: 'number', description: 'Effect on the stock, from -1 (very negative) to 1 (very positive)' },
          relevance: { type: 'number', description: 'How much the headline is about this company, 0 to 1' },
          event_type: { type: 'string', enum: EVENT_TYPES },
          event_date: { type: ['string', 'null'], description: 'Date of the event as YYYY-MM-DD if the headline states or clearly implies one, else null' },
          product: { type: ['string', 'null'], description: 'Product or service named in the headline, else null' },
        },
      },
    },
    thesis_he: { type: 'string' },
    bull_case_he: strings,
    bear_case_he: strings,
    watch_he: strings,
    certainty: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
};

const SYSTEM = `You are an equity research analyst reviewing news coverage of one listed company for a Hebrew-language investing site.

You receive numbered headlines, each with its source and publication date. Work only from this text. Do not use anything you may recall about what happened to the company or its share price after these dates, and do not predict a price: your job is to read the coverage accurately, because a separate statistical model turns your reading into a forecast.

For every headline, judge:
- sentiment: the likely effect of the news on this company's shares, from -1 to 1. Score the substance, not the tone. A headline that merely mentions the company, a listicle, or a price-movement recap with no cause is close to 0.
- relevance: 0 to 1. Headlines about a different company, satire, or generic market commentary get a low value so they do not distort the picture.
- event_type: the kind of company event the headline reports, or "none".
- event_date: only when the headline states or clearly implies when the event happens or happened. Resolve relative dates against the publication date. Never guess a date.
- product: the product or service named, if any.

Then write the overall view in Hebrew, in plain language a non-professional investor can follow:
- thesis_he: two or three sentences on what the coverage says is going on with the company right now.
- bull_case_he and bear_case_he: up to four short points each, drawn from the headlines. If the coverage gives nothing for one side, return an empty list rather than inventing a point.
- watch_he: up to four upcoming events or open questions worth following, with dates where the headlines give them.
- certainty: how well the headlines support your view. Use "low" when coverage is thin, contradictory or mostly noise.

Return every headline index exactly once.`;

function loadDisk() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}
let cache = null;
function saveDisk() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const fresh = Object.fromEntries(Object.entries(cache).filter(([, v]) => Date.now() - v.at < TTL_MS));
    fs.writeFileSync(FILE, JSON.stringify(fresh));
  } catch {
    // Read-only disk: the in-memory cache still works.
  }
}

const clampNum = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0);
const isoDate = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null);
const list = (a) => (Array.isArray(a) ? a.filter((s) => typeof s === 'string' && s.trim()).slice(0, 4) : []);

/** Validate and normalise the model's output; never trust ranges or indexes blindly. */
export function normalise(data, count) {
  const byIndex = new Map();
  for (const h of data?.headlines || []) {
    if (!Number.isInteger(h.i) || h.i < 0 || h.i >= count || byIndex.has(h.i)) continue;
    byIndex.set(h.i, {
      sentiment: clampNum(h.sentiment, -1, 1),
      relevance: clampNum(h.relevance, 0, 1),
      eventType: EVENT_TYPES.includes(h.event_type) ? h.event_type : 'none',
      eventDate: isoDate(h.event_date),
      product: typeof h.product === 'string' && h.product.trim() ? h.product.trim().slice(0, 80) : null,
    });
  }
  return {
    byIndex,
    covered: byIndex.size,
    view: {
      thesis: typeof data?.thesis_he === 'string' ? data.thesis_he.trim() : '',
      bull: list(data?.bull_case_he),
      bear: list(data?.bear_case_he),
      watch: list(data?.watch_he),
      certainty: ['low', 'medium', 'high'].includes(data?.certainty) ? data.certainty : 'low',
    },
  };
}

/**
 * @param news [{title, source, publishedAt}] newest first
 * @returns {byIndex: Map<index, reading>, view, model, cached} for the first MAX_HEADLINES items
 */
export async function analyzeNews({ symbol, company, news }, deps = {}) {
  const items = news.slice(0, MAX_HEADLINES);
  if (!items.length) return null;
  const { model } = aiConfig();
  const key = crypto.createHash('sha1').update(`${model}|${symbol}|${items.map((n) => n.title).join('\n')}`).digest('hex');

  cache ||= deps.noDisk ? {} : loadDisk();
  const hit = cache[key];
  if (hit && Date.now() - hit.at < TTL_MS) {
    noteCacheHit();
    return { ...normalise(hit.data, items.length), model: hit.model, cached: true };
  }

  const lines = items.map((n, i) => `${i}. [${(n.publishedAt || '').slice(0, 10)}] ${n.title} (${n.source || 'unknown source'})`);
  const user = `Company: ${company} (ticker ${symbol})\nToday: ${new Date().toISOString().slice(0, 10)}\n\nHeadlines:\n${lines.join('\n')}`;
  const { data, model: served } = await completeJson({ system: SYSTEM, user, schema: SCHEMA }, deps);

  cache[key] = { at: Date.now(), data, model: served };
  if (!deps.noDisk) saveDisk();
  return { ...normalise(data, items.length), model: served, cached: false };
}
