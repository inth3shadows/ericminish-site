import zlib, textwrap, os
W,H=612,792; M=48
LINES=[]
def esc(t):
    t=t.replace('\u2014','-').replace('\u2013','-').replace('\u2019',"'").replace('\u201c','"').replace('\u201d','"')
    t=t.encode('cp1252','replace').decode('cp1252')
    return t.replace('\\','\\\\').replace('(','\\(').replace(')','\\)')
def add(kind,text=''): LINES.append((kind,text))
add('name','ERIC MINISH')
add('tag','AI infrastructure & backend engineering, embedded in operations. I build checks that find problems in systems before people notice them.')
add('meta','hi@ericminish.com  |  ericminish.com  |  github.com/inth3shadows  |  linkedin.com/in/ericminish  |  Central Lake, Michigan')
add('gap')
add('h','SUMMARY')
add('p','I work in Python, Go and SQL. I build MCP servers, retrieval systems, evaluation harnesses, ingestion pipelines, and the cloud services they run on. I built, deployed and maintain most of it myself.')
add('p','I look for problems that do not raise an error, and build checks that catch them. In customer-success operations the problem was account risk: churn fell from 30% to under 10% after the system began flagging at-risk customers before they left. More recently I have applied the same approach to my own tools: a proxy that only sends compressed output it can decode back exactly, a search engine whose evaluation showed it gave useful answers to half of the test questions, and a well-record model target that looked like new signal until a depth baseline showed it was about 96% a restatement of depth.')
add('gap')
add('h','EXPERIENCE')
add('role','Senior AI Engineer')
add('sub','Transactly  |  Jul 2023 - Present  |  Remote  |  At Transactly since Sep 2020.')
add('p','I own the internal systems layer: the workflow logic, its integrations with the other systems, and the reporting that explains the results to people who were not involved. That covers roughly sixty active projects, two-thirds of which changed in the last month.')
for b in ["Built an LLM-assisted compliance service. It transcribes calls and scores them against a rubric. Rule-based checks run first, then a person reviews; the model never makes the final decision.",
          "Scope and deploy technical workflows for customer success, onboarding and internal operations, using SQL, our CRM's APIs, and tools shared by several departments.",
          "Built and maintain SQL-backed reporting for subscription logic and billing reconciliation.",
          "Lead the employee onboarding and offboarding workflows, which are tied to access control and system provisioning.",
          "Design and implement CRM automations for customer success, sales and partnerships.",
          "Write custom workflows and scripts for internal infrastructure. These include ingestion services and scheduled jobs on managed cloud infrastructure, reporting built on a data warehouse and protected by access control, and operational microservices. The code is mostly Python, with TypeScript for user-facing work. These systems have around 140 test files."]:
    add('li',b)
add('gap')
add('role','Customer Success Operations Manager')
add('sub','Transactly  |  Sep 2020 - Apr 2023  |  Previously Client Success Operations Lead, Success Coach, Success Support Specialist')
add('p','Owned process infrastructure and automation across customer success, product, sales and operations, including the reporting, tools and workflows that let the company see churn risk early.')
for b in ["Cut client churn from 30% to under 10% by redesigning processes and customer engagement around real-time risk scoring.",
          "Built and ran SQL-driven credit, billing and subscription reporting.",
          "Coordinated ticket workflows between the success and transaction-coordination teams. Issue resolution time fell by half.",
          "Represented customer success in decisions about the CRM, internal tools and platform workflows.",
          "Wrote and rolled out the customer-success playbooks and onboarding documentation.",
          "Kept the systems I was responsible for running through a 30% headcount reduction."]:
    add('li',b)
add('gap')
add('role','Agent infrastructure')
add('sub','Independent  |  2025 - Present  |  Built, shipped and run')
for b in ["RunEcho checks each agent edit against the names the repository declares before the file changes; it caught 4 of 9 confirmed invented names, in about 12 ms, with no model or network. Public, MIT license.",
          "terse is a proxy that compresses AI tool output without losing information. Across 365,144 tokens of real API payloads it used 59% fewer tokens than the original payloads. TOON 4.1.1 made the same payloads 6.5% larger. Public, MIT license.",
          "testgraph reads a diff and names the user journeys the change could have broken. Similar tools list tests and need coverage data from an earlier test run; testgraph works on a repository whose tests have never been run. Public, MIT license, published on PyPI.",
          "modelbench benchmarks models on real bug-fix commits mined from my own repositories. Each model runs each task three times, and models are scored on cost per solved task. Its write-up lists the earlier figures that were later corrected.",
          "harness judges each code change with four rule-based checks (tests, symbol contract, credential and vulnerability scans); no model judges and nothing commits automatically."]:
    add('li',b)
