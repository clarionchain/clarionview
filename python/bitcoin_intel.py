"""
Bitcoin Daily Intelligence — knowledge graph generator.

Pipeline:
  1. Fetch articles from RSS + Reddit (sources.py)
  2. LLM: cluster articles into 5-12 named narratives with topic labels
  3. LLM: extract entities per narrative
  4. Write Quartz-compatible markdown vault:
       content/index.md           ← daily overview
       content/topics/{t}.md      ← 4 topic pages
       content/narratives/{s}.md  ← one per narrative
       content/entities/{s}.md    ← one per entity
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import config
import llm
from sources import Article, fetch_all

log = logging.getLogger(__name__)

_generating = False


# ── Data models ───────────────────────────────────────────────────────────────

@dataclass
class Entity:
    name: str
    slug: str
    entity_type: str     # person | organization | project | product | place | event
    role: str            # short description
    narratives: list[str] = field(default_factory=list)   # narrative slugs


@dataclass
class Narrative:
    title: str
    slug: str
    topic: str           # market | technical | policy | geopolitical
    summary: str
    articles: list[Article] = field(default_factory=list)
    entities: list[Entity] = field(default_factory=list)
    related_slugs: list[str] = field(default_factory=list)


TOPIC_LABELS = {
    "market": "Market",
    "technical": "Technical",
    "policy": "Policy",
    "geopolitical": "Geopolitical",
}

TOPIC_DESCRIPTIONS = {
    "market": "Price action, ETF flows, on-chain metrics, derivatives, and macro positioning.",
    "technical": "Protocol development, Lightning Network, layer-2s, cryptography, and developer activity.",
    "policy": "Regulation, legislation, central bank policy, and institutional frameworks.",
    "geopolitical": "Nation-state adoption, mining geopolitics, sanctions, and global macro narratives.",
}


# ── Slug utility ──────────────────────────────────────────────────────────────

def slugify(text: str, max_len: int = 50) -> str:
    text = text.lower()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text.strip())
    text = re.sub(r"-+", "-", text).strip("-")
    return text[:max_len]


# ── JSON extraction (robust against LLM preamble/postamble) ──────────────────

def extract_json(text: str) -> Any:
    """Extract the first JSON object or array from LLM output."""
    # Try direct parse first
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        pass

    # Find JSON block in markdown code fence
    m = re.search(r"```(?:json)?\s*(\{[\s\S]*?\}|\[[\s\S]*?\])\s*```", text)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass

    # Find raw JSON object/array
    m = re.search(r"(\{[\s\S]*\}|\[[\s\S]*\])", text)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass

    return None


# ── Keyword-based fallback clustering ─────────────────────────────────────────

_TOPIC_KEYWORDS: dict[str, list[str]] = {
    "market": [
        "price", "etf", "inflow", "outflow", "sell", "buy", "bullish", "bearish",
        "market", "trading", "volume", "futures", "options", "derivatives",
        "fund", "investment", "spot", "rally", "dump", "ath", "all-time",
        "institutional", "whale", "exchange", "coinbase", "binance", "kraken",
        "grayscale", "blackrock", "fidelity", "ark", "microstrategy",
        "bitcoin etf", "ibit", "gbtc", "valuation", "supply", "demand",
    ],
    "technical": [
        "lightning", "taproot", "schnorr", "layer", "protocol", "developer",
        "update", "upgrade", "fork", "mempool", "transaction", "fee", "block",
        "hash", "mining", "hashrate", "difficulty", "opcode", "script",
        "segwit", "ordinals", "inscriptions", "runes", "brc-20", "rgb",
        "second layer", "channel", "routing", "node", "wallet", "core",
        "open source", "github", "release", "testnet", "signet",
    ],
    "policy": [
        "regulation", "sec", "law", "senate", "congress", "bill", "policy",
        "government", "ban", "legal", "court", "lawsuit", "compliance",
        "kyc", "aml", "treasury", "irs", "tax", "license", "enforcement",
        "cftc", "finra", "fdic", "fed", "federal", "legislation", "approve",
        "reject", "hearing", "committee", "crypto regulation", "framework",
    ],
    "geopolitical": [
        "country", "nation", "el salvador", "russia", "china", "iran",
        "reserve", "sanctions", "geopolit", "strategic", "sovereign",
        "president", "minister", "adoption", "central bank", "cbdc",
        "war", "energy", "nuclear", "hydro", "stranded", "mining geography",
        "bhutan", "abu dhabi", "japan", "europe", "africa", "latin america",
        "global south", "dollarization", "hyperinflation",
    ],
}

_NARRATIVE_GROUPINGS: dict[str, list[tuple[str, str, list[str]]]] = {
    # topic → list of (title, slug, keywords_for_grouping)
    "market": [
        ("Bitcoin ETF Flows & Institutional Demand",   "etf-flows-institutional",   ["etf", "inflow", "outflow", "blackrock", "fidelity", "grayscale", "ibit", "gbtc", "fund"]),
        ("BTC Price Action & On-Chain Metrics",        "btc-price-on-chain",        ["price", "ath", "rally", "sell", "buy", "volume", "on-chain", "mvrv", "nupl", "sopr"]),
        ("Exchange & Derivatives Activity",            "exchange-derivatives",      ["exchange", "binance", "coinbase", "futures", "options", "open interest", "liquidat"]),
        ("Macro & Mining Economics",                   "macro-mining-economics",    ["macro", "hashrate", "mining", "puell", "difficulty", "miner", "reward"]),
        ("Bitcoin Market Overview",                    "bitcoin-market-overview",   []),
    ],
    "technical": [
        ("Lightning Network Development",              "lightning-network",         ["lightning", "channel", "routing", "node", "lsp", "bolt"]),
        ("Bitcoin Protocol & Core Updates",            "protocol-core-updates",     ["protocol", "taproot", "schnorr", "opcode", "upgrade", "core", "bip", "testnet"]),
        ("Layer-2s & Smart Contracts on Bitcoin",      "layer2-smart-contracts",    ["layer", "rgb", "tapscript", "ark", "stacks", "rootstock", "dlc"]),
        ("Ordinals, Runes & Digital Assets",           "ordinals-runes-assets",     ["ordinals", "inscription", "runes", "brc-20", "metaprotocol"]),
        ("Bitcoin Technical Overview",                 "bitcoin-technical-overview", []),
    ],
    "policy": [
        ("SEC & Regulatory Actions",                   "sec-regulatory-actions",    ["sec", "enforcement", "lawsuit", "court", "cftc", "finra"]),
        ("Crypto Legislation & Bills",                 "crypto-legislation",        ["bill", "senate", "congress", "law", "legislation", "hearing", "committee"]),
        ("Tax, Compliance & AML Policy",               "tax-compliance-aml",        ["tax", "irs", "kyc", "aml", "compliance", "reporting"]),
        ("Bitcoin Policy Overview",                    "bitcoin-policy-overview",   []),
    ],
    "geopolitical": [
        ("Nation-State Bitcoin Adoption",              "nation-state-adoption",     ["el salvador", "bhutan", "country", "nation", "president", "sovereign", "minister", "central bank"]),
        ("Bitcoin Mining Geopolitics",                 "mining-geopolitics",        ["mining", "energy", "hydro", "nuclear", "stranded", "russia", "iran", "china", "geography"]),
        ("Bitcoin as Reserve Asset",                   "bitcoin-reserve-asset",     ["reserve", "strategic", "treasury", "gold", "allocation", "sovereign wealth"]),
        ("Geopolitical Bitcoin Overview",              "geopolitical-overview",     []),
    ],
}


def _score_topic(text: str) -> str:
    """Assign most-likely topic based on keyword frequency."""
    text_lower = text.lower()
    scores: dict[str, int] = {t: 0 for t in _TOPIC_KEYWORDS}
    for topic, kws in _TOPIC_KEYWORDS.items():
        for kw in kws:
            if kw in text_lower:
                scores[topic] += 1
    return max(scores, key=lambda t: scores[t])


def _score_narrative_group(text: str, keywords: list[str]) -> int:
    text_lower = text.lower()
    return sum(1 for kw in keywords if kw in text_lower)


def keyword_cluster_narratives(articles: list[Article]) -> list[dict]:
    """Rule-based clustering when LLM is unavailable."""
    # Step 1: assign each article to a topic
    topic_articles: dict[str, list[tuple[int, Article]]] = {t: [] for t in _TOPIC_KEYWORDS}
    for i, a in enumerate(articles):
        combined = f"{a.title} {a.snippet}"
        topic = _score_topic(combined)
        topic_articles[topic].append((i, a))

    result: list[dict] = []

    for topic, items in topic_articles.items():
        if not items:
            continue
        groups = _NARRATIVE_GROUPINGS.get(topic, [])
        assigned: set[int] = set()

        # Assign articles to specific narrative groups
        for title, slug, kws in groups[:-1]:  # skip catch-all last entry
            if not kws:
                continue
            group_indices = []
            for idx, a in items:
                if idx not in assigned:
                    score = _score_narrative_group(f"{a.title} {a.snippet}", kws)
                    if score > 0:
                        group_indices.append(idx)
                        assigned.add(idx)
            if group_indices:
                top_titles = [articles[i].title for i in group_indices[:3]]
                result.append({
                    "title": title,
                    "slug": f"{topic}-{slug}",
                    "topic": topic,
                    "summary": f"Key developments: {'; '.join(t[:70] for t in top_titles)}.",
                    "indices": group_indices,
                })

        # Unassigned articles go to catch-all
        unassigned = [idx for idx, _ in items if idx not in assigned]
        if unassigned:
            catch_title, catch_slug, _ = groups[-1] if groups else (f"{topic.title()} News", f"{topic}-news", [])
            top_titles = [articles[i].title for i in unassigned[:3]]
            result.append({
                "title": catch_title,
                "slug": catch_slug,
                "topic": topic,
                "summary": f"Today's {topic} developments: {'; '.join(t[:70] for t in top_titles)}.",
                "indices": unassigned,
            })

    return result or [
        {"title": "Bitcoin Daily Overview", "slug": "bitcoin-daily-overview",
         "topic": "market", "summary": "Daily Bitcoin news and developments.",
         "indices": list(range(len(articles)))},
    ]


# ── LLM step 1: cluster articles into narratives ──────────────────────────────

def cluster_narratives(articles: list[Article]) -> list[dict]:
    """Ask LLM to group articles into 5–12 distinct narratives. Returns raw dicts."""
    digest_lines = []
    for i, a in enumerate(articles):
        snippet = a.snippet[:120].replace("\n", " ")
        digest_lines.append(f"{i}. [{a.source}] {a.title}" + (f" — {snippet}" if snippet else ""))
    digest = "\n".join(digest_lines)

    prompt = f"""You are a Bitcoin intelligence analyst. Below are {len(articles)} news items published today.

