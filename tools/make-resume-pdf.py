import zlib, textwrap, os
W,H=612,792; M=54
LINES=[]
def esc(t):
    t=t.replace('\u2014','-').replace('\u2013','-').replace('\u2019',"'").replace('\u201c','"').replace('\u201d','"')
    t=t.encode('cp1252','replace').decode('cp1252')
    return t.replace('\\','\\\\').replace('(','\\(').replace(')','\\)')
def add(kind,text=''): LINES.append((kind,text))
add('name','ERIC MINISH')
add('tag','AI Infrastructure & Backend Engineer - I build the checks that catch what is breaking quietly')
add('meta','hi@ericminish.com  |  ericminish.com  |  github.com/inth3shadows  |  linkedin.com/in/ericminish')
add('gap')
add('h','SUMMARY')
add('p','AI infrastructure and backend engineering, built from inside operations rather than beside it. Python, Go and SQL; MCP servers, retrieval and evaluation harnesses, ingestion pipelines and the cloud services underneath them - shipped, deployed and maintained, mostly by me.')
add('p','I find the thing that is quietly breaking and build the check that catches it the next time. In customer-success operations that was account risk: churn went from 30% to under 10% because the system flagged customers before they left rather than explaining them afterwards. Lately it has been my own tooling - a proxy that refuses to compress anything it cannot rebuild exactly, a search engine whose evaluation told me half of it did not work, and a well-depth model that lost its most promising variable the moment it was measured against the right baseline.')
add('gap')
add('h','EXPERIENCE')
add('role','Systems & Automation Lead')
add('sub','Transactly  |  Jul 2023 - Present  |  Remote  |  Internal title: Lead Customer Account Specialist')
for b in ["Own the internal systems layer: workflow logic, the integrations around it, and the reporting that makes the result legible. Roughly sixty active project directories, two-thirds touched in the last month.",
          "Scope and deploy technical workflows across customer success, onboarding, and internal operations using SQL, CRM APIs, and multi-department tooling.",
          "Built and maintain SQL-backed reporting for subscription logic and billing reconciliation.",
          "Lead employee onboarding and offboarding workflows tied to access control and system provisioning.",
          "Design and implement CRM automations across customer success, sales, and partnerships.",
          "Support internal infrastructure through custom development: ingestion services and scheduled jobs on managed cloud infrastructure, warehouse-backed reporting behind access control, and operational microservices. Python-dominant, TypeScript for user-facing work, ~140 test files.",
          "Built an LLM-assisted compliance service: transcribes calls and scores them against a rubric, deterministic checks first and human review after, with the model never given the last word."]:
    add('li',b)
add('gap')
add('role','Customer Success Operations Manager')
add('sub','Transactly  |  Sep 2020 - Apr 2023  |  Previously Client Success Operations Lead, Success Coach, Success Support Specialist')
for b in ["Cut client churn from 30% to under 10% through process and engagement redesign backed by real-time risk scoring.",
          "Built and ran SQL-driven credit, billing, and subscription reporting.",
          "Coordinated ticket workflows across success and transaction-coordination operations, halving issue resolution time.",
          "Served as the customer-success stakeholder for CRM, internal tooling, and platform workflows.",
          "Wrote and deployed the customer-success playbooks and onboarding documentation.",
          "Kept every system running through a 30% headcount reduction. Nothing broke."]:
    add('li',b)
add('gap')
add('role','Agent and data infrastructure (independent)')
add('sub','2025 - Present')
for b in ["RunEcho - checks whether a coding agent's claims about code are true instead of trusting them. Used daily for five months.",
          "terse - compresses AI tool output losslessly: 58% fewer tokens across 365,144 tokens of real API payloads, measured head-to-head against the TOON format, which regresses to -7% on the same corpus. Public, MIT licensed.",
          "Lodestone - local retrieval over years of working notes, and the evaluation that showed half of it did not work. Published the null result.",
          "Frostline - spatial models over 50,083 well records; depth is predictable from location, yield is not.",
          "Reported 32 bugs in a code-analysis tool, including two race conditions reproduced on demand with purpose-built harnesses.",
          "Two servers other tools call: one issues credentials without exposing the value to the caller, one stores decisions and refuses anything unreviewed.",
          "Three applications deployed end to end: a task scheduler with calendar sync, an e-signature and payment intake tool, and a lead-intake product for a client."]:
    add('li',b)
add('gap')
add('role','Customer Success Manager')
add('sub','Geotix  |  Jun 2017 - Jun 2020  |  Traverse City, Michigan')
for b in ["Handled customer service for 70+ partners, 3,000+ partner clients, and 400,000+ end customers, responding to every ticket within two hours.",
          "Tested issues for reproducibility before escalating, documented what would not reproduce, and ran the weekly session feeding that back to product.",
          "Wrote the FAQ and knowledge-base documentation, and carried customer feedback into product recommendations."]:
    add('li',b)
add('gap')
add('role','Owner and Founder')
add('sub','Independent, contract  |  Apr 2013 - Jun 2017  |  Bellaire, Michigan')
for b in ["Ran day-to-day operations under five service contracts, handling up to 70 calls and 100 emails a day.",
          "Created and documented the processes underneath - refunds, chargebacks, phone sales, fulfilment."]:
    add('li',b)
add('gap')
add('role','District Court Legal Assistant II')
add('sub',"4th Judicial District Attorney's Office  |  Apr 2010 - Mar 2013")
for b in ["Managed complex caseloads for four attorneys.",
          "Worked across departments to keep discovery moving so attorneys had time to prepare for hearings."]:
    add('li',b)
