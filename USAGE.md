# Usage Guide: ericminish.com

## What This Does

This is the personal site at ericminish.com. It says who Eric is, what he is
working on now, and shows the infrastructure work in enough detail that a
reader can check it. It is deliberately not a sales page — contractor work is
pointed at The Frostline Co. by link.

The main pages are home, about, portfolio, writing, homelab, status, contact
and résumé, with long-form case studies under `/portfolio`. Most page content
is hand-written. Helpers generate the writing index, feed, sitemap entries,
reading times and charts. A daily job regenerates the home page's commit strip
from the GitHub API between the `<!-- auto:start gitstrip -->` markers, so edit
outside those markers. Merged changes normally go live within a day when the
workstation is available and deployment checks pass.

## How to Use It

**Updating what a page says.** Each page is a single file named
`index.html`, inside a folder named after the page. The Now page lives in
`status/`, the homelab notes in `homelab/`, and so on. The words are in plain
text between the markup tags — edit the sentence, save the file.

**Keeping the dated pages honest.** The Now page and the homelab page both
state the month they were last updated, in their own text. If either one is
edited, that month has to be changed too, or the page starts quietly claiming
to be more current than it is. This is the single most common way this site
goes wrong.

**Adding a case study.** Copy one of the existing case-study folders inside
`portfolio/`, rename it, replace the words, and add a card linking to it on
the portfolio page. The layout comes along with the copy.

**Updating the résumé.** Edit `resume/index.html` for the page text. If the
PDF itself needs to change, ask the operator to run
`python tools/make-resume-pdf.py` — it regenerates the file under a new
content-addressed name, deletes the old one, and rewrites the download link,
so the file on the page always matches what was last built.

**Publishing.** Changes are not live until the site is deployed. Deployment
copies the files onto the server that hosts the site. A daily workstation job
deploys `origin/main` after regenerating the contribution strip and checking
the writing index, feed and internal links. Saving or committing locally does
not publish a change; it must reach `origin/main` and be deployed. Manual
deployment is also available through the private runbook.

## Writing a Post

Posts live at `writing/<slug>/index.html`. Copy an existing post and change its
`og:title`, `description`, `article:published_time` and `article:modified_time`;
the index, the Atom feed (`writing/feed.xml`), the sitemap and the reading time
are generated from those tags.

1. Write the post. Charts are drawn from `writing/<slug>/data.json` with
   `python tools/gen-forest.py writing/<slug>` into `<!-- auto:start chart-NAME -->` markers.
2. `python tools/gen-writing.py` writes the index, feed, sitemap entries and reading time,
   and checks every internal link and `#anchor` on the site.
3. `python tools/lint-copy.py` checks the copy rule (no intensifiers, no "X, not Y"
   reversals, no "Rather than" openers, no em-dash chains). Fix every finding.
4. Run the tag-balance check from `TECHNICAL.md`.

The daily deploy runs `gen-writing.py --check` and refuses to ship a stale feed or a
broken link.

### Standard for evaluation posts

- State the question and the answer in the first screen.
- Give the data window and the as-of date.
- Define every metric and the baseline it is compared against.
- Give every number with its sample size and a 95% interval; say "could not tell apart"
  when an interval includes zero.
- List what the results cannot show, starting with the largest limit.
- Include failure cases and earlier mistakes.
- Give the commands that reproduce the numbers, and publish the numbers behind each chart.
- End with a dated corrections log, and add to it when a number changes.

## What to Do When Something Breaks

- **"I changed a page but the site looks the same."** The change has not been
  deployed yet, or the browser is showing a cached copy. Try a hard refresh
  first; if the words are still old, the deploy has not happened.
- **"The page lost all its styling."** Something is wrong with the link to the
  stylesheet, or the stylesheet did not get copied during the deploy.
- **"A link goes to a page that doesn't exist."** The folder it points at is
  missing or misspelled. Every link that ends in a slash needs a folder with
  that name containing an `index.html`.
- **"The layout broke after an edit."** A tag was probably left unclosed. The
  tag-balance check in the technical reference will name the file.

For anything else, or if the live site is down rather than wrong, the problem
is on the server rather than in this repo.

## FAQ

**Does this need a build or a deploy pipeline?** No. The files here are the
files served. There is nothing to compile.

**Can pages be added freely?** Yes, as long as they reuse the existing layout
pieces. New pages should look like the existing ones by inheriting the same
structure, not by inventing new styling.

**Why is the business work on a different site?** A personal site that doubles
as a sales page is trusted as neither. The separation is intentional and is
recorded in the README.

**Where does the homelab status grid get its numbers?** It doesn't — it is a
drawing, not live data, and the page says so.

## Related Documentation

- [README](README.md) — what this repo is
- [Technical Reference](TECHNICAL.md) — architecture, deployment, limitations