{digest}

Identify 6 to 12 distinct narratives (major stories, themes, debates). Each narrative groups closely related items.

Return ONLY a JSON object:
{{
  "narratives": [
    {{
      "title": "Concise narrative title (5-8 words)",
      "slug": "url-friendly-slug",
      "topic": "market|technical|policy|geopolitical",
      "summary": "2-3 sentence summary of what is happening and why it matters.",
      "indices": [0, 1, 5]
    }}
  ]
}}

Rules:
- topic must be exactly: market, technical, policy, or geopolitical
- slug must be lowercase with hyphens, no special chars
- Every article index must appear in at least one narrative
- Return ONLY the JSON object, nothing else"""

    try:
        response = llm.chat(
            [
                {"role": "system", "content": "You are a precise Bitcoin intelligence analyst. Return only valid JSON."},
                {"role": "user", "content": prompt},
            ],
            max_tokens=3500,
        )
        data = extract_json(response)
        if data and isinstance(data.get("narratives"), list) and len(data["narratives"]) >= 3:
            log.info("LLM clustering: %d narratives", len(data["narratives"]))
            return data["narratives"]
        log.warning("LLM returned invalid/short narrative list, falling back")
    except Exception as exc:
        log.warning("Cluster LLM failed: %s", exc)

    # Keyword-based fallback — still produces a rich, multi-narrative graph
    log.info("Using keyword-based clustering fallback")
    return keyword_cluster_narratives(articles)


# ── Known entity dictionary for keyword fallback ─────────────────────────────

_KNOWN_ENTITIES: list[tuple[str, str, str]] = [
    # (name, type, role)
    ("BlackRock",         "organization", "World's largest asset manager; issuer of IBIT Bitcoin ETF"),
    ("Fidelity",          "organization", "Asset manager; issuer of FBTC Bitcoin ETF"),
    ("Grayscale",         "organization", "Digital asset manager; operator of GBTC Bitcoin trust"),
    ("ARK Invest",        "organization", "Thematic investment firm; operator of ARKB Bitcoin ETF"),
    ("MicroStrategy",     "organization", "Business intelligence firm; largest corporate Bitcoin holder"),
    ("Coinbase",          "organization", "Leading US crypto exchange; ETF custodian"),
    ("Binance",           "organization", "World's largest crypto exchange by volume"),
    ("Galaxy Digital",    "organization", "Crypto-native financial services firm"),
    ("Michael Saylor",    "person",       "Executive Chairman of MicroStrategy; prominent Bitcoin advocate"),
    ("Cathie Wood",       "person",       "CEO of ARK Invest; Bitcoin ETF issuer"),
    ("Jack Dorsey",       "person",       "Co-founder of Twitter/X and Square; Bitcoin advocate"),
    ("Jack Mallers",      "person",       "CEO of Strike; Lightning Network pioneer"),
    ("Samson Mow",        "person",       "CEO of JAN3; Bitcoin nation-state adoption advocate"),
    ("Lyn Alden",         "person",       "Macroeconomic analyst; Bitcoin researcher"),
    ("Luke Dashjr",       "person",       "Bitcoin Core developer"),
    ("Lightning Network", "project",      "Bitcoin layer-2 payment channel network"),
    ("Bitcoin Core",      "project",      "Reference implementation of the Bitcoin protocol"),
    ("Taproot",           "project",      "Bitcoin soft fork adding Schnorr signatures and MAST"),
    ("Ordinals",          "project",      "Protocol for inscribing data on individual satoshis"),
    ("Runes",             "project",      "Fungible token protocol on Bitcoin by Casey Rodarmor"),
    ("SEC",               "organization", "US Securities and Exchange Commission"),
    ("CFTC",              "organization", "US Commodity Futures Trading Commission"),
    ("US Treasury",       "organization", "US government department overseeing monetary policy"),
    ("El Salvador",       "place",        "First country to adopt Bitcoin as legal tender"),
    ("IBIT",              "product",      "BlackRock's spot Bitcoin ETF"),
    ("GBTC",              "product",      "Grayscale Bitcoin Trust"),
    ("FBTC",              "product",      "Fidelity's spot Bitcoin ETF"),
]

_ENTITY_NAME_TO_DATA: dict[str, tuple[str, str]] = {
    e[0].lower(): (e[1], e[2]) for e in _KNOWN_ENTITIES
}


def _extract_entities_keyword(text: str) -> list[dict]:
    """Extract known entities by name matching in text."""
    text_lower = text.lower()
    found: list[dict] = []
    for name, (etype, role) in _ENTITY_NAME_TO_DATA.items():
        if name in text_lower:
            found.append({"name": _KNOWN_ENTITIES[[e[0].lower() for e in _KNOWN_ENTITIES].index(name)][0],
                          "type": etype, "role": role})
    return found[:6]


# ── LLM step 2: extract entities per narrative ────────────────────────────────

def extract_entities_for_narrative(narrative_title: str, summary: str, article_titles: list[str]) -> list[dict]:
    """Extract up to 6 named entities from a narrative."""
    titles_text = "\n".join(f"- {t}" for t in article_titles[:8])
    prompt = f"""Narrative: {narrative_title}
