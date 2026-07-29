import zlib, textwrap, os
W,H=612,792; M=54
LINES=[]
def esc(t):
    t=t.replace('\u2014','-').replace('\u2013','-').replace('\u2019',"'").replace('\u201c','"').replace('\u201d','"')
    t=t.encode('cp1252','replace').decode('cp1252')
    return t.replace('\\','\\\\').replace('(','\\(').replace(')','\\)')
def add(kind,text=''): LINES.append((kind,text))
add('name','ERIC MINISH')
add('tag','Systems Engineer — I build the checks that catch what is breaking quietly')
add('meta','hi@ericminish.com  |  ericminish.com  |  github.com/inth3shadows  |  linkedin.com/in/ericminish')
add('gap')
add('h','SUMMARY')
add('p','I find the thing that is quietly breaking and build the check that catches it the next time. At Transactly that was account risk: churn went from 30% to under 10% because the system flagged customers before they left rather than explaining them afterwards. Lately it has been my own tooling - a proxy that refuses to compress anything it cannot rebuild exactly, a search engine whose evaluation told me half of it did not work, and a well-depth model that lost its most promising variable the moment it was measured against the right baseline.')
add('gap')
add('h','EXPERIENCE')
add('role','Lead Systems & Automation Specialist')
add('sub','Transactly  |  Sep 2020 - Present  |  Tech-enabled real estate transaction coordination')
for b in ["Cut churn from 30% to under 10% by scoring account risk in real time, so the intervention happened before the customer left.",
          "Halved support resolution time by giving tickets clear owners and automating the queue.",
          "Built the SQL and reporting stack used for billing, onboarding, and retention decisions.",
          "Automated onboarding for small accounts, returning about 20% of the customer-success team's time.",
          "Kept every system running through a 30% headcount reduction. Nothing broke.",
          "Own roughly sixty active internal project directories - CRM integration and lead-management APIs, ingestion services and scheduled jobs on managed cloud infrastructure, warehouse-backed reporting behind access control, and operational microservices. Python-dominant, TypeScript for user-facing work, ~140 test files across the estate.",
          "Built an LLM-assisted compliance service: transcribes calls and scores them against a rubric, deterministic checks first and human review after, with the model never given the last word."]:
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
add('sub','Geotix  |  Jun 2017 - Jun 2020')
for b in ["Supported 70+ partners and roughly 3,000 clients across onboarding and troubleshooting.",
          "Built the triage flow the support team still uses to escalate to product.",
          "Wrote the team's onboarding and training playbooks."]:
    add('li',b)
add('gap')
add('role','Founder')
add('sub','Independent E-Commerce Systems  |  Mar 2013 - Jun 2017')
for b in ["Ran fulfilment, returns, payments, and support across three storefronts, solo.",
          "Built the refund and inventory logic that kept it running without hiring."]:
    add('li',b)
add('gap')
add('h','SKILLS')
add('p','Automation & systems: workflow design, durable lifecycle systems for onboarding, billing and risk, internal tooling.')
add('p','AI tooling: MCP server development, LLM evaluation and benchmarking, agent verification.')
add('p','Data & APIs: SQL (PostgreSQL, BigQuery), REST APIs, webhooks.')
add('p','Platforms: Python, TypeScript, Docker, Postgres, Cloudflare, Stripe, HubSpot Ops Hub, Proxmox.')
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
os.makedirs('resume',exist_ok=True)
open('resume/eric-minish-resume.pdf','wb').write(bytes(out))
print('pages',n_pages,'bytes',len(out))
