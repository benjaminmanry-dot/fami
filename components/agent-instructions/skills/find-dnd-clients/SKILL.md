---
name: find-dnd-clients
description: Permissioned acquisition workflow for Ben's professional D&D business. Use to discover current D&D prospects and communities, retain age-unknown signals, handle guardian-managed minor opportunities, audit commercial-contact and AI-content rules, separate evidence from inference, classify opportunities, match schedule-compatible 20Fates campaigns, prepare transparent handoffs and owner conversations, track paid-seat retention, and evaluate source ROI. Also use for access requests, reply handling, and research-only acquisition trials. Do not use to sell lead-generation services to other professional DMs.
---

# Find D&D Clients

## Outcome

Optimize for retained paid 20Fates seats. The leading indicator is a qualified private conversation with Ben, not a booked voice call and not raw lead volume.

The website is the trust and routing layer: prospects may continue through Discord, text, phone, the Session Zero form, or a permitted platform reply. Ben talks with them first; Session Zero follows when appropriate.

Honor the commissioned stage. A community-discovery assignment delivers useful current communities and lawful routes, not a prospect approval packet or a verdict on whether a particular buyer exists. Prospect qualification, message drafting, sending, and conversion tracking are distinct jobs. Complete the requested one; do not impose a downstream gate on upstream research.

## Non-negotiable gates

- WHEN all players are evidenced as adults, classify the opportunity as `adult_confirmed`.
- WHEN player ages are not evidenced, retain the signal as `verify_age_or_guardian`; allow only a neutral age-or-guardian clarification before any pitch, link, offer claim, or owner handoff.
- WHEN a player is explicitly a minor, reject the opportunity unless current evidence shows a legal guardian manages the contact route. For `guardian_managed_minor`, communicate only with the guardian and never directly with the minor.
- Use public information, legitimate access, admin-approved spaces, and intentionally published contact routes only.
- Require current evidence that commercial participation and the proposed contact route are allowed. Missing, unclear, expired, or prohibitive permission blocks outreach.
- Record the source's AI-content policy. WHEN a source or prospect prohibits AI-generated content, retain and qualify the opportunity as `manual_only`, but produce no AI-generated outreach language or artifacts for that destination: no draft, rewrite, example, edit, talking points, or suggested wording.
- Never bypass access controls, scrape private members or contact data, impersonate a player, or auto-join. Sending requires exact Ben approval and an authorized platform-supported route; research does not authorize it.
- Ben must approve the exact recipient and exact message before any access request, post, reply, DM, text, call, or email is sent.
- When `ai_content_state` is `permitted`, draft one recommended message and disclose paid professional play before asking for commitment. When it is `manual_only` or `unknown`, leave all outreach language blank.
- Never let generated drafts, notes, campaign copy, or later outcomes affect qualification.
- Treat the versioned public website snapshot as authoritative for campaign price, schedule, status, and seats. `assets/20fates-campaigns.json` is only a replaceable generated cache of that public contract plus the consumer-owned `fetched_at` receipt.
- Do not state price, availability, scarcity, or schedule when the offer cache is stale, missing, withdrawn, invalid, or contradictory. The snapshot contains no contact route; never infer one from it.

## Start the commissioned work

1. Read `references/executive-strategy.md`.
2. Select the requested stage and read its references below. Use public or already-authorized legitimate access without asking Ben to authorize that same read again. Missing access or outreach permission limits that route, not independent research elsewhere.
3. Before matching campaigns or making offer claims, refresh with `scripts/refresh_20fates_offer.py`. It consumes only `https://20fates.com/campaign-offers.v1.json`, validates `public-offer/1`, and never falls back to HTML. Record `fetched_at` with claims. Community discovery that makes no offer claim need not refresh it.
4. If refresh fails, inspect the cache and continue useful research; block offer claims when it is over seven days old, incomplete or invalid. A stricter current commission's freshness limit still applies.

## Mode router