Summary: {summary}
Related headlines:
{titles_text}

Extract up to 6 key named entities mentioned. Types: person, organization, project, product, place, event.

Return ONLY this JSON:
{{
  "entities": [
    {{"name": "Full Name", "type": "person|organization|project|product|place|event", "role": "one-line description"}}
  ]
}}"""

    try:
        response = llm.chat(
            [
                {"role": "system", "content": "Extract named entities. Return only valid JSON."},
                {"role": "user", "content": prompt},
            ],
            max_tokens=600,
        )
        data = extract_json(response)
        if data and isinstance(data.get("entities"), list) and data["entities"]:
            return data["entities"]
    except Exception as exc:
        log.debug("Entity LLM failed for '%s': %s — using keyword fallback", narrative_title, exc)

    # Keyword fallback: match known entities in title+summary+article titles
    combined = f"{narrative_title} {summary} " + " ".join(article_titles[:5])
    return _extract_entities_keyword(combined)


# ── LLM step 3: find cross-narrative relationships ────────────────────────────

def find_relationships(narratives: list[Narrative]) -> dict[str, list[str]]:
    """Ask LLM which narratives are most closely related to each other."""
    if len(narratives) < 3:
        return {}

    names = "\n".join(f"{i}. {n.title} ({n.topic}): {n.summary[:80]}" for i, n in enumerate(narratives))
    prompt = f"""These are today's Bitcoin narratives:
{names}

