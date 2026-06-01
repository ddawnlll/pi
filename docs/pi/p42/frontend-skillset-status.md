# Frontend Skillset Status — P42

## Last Updated
2026-06-01 — Baseline after skill symlink/installation audit.

## Auto-Loading Skills for Dashboard Tasks

These skills are installed and configured to auto-load when the task involves dashboard UI, React components, or frontend quality:

| Skill | Auto-Load Trigger | Notes |
|---|---|---|
| shadcn | shadcn tasks, dashboard component creation/modification | Primary UI component skill |
| react-doctor | Frontend audit, quality checks, /doctor | Lint, a11y, bundle, architecture |
| vercel-react-best-practices | React dashboard implementation/review | Performance patterns |
| vercel-composition-patterns | Dashboard component architecture | Compound components, render props |
| web-design-guidelines | UX, accessibility, design review | WCAG, responsive, design systems |

## Explicit-Only Skills (Do Not Auto-Load)

These skills are installed but only load when explicitly referenced:

| Skill | Condition to Load | Notes |
|---|---|---|
| vercel-optimize | Only if task involves Vercel deployment/perf optimization | |
| vercel-react-view-transitions | Only if task involves page transitions | |
| deploy-to-vercel | Only if task involves deployment | |
| vercel-cli-with-tokens | Only if task involves Vercel CLI | |

## Disabled Skills

| Skill | Reason |
|---|---|
| vercel-react-native-skills | Not relevant for web dashboard |
| Other native/mobile skills | Not relevant for web dashboard |

## Policy

- P42 dashboard UI redesign tasks automatically load: shadcn, react-doctor, vercel-react-best-practices, vercel-composition-patterns, web-design-guidelines
- Do NOT auto-load deploy/CLI/native skills during dashboard implementation
- Skills are a supplement to concrete API/interface documentation — they do not replace the P42 Interface Map