- Community discovery, gated access, or rule audit: read `references/source-policy-playbook.md`, `references/search-query-library.md`, and `references/source-specific-operating-playbooks.md`. Use `scripts/score_communities.py` to classify readiness; it does not assign a vanity score.
- Access or admin request: read `references/source-policy-playbook.md`; draft from `assets/access-request-template.md` or `assets/admin-message-template.md`; stop for Ben's approval.
- Prospect research or qualification: read `references/search-query-library.md` and `references/executive-strategy.md`. Use `scripts/score_leads.py` and `scripts/validate_leads.py` on structured records.
- Campaign matching: use `scripts/match_20fates_campaigns.py`. A supported match requires a fresh valid cache, one evidenced compatible open table, and no unresolved ambiguity. Multi-table aggregates such as Epic Quests never identify which table has the opening. If exact table evidence is absent, return **Talk with Ben about fit** instead of forcing a campaign.
- Outreach, reply handling, or owner-conversation prep: read `references/outreach-playbook.md`, `references/ben-20fates-tone.md`, and `references/platform-tone-playbook.md`.
- Source-specific tactics: read `references/source-specific-operating-playbooks.md`. Treat every tactic as a working hypothesis until retained-seat evidence supports it.
- Tracker creation: use `assets/acquisition-tracker-template.csv` or `scripts/generate_crm_csv.py`. Keep source-policy memory separate with `assets/source-rules-memory-template.csv`.
- Outcome and source analysis: read `references/source-roi-playbook.md`; use `scripts/analyze_source_roi.py` only after explicit stage fields are updated.

## Research workflow

1. Bound work by the actual commission, remaining resources and useful coverage. Choose sufficient breadth; do not treat ten records as a universal cap or stop a fruitful source at an agent-invented limit.
2. Record the exact query or navigation path, source URL, posted time, observation time, and exact public evidence.
3. Record age evidence, derived `audience_age_state`, any legal-guardian evidence and guardian-only route, paid openness, permission evidence, and AI-content policy separately. Unknown means unknown.
4. Put fit guesses in `inferred_fit`, `inference_confidence`, and `unknowns`; never mix them into observed evidence.
5. Classify the source and opportunity. Do not draft for `reject` or `hold` records, or when `ai_content_state` is `manual_only` or `unknown`.
6. Match a campaign only when current offer and schedule evidence support it.
7. Choose one handoff:
   - `verify_age_or_guardian`: one neutral age-or-guardian question, no link, offer claim, or service pitch;
   - `clarify_paid_openness`: one question, no link or pitch;
   - `website_first`: one relevant 20Fates link for trust and self-selection; or
   - `direct_owner_conversation`: offer the current permitted ways to talk with Ben.
8. If the commission reaches outreach preparation, present the approval packet. A source-only commission instead returns the best supported community routes, relevant limits and next useful step. Sending is never implied by research or drafting approval.

## Approval packet

Include:

- prospect/source and URL;
- exact observed need, age state and evidence, guardian evidence/route when applicable, freshness, and paid-openness state;
- current rule/permission evidence and allowed route;
- current AI-content policy and evidence;
- supported campaign/schedule or **Talk with Ben about fit**;
- one exact draft when AI-generated outreach is permitted, otherwise an explicit `manual_only` marker and no language artifact;
- unknowns, risks, and prohibited claims; and
- the single action that requires Ben's approval.

## Outcome tracking

Use explicit fields for `contacted_at`, `reply_status`, `owner_conversation_status`, `session_zero_status`, `paid_seat_status`, and `retained_4_weeks`. Never infer these events from notes.

Record Ben's research, review, and conversation minutes. Analyze step conversion with visible denominators. Small samples remain insufficient evidence; one win never produces an automatic “scale” recommendation.

## Included tools

- `scripts/refresh_20fates_offer.py`: validate and atomically replace the versioned public-offer cache.
- `scripts/score_communities.py`: classify source readiness and priority.
- `scripts/score_leads.py`: apply age/guardian, freshness, paid-openness, permission, and AI-content gates.
- `scripts/validate_leads.py`: report missing evidence and blocked rows.
- `scripts/match_20fates_campaigns.py`: make fresh, schedule-supported campaign matches.
- `scripts/generate_crm_csv.py`: create the one acquisition tracker and separate source-policy trackers.
- `scripts/merge_rules_memory.py`: apply unexpired source-policy memory.
- `scripts/analyze_source_roi.py`: report explicit funnel stages, retained seats, and Ben's time.

Local HTML consoles and the unrelated Pro-DM sales workflow are intentionally outside this skill. Use chat approval packets and CSV until actual use proves another interface is necessary.
