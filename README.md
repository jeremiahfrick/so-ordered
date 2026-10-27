# Oyez Oyez Oyez

Posts new U.S. Supreme Court opinions and orders to your subreddit as soon as the Court publishes them.

It is the Devvit successor to the `u/scotus-bot` RSS bot that has served r/supremecourt, and it is not affiliated with or endorsed by the Supreme Court of the United States.

---

## What it posts

### Opinions
When the Court adds a slip opinion, the app posts `OPINION: <caption>` with a table:

| Row | Content |
|---|---|
| Caption | Petitioner v. Respondent |
| Summary | The Court's own one-paragraph summary |
| Author | The authoring Justice (or Per Curiam) |
| Opinion | Link to the opinion PDF |
| Certiorari | Link to the petition |
| Amicus | Link to the U.S. amicus brief, when there is one |
| Case Link | Link to the docket |

### Orders
When the Court posts an Order List or Miscellaneous Order, the app posts `ORDERS: <title> (<date>)` with a link to the PDF.

Each opinion and order is posted once. The app remembers what it has posted.

---

## Setup

1. Install the app on your subreddit. Posts are made by the app's own account, on the subreddit where it is installed.
2. From the subreddit menu, run one of:
   - **Initialize dedup (import snapshot)**: marks the Court items published so far as already posted, so only new items are posted. Use this on a live community.
   - **Initialize dedup (start empty)**: lets the items currently in the Court's feeds post once. Use this on a test subreddit.
3. That's it. The app checks the Court's feeds every 2 minutes. Until step 2 is done it posts nothing.

## Menu reference

| Location | Menu item | Who | What it does |
|---|---|---|---|
| Subreddit | Initialize dedup (import snapshot) | Moderators | Marks already-published Court items as posted |
| Subreddit | Initialize dedup (start empty) | Moderators | Starts with no history |

---

## Fetch Domains

The app uses Devvit's HTTP fetch to read public documents from one domain.

| Domain | Used for |
|---|---|
| `www.supremecourt.gov` | Reading the Court's public opinion feed, Orders page, and per-case data |

**Why this domain is needed.** Opinions and orders are published only by the Supreme Court. The app has to read them from the Court's own site to know when new ones appear.

**Exactly what is requested** (all `GET`, all `https`, no authentication, no cookies):

- `/RSS/slipopinion_rss.aspx`: the Court's public RSS feed of new slip opinions
- `/orders/ordersofthecourt/`: the public Orders of the Court page
- `/RSS/Cases/JSON/<case number>.json`: public docket data for a case that has a new opinion
- `/opinions/slipopinion/<term>`: the public slip-opinion table, used to find the authoring Justice

**What is sent.** Only the URL. No user data, subreddit data, or Reddit data is ever sent to the Court's site.

**How often.** Two requests every 2 minutes (the feed and the Orders page), plus one or two extra requests when a new opinion appears. That is roughly 1,500 requests per day.

**What is done with the responses.** They are parsed, formatted into a Reddit post, and discarded. Nothing from the responses is stored except an identifier (case number or PDF URL) used to avoid posting an item twice.

---

## Data & Privacy

The app stores data only in Devvit's built-in Redis, within Reddit's infrastructure:

- Identifiers of Court items already posted (case numbers and PDF URLs)
- A flag recording that setup was completed
- Timestamps used to limit log messages to one per hour

It stores no information about Reddit users, moderators or subreddit members, reads no private messages, and sends no data to any server other than the read-only requests to `www.supremecourt.gov` described above. Uninstalling the app removes its data. See [PRIVACY.md](PRIVACY.md) and [TERMS.md](TERMS.md).

## Source

Open source under the BSD-3-Clause license.
