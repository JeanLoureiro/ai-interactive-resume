# Jean Loureiro — CV

<!--
SOURCE NOTE
Transcribed by hand from the author's CV.

REDACTED AT THIS STEP, deliberately, before anything is indexed:
  - phone number
  - personal email address
Redaction is structural, not a runtime filter: the values are absent from this
file, so they cannot reach the index, the prompt, or a response. Public
professional handles (LinkedIn, GitHub) are kept — they are the intended
contact route and the assistant points at them instead of personal details.

FORMAT CONTRACT (parsed by lib/sources/cv.ts)
  ##   section  -> determines unitType
  ###  entry    -> one retrievable knowledge unit, id slugged from the heading
  **Employer:** / **Dates:** / **Link:**  -> optional metadata lines
Each unit repeats its own employer and dates rather than inheriting them from
the document, because units are retrieved independently — the model sees the
unit, never the surrounding page.
-->

**Title:** Senior AI Engineer

**Location:** Gold Coast, QLD, Australia

**LinkedIn:** linkedin.com/in/jeanloureiro

**GitHub:** github.com/JeanLoureiro

**Contact details:** redacted from this knowledge base by design. See the source note above.

## Summary

### Professional summary

Senior engineer with 15+ years shipping production software, now focused on agentic systems and the
engineering harnesses that make AI output dependable. Designs the constraints agents work inside:
skills, hooks, subagents, AGENTS.md conventions and codegen, so generated code meets the standard
before it reaches a human reviewer.

Builds LLM applications end to end in Python and TypeScript, tool interfaces via MCP, evaluation
scripts and deliberate human approval checkpoints for anything that reaches a customer. At KPMG,
delivered Azure OpenAI features into a heavily governed Big Four environment and set the frontend
engineering standards a team worked to.

Cares about consistency, simplicity and maintainability: systems other people can support after
handover.

## Skills

### Skills — AI and agentic engineering

LLM application development (Anthropic API, Azure OpenAI), agent workflow design, human-in-the-loop
approval and escalation patterns, MCP servers (building and integrating), harness engineering
(skills, hooks, subagents, slash commands, AGENTS.md, codegen), prompt-driven development,
evaluation scripts and automated test suites, Claude Code, GitHub Copilot, git worktrees.

### Skills — Languages

TypeScript, JavaScript, Python, C# (review and maintain), SQL, CSS/SASS.

### Skills — Backend and data

FastAPI, Node.js, REST APIs, SignalR (WebSockets), Azure Functions, Supabase, PostgreSQL.

### Skills — Azure and DevOps

Azure OpenAI, Azure Functions, App Service, Key Vault, Application Insights, Entra ID, Azure DevOps
(ADO), CI/CD pipelines, Git, automated testing, peer review, release management.

### Skills — Frontend

React, Next.js, Material-UI (MUI), Nx, Module Federation, Microfrontend Architecture, Storybook,
Tailwind, Mobx.

### Skills — Delivery

Agile squads (Scrum, Kanban, XP), backlog refinement, showcases, code review standards, technical
documentation.

## Experience

### KPMG — Manager, Senior Software Engineer

**Employer:** KPMG
**Dates:** 2022-04 .. 2026-08
**Location:** Remote

Business Services. Automated internal processes and led frontend architecture for audit and feedback
platforms handling sensitive client data inside a highly governed enterprise environment.

### KPMG — Agentic delivery: monorepo to microfrontend migration

**Employer:** KPMG
**Dates:** 2022-04 .. 2026-08

Situation: several product modules were being built inside one repository, creating delivery
contention between teams. The business wanted each module isolated at the engineering level while end
users kept a single application.

Task: convert the platform to a microfrontend architecture and rework CI/CD to match.

Action: wrote a set of agent skills driven off a maintained ARCHITECTURE.md and used them to carry
out the conversion to Nx and Module Federation, then updated pipelines so each module built, tested
and deployed independently.

Result: migration completed in under a week. Teams moved into their own repositories behind a shell
application that registers modules and allows new ones to be onboarded, meeting the stakeholder
requirement without disrupting the user-facing product.

### KPMG — Harness engineering: guardrails for AI-assisted development

**Employer:** KPMG
**Dates:** 2022-04 .. 2026-08

Situation: AI-assisted development was producing inconsistent code across the frontend team. Patterns
varied, coverage was uneven, and code review was absorbed by style corrections.

Task: put standards and automated verification in place so generated code met engineering principles
before a human ever looked at it.

Action: built an engineering harness — hooks enforcing linting, codegen for recurring patterns, and
best-practice instructions encoded into reusable skills and AGENTS.md. Added evaluation scripts and
test suites checking how code was structured, tested and styled.

