# Trending — cross-source story detection *(v1.1)*

## What & why

A second, independent notification signal: when the same story surfaces in multiple sources (HN post, then a YouTube video, then an RSS write-up), the owner gets pinged **even if the taste filter skipped it** — frequency across sources is its own evidence of relevance. Added after the v1 build; ships as milestone M7.

## Story identity (two tiers)

1. **URL identity** — every entry gets a `url_key` at ingestion: its outbound URL(s) normalized — lowercase host, strip `www.`, drop `utm_*`/`ref`/`fbclid`/`gclid` params, drop fragment and trailing slash. HN entries use their article URL (not the HN item page); tweets use their first embedded link; RSS items their link; YouTube videos their watch URL. Same `url_key` ⇒ same story, no LLM needed.
2. **Topic identity** — the existing per-entry filter call in `llm/filter.ts` is extended: alongside MATCH/SKIP + reason, the model returns `topics`: 2–4 canonical kebab-case slugs (entities + the specific event, e.g. `["gpt-6-release", "openai"]` — the event slug matters; bare entity slugs alone are too sticky). Stored on the entry as JSON. **No additional `claude -p` calls.**

## Clustering

Runs inside `runOnce()` after the filter pass, for every newly filtered entry (excluding initial-import entries):

- Find clusters with activity in the last **48 hours** (code constant) where the entry's `url_key` matches one of the cluster's `url_keys`, **or** ≥ 2 of its topic slugs overlap the cluster's slug set. Join the most recently active match (updating the cluster's slug union, url_keys, last_activity); otherwise create a new cluster seeded with this entry.
- Cluster fields: canonical title = first member's title; slug union capped at 8 (stop absorbing new slugs past that — prevents mega-cluster drift).
- **Notify:** when a cluster's **distinct source count** reaches the threshold (`trending_threshold` setting, integer, default 2) and `notified_at` is null → one Telegram message, then stamp `notified_at`. Never re-notify a cluster. Format: "📈 Trending in your sources — *<title>* — seen in hn:frontpage, yt:@fireship, rss:swyx" + links per member.
- A cluster whose members all come from one source never notifies (distinct count is 1) but still exists in the dashboard.

## Dashboard

- **Inbox** gets a **Trending** section above the regular cards, visible only when there's an active (last 48h) cluster at/above threshold: one card per cluster — 📈 icon, canonical title, source chips for each member (each linking to the member entry/URL), first-seen/last-seen times, and **Draft thread** + Dismiss cluster actions. Taste-skipped members appear here even though they never appear as individual inbox cards.
- **Draft from cluster:** generator input = generation prompt + voice examples + *all members'* material (titles, contents, transcript where present) with a line naming each source — richer input than any single entry. `threads` row carries `cluster_id` (entry_id null). The Editor's left panel lists the member entries instead of a single source.
- **Settings:** one new field in a small "Trending" section — "Notify when a story appears in N sources" (integer input, default 2, min 2). Window is not a setting.

## Architecture mapping

New `server/trending/cluster.ts` (normalization + clustering + threshold check); `llm/filter.ts` output extended; notifier gains `sendTrending(cluster)`; `routes/entries.ts` serves clusters to the Inbox; migration adds `clusters`, `cluster_entries`, `entries.topics`, `entries.url_key`, nullable `threads.cluster_id` (+ relax `threads.entry_id` to nullable, exactly one of the two set).

## Edge cases & open questions

- Filter-call failure now also delays topic extraction — fine: entry stays `pending`, clusters on the next successful pass.
- Backfill: entries filtered before this feature have no topics/url_key — migration computes `url_key` for recent (48h) entries; topics stay empty (URL tier still works). No historical re-clustering.
- Same story resurging after >48h quiet forms a *new* cluster and may notify again — acceptable, it is a new wave.
- Dismissing a cluster hides it and stops nothing else; its members keep their individual states.
- ~~Open (M7): whether tweets' shortened `t.co` links need expanding~~ **Resolved (2026-08-20):** the real CLI returns a `urls[]` array per tweet; the fetcher passes the first embedded link as `embedded_url`, and ingestion prefers it over the tweet's own x.com URL when computing `url_key` — so a tweet linking an article clusters with the HN/RSS entries for that article.
