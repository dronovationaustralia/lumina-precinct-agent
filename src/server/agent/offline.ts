/**
 * Offline, rule-based planner and composer.
 *
 * NOT a language model. It exists so the whole pipeline (tools, verifier, API, portal,
 * evals) runs in tests and without an API key, and as a last-resort fallback. Answers
 * made with it are labelled provider "offline".
 */
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';

import { RINGS, type Fact, type PropertyType, type RingId } from '@/lib/contracts';
import { STATIONS, stationName, stationsInText, type Station } from '@/lib/stations';

import { METRIC_BY_ID } from '../metrics/catalogue';

type Call = { name: string; args: Record<string, unknown> };

export function questionOf(messages: BaseMessage[]): string {
  const h = messages.find((m) => m instanceof HumanMessage);
  return h ? h.text : '';
}

function ringFrom(q: string): RingId {
  if (/\b(400\s?m|walking distance|very close)\b/i.test(q)) return '0-400m';
  if (/\b(2\s?km|800\s?m\s?(to|-)\s?2\s?km)\b/i.test(q) && !/2\s?(to|-)\s?5\s?km/i.test(q)) return '800m-2km';
  return '0-800m';
}

function typeFrom(q: string): PropertyType | undefined {
  if (/\bhouses?\b/i.test(q)) return 'house';
  if (/\b(units?|apartments?|flats?)\b/i.test(q)) return 'unit';
  return undefined;
}

export function planCalls(question: string, contextStation?: string): Call[] {
  const q = question.toLowerCase();
  let stations: Station[] = stationsInText(question);
  if (/\b(which|rank|all|every|each)\b.*\bstations?\b|\bof the (10|ten) stations\b/i.test(q)) stations = [...STATIONS];
  if (!stations.length && contextStation) stations = STATIONS.filter((s) => s.id === contextStation);
  if (!stations.length) {
    return /\b(datasets?|data sources?|sources|licen[cs]e|coverage)\b/i.test(q) ? [{ name: 'list_datasets', args: {} }] : [];
  }
  const ids = stations.map((s) => s.id);
  const ring = ringFrom(q);
  const type = typeFrom(q);
  const calls: Call[] = [];
  const metric = (m: string, extra: Record<string, unknown> = {}) => calls.push({ name: 'query_metric', args: { metric: m, stations: ids, ...extra } });

  const wantsLandUse = /\bland[ -]?use\b|\bbuilt[- ]up\b/.test(q);
  const priceWords = /\b(price|prices|priced|expensive|cheap|cheapest|cost|values?|premium)\b/.test(q);
  const farCompare = /\b(2|two)\s?(to|-)\s?(5|five)\s?km\b|\bkm away\b|\bfurther out\b|\bpremium\b/.test(q);

  if (priceWords && farCompare) {
    const t = type ?? 'unit';
    metric('median_price', { ring: '0-800m', property_type: t });
    metric('median_price', { ring: '2-5km', property_type: t });
    metric('transit_premium', { property_type: t });
  } else if (priceWords && /\b(where|cheapest|most expensive|by ring|by distance)\b/.test(q)) {
    for (const r of ['0-400m', '0-800m', '800m-2km'] as const) metric('median_price', { ring: r, property_type: type ?? 'unit' });
  } else if (priceWords && !/\bmomentum\b/.test(q)) {
    metric('median_price', { ring, property_type: type ?? 'unit' });
  }
  if (/\b(momentum|change|growth|trend|rising|falling|past year|last year)\b/.test(q)) metric('price_change_12m', { ring, property_type: type ?? 'unit' });
  if (/\bafford/.test(q)) metric('affordable_share', { ring, property_type: type ?? 'unit' });
  if (/\b(how many sales|sales volume|number of sales|turnover|sales count)\b/.test(q)) metric('sales_count', { ring, property_type: type ?? 'all' });
  if (wantsLandUse) calls.push({ name: 'land_use', args: { stations: ids, ring: ring === '2-5km' ? '0-800m' : ring } });
  else {
    if (/\b(canopy|trees?|green|leafy|shade)\b/.test(q)) metric('canopy_pct', { ring });
    if (/\b(car[ -]?parks?|parking)\b/.test(q)) metric('carpark_pct', { ring });
    if (/\b(construction|building sites?|development activity)\b/.test(q)) metric('construction_pct', { ring });
  }
  if (/\b(patronage|passengers?|busy|busiest|trips|entries|commuters?|ridership)\b/.test(q)) {
    metric('patronage_12m');
    if (/\b(change|growth|trend|rising|falling)\b/.test(q)) metric('patronage_change_12m');
  }
  if (!calls.length) {
    metric('median_price', { ring, property_type: type ?? 'unit' });
    metric('price_change_12m', { ring, property_type: type ?? 'unit' });
  }
  // Screening questions run across all stations in one call instead of one metric call per station.
  if (/\brank\b/i.test(q) || (/\bwhich\b.*\bstations\b/i.test(q) && /\b(strongest|most|highest|lowest|cheapest|cheaper|busiest)\b/i.test(q))) {
    const growth = calls.find((c) => c.name === 'query_metric' && (c.args as { metric?: string }).metric === 'price_change_12m');
    const first = /\b(momentum|growth)\b/i.test(q) && growth ? growth : calls.find((c) => c.name === 'query_metric');
    if (first) {
      const a = first.args as { metric: string; ring?: RingId; property_type?: PropertyType };
      const def = METRIC_BY_ID.get(a.metric);
      const pt = a.property_type ?? (type && def?.property_types.includes(type) ? type : def?.property_types[0] ?? 'unit');
      const cap = q.match(/under\s?\$([\d,.]+)\s?(m|k)?/);
      const maxMedian = cap ? Math.round(Number(cap[1]!.replace(/,/g, '')) * (cap[2] === 'm' ? 1_000_000 : cap[2] === 'k' ? 1000 : 1)) : undefined;
      return [{
        name: 'rank_stations',
        args: {
          metric: a.metric, ring: a.ring ?? ring, property_type: pt,
          order: /\b(cheapest|cheaper|lowest)\b/i.test(q) ? 'asc' : 'desc', limit: 10,
          ...(maxMedian ? { max_median_price: maxMedian } : {}),
        },
      }];
    }
  }
  return calls.slice(0, 5);
}

