# So Ordered

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

Below the table is the opinion's lineup, read from the syllabus of the opinion PDF: a table of who wrote and who joined the majority, each concurrence and each dissent, followed by the Court's own sentences. A lineup that can't be fully understood (for example a plurality opinion) is shown as the sentences alone, and if the PDF can't be read the post simply has no lineup.

### Orders
When the Court posts an Order List or Miscellaneous Order, the app posts `ORDERS: <title> (<date>)`. A Miscellaneous Order shows the text of the order. An Order List shows a count of each disposition, the grants, summary dispositions and orders in pending cases in detail, and any attached written opinions. Every post links to the PDF, and if the PDF can't be read the post is just the link.

Each opinion and order is posted once. The app remembers what it has posted.

---

## Setup

Install the app on your subreddit. That's all: there is nothing to configure and no menu. Posts are made by the app's own account, on the subreddit where it is installed.

The app checks the Court's site every 2 minutes. On its first check it treats everything already published as seen and posts none of it, so your subreddit only gets opinions and orders published after the app was installed. (If the Court's site can't be reached, the app simply tries again on the next check.)
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
- `/orders/...pdf`: the public order PDF linked from the Orders page, read once per new order to show its text in the post
- `/opinions/...pdf`: the public opinion PDF linked from the opinion feed, read once per new opinion to show who wrote and joined it

**What is sent.** Only the URL. No user data, subreddit data, or Reddit data is ever sent to the Court's site.

**How often.** Two requests every 2 minutes (the feed and the Orders page), plus one or two extra requests when a new opinion appears and one for each new order or opinion PDF. That is roughly 1,500 requests per day.

**What is done with the responses.** They are parsed, formatted into a Reddit post, and discarded. Nothing from the responses is stored except an identifier (case number or PDF URL) used to avoid posting an item twice.

---

## Data & Privacy

The app stores data only in Devvit's built-in Redis, within Reddit's infrastructure:

- Identifiers of Court items already posted (case numbers and PDF URLs)
- A flag recording that the first check has run, and the app version last seen (so the logs can show when a new version started)
- Timestamps used to limit log messages to one per hour

It stores no information about Reddit users, moderators or subreddit members, reads no private messages, and sends no data to any server other than the read-only requests to `www.supremecourt.gov` described above. Uninstalling the app removes its data. See [PRIVACY.md](PRIVACY.md) and [TERMS.md](TERMS.md).

## Source

Open source under the BSD-3-Clause license.
