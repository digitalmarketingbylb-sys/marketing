# Channel matrix: what each channel actually requires

The build is API-first. This document records, per channel, what "API-first"
concretely costs and where it hits a wall that no amount of engineering
removes.

Three channels cannot be automated. That is a platform constraint, not a
missing integration, and the plan has to route around it rather than wait.

| Channel | Provider | Auth | Approval needed | Cost | Status |
|---|---|---|---|---|---|
| Website (behaviour) | GA4 Data API | Service account | None | Free | **Built** |
| Website (search) | Search Console API | Service account | None | Free | **Built** |
| LinkedIn — company page | Marketing Developer Platform | OAuth 2.0 | Yes, app review | Free | Next |
| YouTube | YouTube Analytics API | OAuth 2.0 | None for own channel | Free | Next |
| X | X API v2 | OAuth 2.0 | Paid tier required | From ~$200/mo | Blocked on budget |
| Instagram / Facebook | Meta Graph API | OAuth 2.0 | Yes, app review | Free | Blocked on review |
| LinkedIn — personal profile | — | — | — | — | **No API exists** |
| Substack | — | — | — | — | **No API exists** |
| Quora | — | — | — | — | **No API exists** |
| Reddit | Reddit API | OAuth 2.0 | None | Free tier | Account not created |

## The three walls

**LinkedIn personal profiles have no analytics API. At any tier.** The
Marketing Developer Platform covers *company pages* only. There is no
endpoint, paid or otherwise, that returns impressions or engagement for
`linkedin.com/in/tom-dillon-cfa`. This matters more than the table suggests:
in this account the personal profile is likely to out-perform the company
page, because on LinkedIn people follow people. The channel that most needs
measuring is the one that cannot be measured automatically.

The options are a periodic export from LinkedIn's own creator analytics, or
manual entry. Both are covered by the `manual_only` account status and the
`manual_csv` provider slot; the ingestion path for them is not built yet.

**Substack exposes no analytics API.** Subscriber counts, open rates and
per-post views come from the publication dashboard by hand or by export.

**Quora has no analytics API for organic answers.** Views are visible in the
UI only.

## What is worth doing first, and why

GA4 and Search Console are built because they are the only two that need no
approval and no budget: a service-account email added as a viewer, and data
flows the same day. Everything else has a queue or an invoice in front of it.

Recommended order once credentials land:

1. **YouTube** — OAuth for an owned channel needs no review. Fastest next win.
2. **LinkedIn company page** — start app review now; it is the long pole, and
   the review clock runs whether or not the code is written.
3. **Meta** — app review as well; Instagram requires a Business account linked
   to a Facebook Page before the Graph API returns anything at all. Worth
   verifying that link exists before submitting.
4. **X** — needs a paid tier decision before any code is worth writing.
5. **Manual ingestion** — for LinkedIn personal and Substack. Given the
   personal profile's likely importance, this may deserve to jump the queue.
6. **Reddit** — once the account exists and has activity worth measuring.

## Not yet modelled: the conversion endpoint

The channel sheet lists a Calendly link
(`calendly.com/tom-ihk/intro`) as Tom's appointment calendar. It is not in
the channel inventory because it is not a publishing channel, but it is where
the funnel actually ends: every impression, click and session upstream is a
leading indicator of a booked meeting.

Calendly has a usable v2 API. Wiring it would make `meetings_booked` real and
turn the dashboard from an activity report into a performance one. It is the
highest-leverage integration not currently on the list, and worth raising
with the client.