add('gap')
add('role','Data work and shipped applications')
add('sub','Independent  |  2025 - Present  |  Data, delivery and evidence')
for b in ["Lodestone is local search over years of my working notes. Its evaluation showed that it gave useful answers to 5 of 10 test questions at full scale, and I published that result.",
          "Frostline: spatial models on 50,083 well records, and a business built on what they can predict. The aquifer interval showed +38.8% apparent skill against the global median, but against a depth baseline it was about 96% a restatement of depth, so I cut it.",
          "Filed 111 issues against codegraph, an open-source code-intelligence tool I use daily (86 since closed; 17 of my pull requests merged), and built fault-injection harnesses that reproduce two of the bugs on demand.",
          "Deployed three applications end to end: a task scheduler with calendar sync, an e-signature and payment intake tool, and a lead-intake product for a client."]:
    add('li',b)
add('gap')
add('role','Customer Success Manager')
add('sub','Geotix  |  Jun 2017 - Jun 2020  |  Traverse City, Michigan')
for b in ["Handled customer service for 70+ partners, 3,000+ partner clients and 400,000+ end customers. Every ticket received a response within two hours.",
          "Tested each issue for reproducibility before escalating it, documented the ones that would not reproduce, and ran the weekly session that reported them back to product.",
          "Wrote the FAQ and knowledge-base documentation, and turned customer feedback into product recommendations."]:
    add('li',b)
add('gap')
add('role','Owner and founder')
add('sub','Independent, contract  |  Apr 2013 - Jun 2017  |  Bellaire, Michigan')
for b in ["Ran day-to-day operations under five service contracts. The work involved up to 70 calls and 100 emails a day.",
          "Created and documented the processes behind refunds, chargebacks, phone sales and fulfillment."]:
    add('li',b)
add('gap')
add('role','District Court Legal Assistant II')
add('sub',"4th Judicial District Attorney's Office  |  Apr 2010 - Mar 2013")
for b in ["Managed complex caseloads for four attorneys.",
          "Worked across departments to keep discovery moving, so the attorneys had time to prepare for hearings."]:
    add('li',b)
add('gap')
add('h','WHAT I WORK WITH  (each is used in work listed above)')
add('p','Languages: Python, TypeScript/JavaScript, Go, SQL, Bash')
add('p','AI & ML: LLM evaluation and benchmarking, retrieval and RAG, embeddings, cross-encoder re-ranking, MCP servers and clients, agent tooling, prompt and eval harnesses, LiteLLM')
add('p','Data: PostgreSQL, BigQuery, SQLite, ETL and ingestion pipelines, spatial modeling, conformal prediction intervals, reporting and dashboards')
add('p','Cloud & infra: Google Cloud Platform (Cloud Run, Cloud Scheduler, Cloud Tasks, BigQuery), Docker, Proxmox, Cloudflare Tunnel and Access, Caddy, nginx, systemd, Linux')
add('p','Platforms & integration: HubSpot Ops Hub, REST APIs, webhooks, Google Apps Script, Stripe, OAuth and access provisioning')
add('p','Practice: pytest and Go test, CI/CD with GitHub Actions, git, technical writing and documentation')
add('gap')
add('h','EDUCATION & CERTIFICATIONS')
add('p','Central Michigan University - B.A. Sociology, emphasis in institutional systems.')
add('p','Gainsight Customer Success Certified, Level 1 and Advanced (2021-2022). Customer Success Leader Certified (2022). PostgreSQL & SQL Bootcamp, 2023.')

STYLE={'name':('F2',17,20),'tag':('F1',10.5,15),'meta':('F1',8.5,14),'h':('F2',10,16),
       'role':('F2',10.5,14),'sub':('F1',9,13),'p':('F1',9.5,11.8),'li':('F1',9.5,11.8),'gap':('F1',6,5)}
WRAP={'p':103,'li':100,'sub':118,'meta':125,'tag':92}
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