For each narrative index, list the indices of the 1-3 most closely related other narratives.
Return ONLY JSON: {{"relations": [[0, [2, 4]], [1, [3]], ...]}}
Each element is [narrative_index, [related_indices...]]"""

    try:
        response = llm.chat(
            [
                {"role": "system", "content": "Identify relationships between narratives. Return only JSON."},
                {"role": "user", "content": prompt},
            ],
            max_tokens=400,
        )
        data = extract_json(response)
        if data and isinstance(data.get("relations"), list):
            result: dict[str, list[str]] = {}
            for row in data["relations"]:
                if isinstance(row, list) and len(row) == 2:
                    idx, related = row
                    if isinstance(idx, int) and 0 <= idx < len(narratives):
                        rel_slugs = [
                            narratives[r].slug
                            for r in (related if isinstance(related, list) else [])
                            if isinstance(r, int) and 0 <= r < len(narratives) and r != idx
                        ]
                        result[narratives[idx].slug] = rel_slugs
            return result
    except Exception as exc:
        log.warning("Relationship LLM failed: %s", exc)
    return {}


# ── Markdown writers ──────────────────────────────────────────────────────────

def _wl(slug: str, display: str | None = None, prefix: str = "") -> str:
    """Generate a Quartz wikilink: [[prefix/slug|Display]] or [[prefix/slug]]."""
    path = f"{prefix}/{slug}" if prefix else slug
    return f"[[{path}|{display}]]" if display else f"[[{path}]]"


def write_narrative_page(narrative: Narrative, date: str, vault: Path) -> None:
    slug = narrative.slug
    path = vault / "narratives" / f"{slug}.md"
    path.parent.mkdir(parents=True, exist_ok=True)

    topic_label = TOPIC_LABELS.get(narrative.topic, narrative.topic.title())
    entity_links = " · ".join(
        _wl(e.slug, e.name, "entities") for e in narrative.entities[:8]
    ) if narrative.entities else "_None identified_"

    related_links = " · ".join(
        _wl(r, None, "narratives") for r in narrative.related_slugs[:4]
    ) if narrative.related_slugs else "_None_"

    sources_md = "\n".join(
        f"{i+1}. [{a.title}]({a.url})  \n   *{a.source}*"
        + (f"\n   > {a.snippet[:200]}" if a.snippet else "")
        for i, a in enumerate(narrative.articles[:10])
    ) if narrative.articles else "_No articles tagged to this narrative._"

    content = f"""---