Result: test coverage rose from roughly 40% to over 90%. The team adopted the harness because it
demonstrably improved coverage and consistency, output converged on a single standard, and review
time shifted from correcting style to discussing design.

### KPMG — OnTrack audit platform

**Employer:** KPMG
**Dates:** 2022-04 .. 2026-08

Led frontend for an audit platform spanning four domains (Pricing, Budgeting, Engagement,
Compliance), leading two developers. Architected the Nx microfrontend platform with a Storybook
component library, integrated documentation and a customised MUI theme. Partnered with the .NET team
to shape REST API contracts, reviewing and maintaining C# where needed.

### KPMG — KymChat enterprise assistant

**Employer:** KPMG
**Dates:** 2022-04 .. 2026-08

Enterprise Azure OpenAI assistant adopted organisation-wide. Built the frontend foundation and
architecture, and implemented real-time token streaming over WebSockets (SignalR) before streaming
was supported in the Azure SDK. Integrated against the retrieval and safety layers owned by the
backend platform team. Shipped 12+ feature releases into KPMG operational workflows.

### KPMG — UFP (Unified Feedback Platform)

**Employer:** KPMG
**Dates:** 2022-04 .. 2026-08

Built from scratch with a Vite frontend and Azure Functions serverless backend, consolidating and
benchmarking survey data across sectors and automating report generation in 8+ formats.

### SeaportOPX (DHI) — Senior Front-End Developer

**Employer:** SeaportOPX (DHI)
**Dates:** 2020-09 .. 2022-04
**Location:** Hybrid

Contributed to the migration of NCOS Online from Web Components to React with Mobx, working alongside
the Tech Lead on a port operations platform used for transit predictions and mooring arrangements.
Introduced Storybook for component documentation and ran the team's first experiments with Module
Federation. Certified as a Scrum Master to help the team establish consistent Agile practices,
improving sprint predictability by surfacing blockers earlier.

### Localsearch — Front-End Developer (ReactJS)

**Employer:** Localsearch
**Dates:** 2019-04 .. 2020-05
**Location:** Robina

Migrated the codebase from class components to React Hooks and cut bundle size through code splitting
and dependency reduction, improving initial load time and search rankings on an AWS-hosted
application.

## Projects

### Marketing Triage, EC Pohl & Co

**Employer:** EC Pohl & Co
**Dates:** 2026-01 .. present
**Role:** AI Engineer
**Status:** in test, launching shortly

End-to-end LLM application for a wealth management firm, built solo in Python and FastAPI on the
Anthropic API. A client submits a form; the system selects the appropriate product for their
circumstances, drafts a tailored email, and routes it to the CMO through a dashboard for review and
approval before anything is sent. Human approval is a designed control point, not an afterthought.
Also building an MCP server that exposes recommendation activity to the CMO, so marketing campaigns
can be planned around what the system is actually recommending rather than guesswork.

Note on the date: the CV states the year 2026 without a month. The month recorded here is not stated
in the source.

### Pohly — private wealth client portal

**Employer:** EC Pohl & Co
**Dates:** 2025-11 .. present
**Role:** Forward Deployed Engineer
**Link:** portal.ecpohl.com

Embedded with the client and stakeholders to understand the problem, then built a working proof of
concept quickly to validate feasibility before any commitment to a full build. After alignment on the
POC, led technical scoping for a full portal covering dashboards, reporting, onboarding, portfolio
views and portfolio news. Next.js, TypeScript, MUI.

### Financial Sanity

**Dates:** 2025-01 .. present
**Role:** Full Stack Developer
**Link:** financialsanity.app

Started as a personal tool to organise personal finances and grew into a wealth-tracking app for
Australian investors: net worth aggregation across stocks, ETFs, crypto, property and superannuation,
FIRE projections, and FIFO capital gains calculations aligned to Australian tax rules. Designed and
built solo. Next.js, TypeScript, Tailwind, Supabase.

### The Clubhouse Poker

**Dates:** 2024-11 .. present
**Role:** Full Stack Developer
**Link:** theclubhousepoker.com

Live poker platform serving active users, built with a co-founder from Atlassian on shared full-stack
responsibilities. Led the migration from AWS Amplify to Supabase, redesigning the data architecture
and authentication flow to reduce infrastructure complexity. Next.js, TypeScript, Tailwind, Supabase.

### How the projects are built

All four projects are developed agent-first using Claude Code: planning with Opus, implementation
with Sonnet and Haiku, inside a harness of project skills, hooks and slash commands.

## Certificates

### Scrum Master

Scrum Master, scrum.org.

### Kanban Management Professional I

KMP I, Kanban System Design.
