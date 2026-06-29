# Verdict

**Find out why nobody buys.** Paste your landing page, get scored against the
32 rules a stranger uses to judge it in three seconds — and the one fix to make first.

A single static page (HTML + CSS + vanilla JS, no build step) with a **real,
in-browser scorer**. Open `index.html` or serve the folder — that's the whole product.

```
index.html   the landing page (nine screens, one idea each)
styles.css    three colors only — black, white, one accent
app.js        the live scorer — runs client-side, no backend
og.svg/.png   the share image, designed like a thumbnail
```

Try it:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

---

## Why this is the product

I was handed 32 rules for a viral product and a white card. Instead of writing
a page that *talks about* the rules, I built a product that **runs them on you** —
so the landing page is also the demo. Here is where each rule lives in the build.

| # | Rule | Where it lives |
|---|------|----------------|
| 1 | No free plan | No "free account." The live scorer is a teaser, not a tier. |
| 2 | Three colors | `:root` defines black ink, white paper, one accent (`#ff4d00`). The accent is reserved for the action. |
| 3 | Numbers, not adjectives | Stats screen: 10 / 32 / 1. The scorer *penalizes* headlines with no number. |
| 4 | A footer people share | Footer ends on "97% won't buy. They might still share this." + a share button. |
| 5 | OG image like a thumbnail | `og.png` — screaming headline, a score gauge, high contrast. |
| 6 | One idea per screen | Nine `.screen` sections, each one message. |
| 7 | A fifth grader gets it | Headline is six plain words. Scorer flags 4+ syllable words. |
| 8 | Hard paywall | The full 32-point report is paid; you pay before you get it. |
| 9 | Copy only I could write | Founder screen: three killed launches, the taped-up list. |
| 10 | Show before you explain | The scorer is the first thing in the hero. Demo screen shows a real verdict. |
| 11 | Do one thing | It scores landing pages. Nothing else. |
| 12 | Popcorn pricing | Three one-time tiers: One Page / Founder / Agency. Good, better, best. |
| 13 | Ride a wave | Built on the 32-rules framework people are already sharing. |
| 14 | Steal copy from customers | Testimonials phrased the way users actually talk ("Brutal in the best way"). |
| 15 | A founder you can see | Founder screen with a play button → the founder scoring a live page. |
| 16 | Pricing impossible to miss | "Pricing" sits in the header. |
| 17 | A headline people remember | "Your landing page is leaking money." |
| 18 | Emotional headline | Money + leak = a flinch. Scorer rewards emotional verbs. |
| 19 | Something new | A landing page that scores *itself* against you, live, in the hero. |
| 20 | Sold from the hero alone | Hero: headline + sub + the working scorer. No scroll required to get it. |
| 21 | Empathy before selling | Screen 2 describes the 2am-Stripe-refresh problem before any pitch. |
| 22 | One call to action | Every button is "Score My Page." Pricing is the only other link. |
| 23 | A name people remember | "Verdict." Real word, one meaning, no explanation. |
| 24 | Sell the desire | "Stop leaking money," not "32-point linter." Scorer checks for outcomes. |
| 25 | Try before you pay | The scorer is the best feature, free, in the hero. |
| 26 | No weak words | Copy avoids "most/many/fast." The scorer hunts them in *your* copy. |
| 27 | No subscription | Every tier is a one-time payment. |
| 28 | CTA says what happens next | "Score My Page," not "Get Started." |
| 29 | Testimonials before traffic | "From the first 40 beta users." |
| 30 | Under 10 words | Tagline: "Find out why nobody buys." Scorer fails 10+ word headlines. |
| 31 | Compare to competitors | Table vs free checkers and a $2k copywriter. |
| 32 | More expensive | $29 once vs $0 checkers — and we say why. |

## The scorer is real

`app.js` grades a pasted headline on six of the rules with actual heuristics:
word count, weak-word detection, presence of a number, reading level (syllables),
outcome language, and emotional pull. A weak headline ("The most powerful platform
to easily streamline your workflows") scores ~33; a strong one ("Stop losing 4 hours
every week") scores 100. The remaining 26 rules — hero, pricing, proof, footer — are
the paid report. That's the hard paywall meeting "let them play before they pay."

## Not included (on purpose)

Payment processing and the server-side full-page crawler are the paid backend,
out of scope for this single-file front end. The hooks are wired: every CTA points
at pricing, and the scorer already returns the locked-count teaser.