title: {narrative.title}
date: {date}
tags: [narrative, {narrative.topic}]
topic: {narrative.topic}
---

# {narrative.title}

**Topic:** {_wl(narrative.topic, topic_label, "topics")}
**Date:** {date}

## Summary

{narrative.summary}

## Key Entities

{entity_links}

## Related Narratives

{related_links}

## Sources

{sources_md}

---

← {_wl("index", "Daily Index")} · {_wl(narrative.topic, topic_label, "topics")}
"""
    path.write_text(content, encoding="utf-8")


def write_entity_page(entity: Entity, vault: Path) -> None:
    path = vault / "entities" / f"{entity.slug}.md"
    path.parent.mkdir(parents=True, exist_ok=True)

    narrative_links = "\n".join(
        f"- {_wl(s, None, 'narratives')}"
        for s in entity.narratives[:10]
    ) if entity.narratives else "- _No narratives today_"

    # Don't overwrite if exists — accumulate narrative links over time
    if path.exists():
        existing = path.read_text(encoding="utf-8")
        # Append today's narratives if not already present
        for ns in entity.narratives:
            link = f"narratives/{ns}"
            if link not in existing:
                # Append to narratives section
                existing = existing.rstrip() + f"\n- [[narratives/{ns}]]\n"
        path.write_text(existing, encoding="utf-8")
        return

    content = f"""---
