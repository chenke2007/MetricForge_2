# MetricForge Agent Guidelines

## Product Priority

- Keep the core focus on AI ask / intelligent metric questioning.
- Treat SQL Workbench as a downstream validation and debugging surface, not the primary product entry.
- Do not turn AI ask work into generic SQL tooling unless the active phase explicitly says so.

## Development Boundaries

- Do not introduce backend APIs, database changes, or migrations unless the active phase explicitly authorizes them.
- Do not integrate a real LLM unless the active phase explicitly enters the real LLM stage.
- Do not add Playwright or Cypress.
- Do not test Monaco DOM details.
- Mock datasource `{ id: 2, name: 'dwhrpt' }` is allowed in mock, fixture, and scenario boundaries only; do not hardcode `dwhrpt` in business logic.
- Do not process historical untracked Phase 4 docs unless explicitly requested.
- Do not push, merge, create PRs, reset, rebase, or force-push without explicit user authorization.

## Frontend Design Guidance

All visible frontend UI work should use `taste-skill` as a secondary design-quality reference:

- Reference: https://github.com/Leonxlnx/taste-skill
- Use it to avoid generic AI-generated UI, weak spacing, unclear hierarchy, missing interaction states, and template-like layouts.
- Apply it mainly to visible product UI: AI ask workbench, panels, report surfaces, loading states, empty states, error states, validation states, and quality dashboards.
- Do not apply it to pure logic modules, adapters, benchmark scripts, type-only changes, or tests unless the UI itself is affected.

Priority order:

1. Active phase spec and implementation plan.
2. MetricForge product positioning and constraints in this file.
3. Existing codebase patterns, Ant Design usage, and current component structure.
4. `taste-skill` polish suggestions.

MetricForge should feel like a dense, calm, enterprise AI analytics workbench. Do not copy landing-page, portfolio, hero-page, heavy animation, or decorative marketing patterns from external design guidance.

## Review And Reporting

- Treat implementation summaries as claims to verify, not conclusions.
- For every completed task, report current `git status --short --branch`, `git diff --stat`, `git diff --cached --stat`, the relevant commit hash, and actual test commands with results.
- Stop after each task and wait for review authorization before starting the next task, unless the user explicitly authorizes continuing.