add('gap')
add('h','TECHNOLOGIES')
add('p','Languages: Python, TypeScript/JavaScript, Go, SQL, Bash')
add('p','AI & ML: LLM evaluation and benchmarking, retrieval and RAG, embeddings, cross-encoder re-ranking, MCP servers and clients, agent tooling, prompt and eval harnesses, LiteLLM')
add('p','Data: PostgreSQL, BigQuery, SQLite, ETL and ingestion pipelines, spatial modelling, conformal prediction intervals, reporting and dashboards')
add('p','Cloud & infra: Google Cloud Platform (Cloud Run, Cloud Scheduler, Cloud Tasks, BigQuery), Docker, Proxmox, Cloudflare Tunnel and Access, Caddy, nginx, systemd, Linux')
add('p','Platforms & integration: HubSpot Ops Hub, REST APIs, webhooks, Google Apps Script, Stripe, OAuth and access provisioning')
add('p','Practice: pytest and Go test, CI/CD with GitHub Actions, git, technical writing and documentation')
add('gap')
add('h','EDUCATION & CERTIFICATIONS')
add('p','Central Michigan University - B.A. Sociology, emphasis in institutional systems.')
add('p','Gainsight Customer Success Certified (Level 1 & Advanced, 2021-2022); Customer Success Leader Certified (2022).')
add('p','PostgreSQL + SQL Bootcamp (2023).')

STYLE={'name':('F2',17,20),'tag':('F1',10.5,15),'meta':('F1',8.5,14),'h':('F2',10,16),
       'role':('F2',10.5,14),'sub':('F1',9,13),'p':('F1',9.5,12.6),'li':('F1',9.5,12.6),'gap':('F1',6,7)}
WRAP={'p':98,'li':95,'sub':110,'meta':110,'tag':92}
pages=[]; cur=[]; y=H-M
for kind,text in LINES:
    font,size,lead=STYLE[kind]
    chunks=[''] if kind=='gap' else textwrap.wrap(text,WRAP.get(kind,110)) or ['']
    for i,ch in enumerate(chunks):
        if y-lead < M:
            pages.append(cur); cur=[]; y=H-M
        x=M+(12 if kind=='li' else 0)
        if kind=='li' and i==0:
            cur.append((M,y,'F1',size,'-'))
        cur.append((x,y,font,size,ch))
        y-=lead
    if kind in ('h','role'): y-=2
pages.append(cur)

objs=[]
def obj(s): objs.append(s); return len(objs)
contents=[]
for pg in pages:
    parts=['BT']
    last=None
    for x,y,f,sz,t in pg:
        if not t: continue
        parts.append(f'/{f} {sz} Tf 1 0 0 1 {x:.1f} {y:.1f} Tm ({esc(t)}) Tj')
    parts.append('ET')
    stream='\n'.join(parts).encode()
    comp=zlib.compress(stream)
    contents.append(comp)
n_pages=len(pages)
# object layout: 1=catalog 2=pages 3..=page objs, then contents, then fonts
font_r=3+2*n_pages
body=[]
body.append((1,f'<< /Type /Catalog /Pages 2 0 R >>'.encode()))
kids=' '.join(f'{3+i} 0 R' for i in range(n_pages))
body.append((2,f'<< /Type /Pages /Count {n_pages} /Kids [{kids}] >>'.encode()))
for i in range(n_pages):
    pid=3+i; cid=3+n_pages+i
    body.append((pid,(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {W} {H}] '
        f'/Resources << /Font << /F1 {font_r} 0 R /F2 {font_r+1} 0 R >> >> /Contents {cid} 0 R >>').encode()))
for i,c in enumerate(contents):
    body.append((3+n_pages+i, b'<< /Length %d /Filter /FlateDecode >>\nstream\n'%len(c)+c+b'\nendstream'))
body.append((font_r,b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'))
body.append((font_r+1,b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'))
out=bytearray(b'%PDF-1.4\n')
offs={}
for num,data in sorted(body):
    offs[num]=len(out)
    out+=b'%d 0 obj\n'%num+data+b'\nendobj\n'
xref=len(out)
maxn=max(offs)+1
out+=b'xref\n0 %d\n'%maxn+b'0000000000 65535 f \n'
for i in range(1,maxn):
    out+=b'%010d 00000 n \n'%offs.get(i,0)
out+=b'trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n'%(maxn,xref)
# Content-addressed filename: the URL changes whenever the PDF does, so a CDN
# or a browser cannot serve a stale copy. The download attribute in the page
# gives the visitor a clean filename regardless of what the URL says.
import hashlib, glob, re, pathlib
os.makedirs('resume', exist_ok=True)
data = bytes(out)
tag = hashlib.sha256(data).hexdigest()[:8]
name = f'eric-minish-resume-{tag}.pdf'
for stale in glob.glob('resume/eric-minish-resume*.pdf'):
    if os.path.basename(stale) != name:
        os.remove(stale)
pathlib.Path('resume', name).write_bytes(data)

page = pathlib.Path('resume/index.html')
html = page.read_text()
html2 = re.sub(r'/resume/eric-minish-resume[0-9a-z-]*\.pdf', f'/resume/{name}', html)
if html2 != html:
    page.write_text(html2)
print(f'{name} — {n_pages} pages, {len(data)} bytes (link {"updated" if html2 != html else "already current"})')