title: {entity.name}
tags: [entity, {entity.entity_type}]
entity_type: {entity.entity_type}
---

# {entity.name}

{entity.role}

## Narratives

{narrative_links}
"""
    path.write_text(content, encoding="utf-8")


def write_topic_page(topic: str, narratives: list[Narrative], vault: Path, date: str) -> None:
    path = vault / "topics" / f"{topic}.md"
    path.parent.mkdir(parents=True, exist_ok=True)

    label = TOPIC_LABELS.get(topic, topic.title())
    desc = TOPIC_DESCRIPTIONS.get(topic, "")

    narrative_items = "\n".join(
        f"- {_wl(n.slug, n.title, 'narratives')} — {n.summary[:100]}…"
        for n in narratives
    ) if narratives else "- _No narratives today_"

    # Collect entities across all topic narratives
    all_entities: dict[str, Entity] = {}
    for n in narratives:
        for e in n.entities:
            all_entities[e.slug] = e

    entity_links = " · ".join(
        _wl(e.slug, e.name, "entities") for e in list(all_entities.values())[:10]
    ) if all_entities else "_None identified_"

    content = f"""---
title: {label}
tags: [topic, {topic}]
date: {date}
---

# {label}

{desc}

## Today's Narratives

{narrative_items}

## Key Entities

{entity_links}

---

← {_wl("index", "Daily Index")}
"""
    path.write_text(content, encoding="utf-8")


def write_daily_index(
    date: str,
    narratives: list[Narrative],
    all_entities: list[Entity],
    source_count: int,
    vault: Path,
) -> None:
    path = vault / "index.md"
    path.parent.mkdir(parents=True, exist_ok=True)

    date_fmt = datetime.strptime(date, "%Y-%m-%d").strftime("%B %-d, %Y")

    # Group by topic
    by_topic: dict[str, list[Narrative]] = {t: [] for t in TOPIC_LABELS}
    for n in narratives:
        t = n.topic if n.topic in by_topic else "market"
        by_topic[t].append(n)

    topic_sections = ""
    for topic, label in TOPIC_LABELS.items():
        topic_narratives = by_topic.get(topic, [])
        if not topic_narratives:
            continue
        topic_sections += f"\n### {_wl(topic, label, 'topics')}\n\n"
        for n in topic_narratives:
            summary_short = n.summary[:110] + "…" if len(n.summary) > 110 else n.summary
            topic_sections += f"- {_wl(n.slug, n.title, 'narratives')} — {summary_short}\n"
        topic_sections += "\n"

    # Top entities across all narratives
    top_entities = all_entities[:12]
    entity_links = " · ".join(
        _wl(e.slug, e.name, "entities") for e in top_entities
    ) if top_entities else "_None identified_"

    # Sources used
    source_names: list[str] = []
    for n in narratives:
        for a in n.articles:
            if a.source not in source_names:
                source_names.append(a.source)

    sources_str = ", ".join(source_names[:8])

    content = f"""---
title: "Bitcoin Intelligence — {date_fmt}"
date: {date}
tags: [daily, bitcoin, intelligence]
---

# Bitcoin Intelligence — {date_fmt}

> Daily knowledge graph distilled from Bitcoin news, social signals, and on-chain data.
> Navigate the graph to explore how narratives connect.

## Today's Narratives
{topic_sections}
## Key Entities Today

{entity_links}

---