export function offlinePlan(messages: BaseMessage[]): AIMessage {
  if (messages.some((m) => m instanceof ToolMessage)) return new AIMessage('ready');
  const human = questionOf(messages);
  const ctx = human.match(/\[station_context=([a-z_]+)\]/)?.[1];
  const calls = planCalls(human.replace(/\[station_context=[a-z_]+\]/, ''), ctx);
  if (!calls.length) return new AIMessage('out of scope');
  return new AIMessage({
    content: '',
    tool_calls: calls.map((c, i) => ({ id: `offline_${i + 1}`, name: c.name, args: c.args, type: 'tool_call' as const })),
  });
}

function ringPhrase(r?: string) {
  return r ? RINGS[r as RingId]?.label ?? r : '';
}

/** Compose a JSON answer from facts with fixed sentence templates. */
export function offlineComposeFromFacts(question: string, facts: Fact[]): string {
  const usable = facts.filter((f) => f.value !== null && f.metric);
  if (!facts.length) {
    return JSON.stringify({
      lines: ['I can answer questions about property, transport and land use around Sydney train and metro stations, such as Chatswood or Parramatta.'],
      actions: [], followups: [{ label: 'Try Chatswood', question: 'Compare Chatswood and St Leonards on canopy and car parks' }], chart: null,
    });
  }
  const lines: string[] = [];
  // Official land use: one line per station and ring, largest categories first.
  const land = new Map<string, Fact[]>();
  for (const f of usable.filter((x) => x.metric?.startsWith('land_use_'))) {
    const key = `${f.station_id}|${f.ring}`;
    land.set(key, [...(land.get(key) ?? []), f]);
  }
  for (const fs of land.values()) {
    if (lines.length >= 2) break;
    const parts = fs.slice(0, 4).map((f) => `${f.label.split(' land use,')[0]} {${f.id}}`);
    lines.push(`Land use ${ringPhrase(fs[0]!.ring)} of ${stationName(fs[0]!.station_id!)}, as mapped in NSW Landuse 2017: ${parts.join(', ')}.`);
  }
  // Group the other facts by metric + ring + property type.
  const groups = new Map<string, Fact[]>();
  for (const f of facts.filter((x) => x.metric && !x.metric.startsWith('land_use_'))) {
    const key = `${f.metric}|${f.ring}|${f.property_type}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  for (const fs of groups.values()) {
    if (lines.length >= 3) break;
    const def = METRIC_BY_ID.get(fs[0]!.metric!)!;
    const typeWord = fs[0]!.property_type && fs[0]!.property_type !== 'all' ? ` (${fs[0]!.property_type}s)` : '';
    const where = def.id === 'transit_premium' ? ' (within 800 m vs 2 to 5 km)' : def.id.startsWith('patronage') ? '' : `, ${ringPhrase(fs[0]!.ring)}`;
    const ok = fs.filter((f) => f.value !== null);
    const suppressed = fs.filter((f) => f.value === null).map((f) => stationName(f.station_id ?? ''));
    let body: string;
    if (ok.length > 4) {
      const sorted = [...ok].sort((a, b) => b.value! - a.value!);
      const hi = sorted[0]!, lo = sorted.at(-1)!;
      body = `highest at ${stationName(hi.station_id!)} {${hi.id}}, lowest at ${stationName(lo.station_id!)} {${lo.id}}`;
    } else {
      body = ok.map((f) => `${stationName(f.station_id!)} {${f.id}}`).join(', ');
    }
    const supp = suppressed.length ? `${body ? '; ' : ''}${suppressed.join(', ')} suppressed (fewer than 10 sales)` : '';
    if (!body && !supp) continue;
    lines.push(`${def.name}${typeWord}${where}: ${body}${supp}.`);
  }

  const stations = [...new Set(usable.map((f) => f.station_id!).filter(Boolean))];
  const metrics = [...new Set(usable.map((f) => f.metric!))];
  const actions: unknown[] = [];
  if (stations.length === 2) actions.push({ type: 'compare', station_ids: [stations[0], stations[1]], metrics: metrics.slice(0, 4), radius_m: 800 });
  if (stations.length > 2) {
    const firstGroup = [...groups.values()].map((fs) => fs.filter((f) => f.value !== null)).find((fs) => fs.length > 2) ?? [];
    const top = [...firstGroup].sort((a, b) => b.value! - a.value!)[0]?.station_id ?? stations[0];
    actions.push({ type: 'fly_to', target: top, view: 'overview' });
    actions.push({ type: 'highlight', kind: 'station', ids: [top], style: 'pulse' });
  } else if (stations.length >= 1) actions.push({ type: 'fly_to', target: stations[0], view: 'close' });
  if (metrics.some((m) => m.startsWith('land_use_') || ['canopy_pct', 'carpark_pct', 'building_pct', 'construction_pct'].includes(m))) actions.push({ type: 'show_layer', layer: 'land_use', visible: true });
  else if (stations.length === 1) actions.push({ type: 'set_radius', radius_m: 800 });

  const first = stations[0] ? stationName(stations[0]) : 'Chatswood';
  const followups = [
    { label: 'Land use near the station', question: `What is the land use within 800 m of ${first}?` },
    { label: 'Price momentum', question: `How has the median unit price changed near ${first} over the last year?` },
  ];

  let chart: unknown = null;
  // Chart: the first metric with 2+ usable values, across stations or rings.
  const byMetric = new Map<string, Fact[]>();
  for (const f of usable) byMetric.set(`${f.metric}|${f.property_type}`, [...(byMetric.get(`${f.metric}|${f.property_type}`) ?? []), f]);
  for (const fs of byMetric.values()) {
    const ok = fs;
    const rings = new Set(ok.map((f) => f.ring));
    if (ok.length >= 2 && rings.size > 1 && new Set(ok.map((f) => f.station_id)).size === 1) {
      const def = METRIC_BY_ID.get(ok[0]!.metric!)!;
      chart = { kind: 'grouped_bar', title: `${def.name} by ring, ${stationName(ok[0]!.station_id!)}`.slice(0, 80), fact_ids: ok.slice(0, 12).map((f) => f.id) };
      break;
    }
  }
  for (const fs of chart ? [] : groups.values()) {
    const ok = fs.filter((f) => f.value !== null);
    if (ok.length >= 2) {
      const def = METRIC_BY_ID.get(ok[0]!.metric!)!;
      chart = { kind: 'bar', title: `${def.name}${ok[0]!.ring && !def.id.startsWith('patronage') && def.id !== 'transit_premium' ? `, ${ringPhrase(ok[0]!.ring)}` : ''}`.slice(0, 80), fact_ids: ok.slice(0, 12).map((f) => f.id) };
      break;
    }
  }
  if (!chart && usable.length >= 2 && new Set(usable.map((f) => f.unit)).size === 1) {
    chart = { kind: 'bar', title: 'Comparison', fact_ids: usable.slice(0, 12).map((f) => f.id) };
  }
  void question;
  return JSON.stringify({ lines: lines.length ? lines : ['No usable figures were returned for this question.'], actions: actions.slice(0, 3), followups, chart });
}
