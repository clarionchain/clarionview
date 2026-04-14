"""
Bitcoin intelligence data sources.
Fetches from RSS feeds and Reddit JSON API — no API keys required.
"""
import logging
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from html import unescape

import httpx

log = logging.getLogger(__name__)

RSS_FEEDS = [
    ("Bitcoin Magazine",  "https://bitcoinmagazine.com/feed"),
    ("CoinDesk",          "https://www.coindesk.com/arc/outboundfeeds/rss/"),
    ("Cointelegraph",     "https://cointelegraph.com/rss"),
    ("Bitcoin Optech",    "https://bitcoinops.org/en/blog/feed.xml"),
    ("Decrypt",           "https://decrypt.co/feed"),
    ("The Block",         "https://www.theblock.co/rss.xml"),
    ("Bitcoin.com News",  "https://news.bitcoin.com/feed/"),
    ("CryptoSlate",       "https://cryptoslate.com/feed/"),
    ("NewsBTC",           "https://www.newsbtc.com/feed/"),
]

# Use old.reddit.com JSON — more permissive than api.reddit.com
REDDIT_SOURCES = [
    ("r/Bitcoin",         "https://old.reddit.com/r/Bitcoin/top.json?t=day&limit=30"),
    ("r/bitcoinmarkets",  "https://old.reddit.com/r/bitcoinmarkets/top.json?t=day&limit=20"),
]

_HEADERS = {
    "User-Agent": "ClarionView-Intel/1.0 (+https://clarionview.io; Bitcoin knowledge graph)",
    "Accept": "application/rss+xml, application/xml, text/xml, application/json, */*",
}


@dataclass
class Article:
    title: str
    url: str
    source: str
    published: str   # YYYY-MM-DD
    snippet: str     # ≤ 280 chars


# ── Helpers ───────────────────────────────────────────────────────────────────

def _strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text or "")
    return unescape(re.sub(r"\s+", " ", text).strip())


def _parse_rfc2822(raw: str) -> str:
    """RFC 2822 / ISO 8601 → YYYY-MM-DD, fallback today."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    for fmt in (
        "%a, %d %b %Y %H:%M:%S %z",
        "%a, %d %b %Y %H:%M:%S %Z",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%d",
    ):
        try:
            return datetime.strptime(raw.strip(), fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return today


def _parse_rss_xml(source_name: str, xml_text: str, limit: int = 15) -> list[Article]:
    articles: list[Article] = []

    # Strip BOM / byte order marks that break ElementTree
    xml_text = xml_text.lstrip("\ufeff\ufffe")

    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        log.warning("XML parse error for %s: %s", source_name, exc)
        return articles

    # Normalise namespace prefix for Atom feeds
    atom_ns = "http://www.w3.org/2005/Atom"
    ns = {"atom": atom_ns}

    # RSS 2.0 uses <item>; Atom uses <entry>
    items = root.findall(".//item")
    if not items:
        items = root.findall(f".//{{{atom_ns}}}entry")

    for item in items[:limit]:
        def _text(tag: str, default: str = "") -> str:
            # plain tag
            el = item.find(tag)
            if el is not None and el.text:
                return el.text
            # atom-prefixed tag
            el = item.find(f"atom:{tag}", ns)
            if el is not None and el.text:
                return el.text
            # namespaced atom tag
            el = item.find(f"{{{atom_ns}}}{tag}")
            if el is not None and el.text:
                return el.text
            return default

        title = _strip_html(_text("title"))
        if not title:
            continue

        # URL: <link> for RSS, <atom:link href="..."> for Atom
        url = _text("link") or _text("id")
        if not url:
            for link_el in item.findall(f"atom:link", ns) + item.findall(f"{{{atom_ns}}}link"):
                href = link_el.get("href", "")
                if href:
                    url = href
                    break
        if not url:
            continue

        pub_raw = _text("pubDate") or _text("published") or _text("updated")
        published = _parse_rfc2822(pub_raw) if pub_raw else datetime.now(timezone.utc).strftime("%Y-%m-%d")

        desc_raw = _text("description") or _text("summary") or _text("content")
        snippet = _strip_html(desc_raw)[:280]

        articles.append(Article(
            title=title,
            url=url.strip(),
            source=source_name,
            published=published,
            snippet=snippet,
        ))

    return articles


# ── Public fetch functions ────────────────────────────────────────────────────

async def fetch_rss() -> list[Article]:
    results: list[Article] = []
    async with httpx.AsyncClient(headers=_HEADERS, timeout=18, follow_redirects=True) as client:
        for name, feed_url in RSS_FEEDS:
            try:
                r = await client.get(feed_url)
                r.raise_for_status()
                items = _parse_rss_xml(name, r.text)
                results.extend(items)
                log.info("RSS %-20s → %d articles", name, len(items))
            except Exception as exc:
                log.warning("RSS failed %-20s: %s", name, exc)
    return results


async def fetch_reddit() -> list[Article]:
    results: list[Article] = []
    async with httpx.AsyncClient(headers=_HEADERS, timeout=15) as client:
        for name, api_url in REDDIT_SOURCES:
            try:
                r = await client.get(api_url)
                r.raise_for_status()
                children = r.json().get("data", {}).get("children", [])
                count = 0
                for child in children:
                    p = child.get("data", {})
                    title = (p.get("title") or "").strip()
                    if not title:
                        continue
                    # filter low-signal posts
                    score = p.get("score", 0)
                    if score < 20:
                        continue
                    post_url = f"https://reddit.com{p.get('permalink', '')}"
                    selftext = _strip_html(p.get("selftext", ""))[:280]
                    snippet = selftext or f"↑{score} · {p.get('num_comments', 0)} comments"
                    ts = p.get("created_utc", 0)
                    pub = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d") if ts else datetime.now(timezone.utc).strftime("%Y-%m-%d")
                    results.append(Article(title=title, url=post_url, source=name, published=pub, snippet=snippet))
                    count += 1
                log.info("Reddit %-20s → %d posts", name, count)
            except Exception as exc:
                log.warning("Reddit failed %-20s: %s", name, exc)
    return results


async def fetch_all(max_items: int = 90) -> list[Article]:
    """Fetch all sources, deduplicate by canonical URL, return up to max_items."""
    rss_items = await fetch_rss()
    reddit_items = await fetch_reddit()

    seen: set[str] = set()
    unique: list[Article] = []
    for a in rss_items + reddit_items:
        # Canonical key: strip query + trailing slash
        key = a.url.split("?")[0].rstrip("/").lower()
        if key and key not in seen:
            seen.add(key)
            unique.append(a)

    log.info("Total unique articles: %d", len(unique))
    return unique[:max_items]