*{len(narratives)} narratives · {source_count} articles · Sources: {sources_str}*
*Generated {datetime.now(timezone.utc).strftime("%H:%M UTC")} — {_wl("topics/Market", "Market")} · {_wl("topics/Technical", "Technical")} · {_wl("topics/Policy", "Policy")} · {_wl("topics/Geopolitical", "Geopolitical")}*
"""
    path.write_text(content, encoding="utf-8")


# ── Main pipeline ─────────────────────────────────────────────────────────────

async def generate() -> dict:
    global _generating
    if _generating:
        return {"status": "already_generating"}

    _generating = True
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    log.info("Starting Bitcoin Intel generation for %s", today)

    vault = config.INTEL_DIR
    vault.mkdir(parents=True, exist_ok=True)

    try:
        # ── 1. Fetch articles ─────────────────────────────────────────────────
        articles = await fetch_all(max_items=90)
        if not articles:
            log.warning("No articles fetched — aborting intel generation")
            return {"status": "error", "error": "No articles fetched", "date": today}

        log.info("Fetched %d articles", len(articles))

        # ── 2. Cluster into narratives ────────────────────────────────────────
        raw_narratives = cluster_narratives(articles)

        narratives: list[Narrative] = []
        for raw in raw_narratives:
            title = str(raw.get("title", "Untitled"))
            slug = str(raw.get("slug", "") or slugify(title))
            topic = str(raw.get("topic", "market")).lower()
            if topic not in TOPIC_LABELS:
                topic = "market"
            summary = str(raw.get("summary", ""))
            indices = [i for i in (raw.get("indices") or []) if isinstance(i, int) and 0 <= i < len(articles)]
            tagged_articles = [articles[i] for i in indices]

            narratives.append(Narrative(
                title=title,
                slug=slug,
                topic=topic,
                summary=summary,
                articles=tagged_articles,
            ))

        log.info("Clustered into %d narratives", len(narratives))

        # ── 3. Extract entities ───────────────────────────────────────────────
        all_entities_by_slug: dict[str, Entity] = {}

        for narrative in narratives:
            article_titles = [a.title for a in narrative.articles]
            raw_entities = extract_entities_for_narrative(narrative.title, narrative.summary, article_titles)

            for re_dict in raw_entities:
                name = str(re_dict.get("name", "")).strip()
                if not name or len(name) < 2:
                    continue
                e_slug = slugify(name)
                e_type = str(re_dict.get("type", "organization")).lower()
                role = str(re_dict.get("role", ""))

                if e_slug not in all_entities_by_slug:
                    all_entities_by_slug[e_slug] = Entity(
                        name=name, slug=e_slug,
                        entity_type=e_type, role=role,
                    )
                entity = all_entities_by_slug[e_slug]
                if narrative.slug not in entity.narratives:
                    entity.narratives.append(narrative.slug)
                if entity not in narrative.entities:
                    narrative.entities.append(entity)

        log.info("Extracted %d unique entities", len(all_entities_by_slug))

        # ── 4. Find relationships ─────────────────────────────────────────────
        relations = find_relationships(narratives)
        for narrative in narratives:
            narrative.related_slugs = relations.get(narrative.slug, [])

        # ── 5. Write vault ────────────────────────────────────────────────────
        # Topic pages
        by_topic: dict[str, list[Narrative]] = {t: [] for t in TOPIC_LABELS}
        for n in narratives:
            t = n.topic if n.topic in by_topic else "market"
            by_topic[t].append(n)

        for topic in TOPIC_LABELS:
            write_topic_page(topic, by_topic[topic], vault, today)

        # Narrative pages
        for narrative in narratives:
            write_narrative_page(narrative, today, vault)

        # Entity pages (accumulate)
        for entity in all_entities_by_slug.values():
            write_entity_page(entity, vault)

        # Daily index (always overwrite)
        sorted_entities = sorted(
            all_entities_by_slug.values(),
            key=lambda e: len(e.narratives),
            reverse=True,
        )
        write_daily_index(today, narratives, sorted_entities, len(articles), vault)

        log.info(
            "Intel generation complete: %d narratives, %d entities, %d articles",
            len(narratives), len(all_entities_by_slug), len(articles),
        )
        return {
            "status": "completed",
            "date": today,
            "narrative_count": len(narratives),
            "entity_count": len(all_entities_by_slug),
            "article_count": len(articles),
        }

    except Exception as exc:
        log.error("Intel generation failed: %s", exc, exc_info=True)
        return {"status": "error", "error": str(exc), "date": today}
    finally:
        _generating = False


def is_generating() -> bool:
    return _generating
