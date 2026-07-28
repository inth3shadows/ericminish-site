# Usage Guide: ericminish.com

## What This Does

This is the personal site at ericminish.com. It says who Eric is, what he is
working on now, and shows the infrastructure work in enough detail that a
reader can check it. It is deliberately not a sales page — contractor work is
pointed at The Frostline Co. by link.

The site is six main pages plus three long-form case studies. Nothing on it is
generated or automatic: what is written in this repo is exactly what visitors
see.

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

**Adding a case study.** Copy one of the three existing case-study folders
inside `portfolio/`, rename it, replace the words, and add a card linking to
it on the portfolio page. The layout comes along with the copy.

**Publishing.** Changes are not live until the site is deployed. Deployment
copies the files onto the server that hosts the site, and is a manual step —
saving a file, or even committing it, changes nothing that a visitor sees.

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
