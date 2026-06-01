# AGENTS.md

> Auto-generated project context for AI assistants.

## Tech Stack
- Runtime: Bun v1.4.x
- Language: TypeScript 5.7
- Framework: opencode Plugin SDK

## Conventions
- Line endings: LF (never CRLF)
- Indentation: 2 spaces
- Quotes: single quotes for strings
- Semicolons: required
- Import style: ES modules with .js extensions

## Naming Conventions
- Files: kebab-case.ts
- Classes: PascalCase
- Functions: camelCase
- Constants: UPPER_SNAKE_CASE
- Test files: *.test.ts

## Build & Development
```bash
bun run build     # bundle with bun
bun test          # run all tests
bun run typecheck # tsc --noEmit
```

## Forbidden Patterns
- NEVER use `any` type
- NEVER use `eval()`
- NEVER use `var`
- NEVER use `console.log` in production code
- NEVER use `process.exit()` in plugins

## Anti-Patterns
- Avoid mutable global state
- Avoid circular imports
- Avoid deep nesting (>3 levels)
- Avoid magic numbers

## License
Apache-2.0

## Contributors
Robby Beyer

## Version History
See HISTORY.md

## External Dependencies
- @opencode-ai/plugin v1.15.x
- bun:sqlite (built-in)

---

## Random Filler Content (should NOT appear in curator output)

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.

Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo. Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt.

### Configuration Details

The following configuration values are preset and should never be changed without explicit approval:

1. Database connection pooling: max 20 connections
2. Cache TTL: 3600 seconds
3. Rate limit: 100 requests per minute
4. Log level: info (production), debug (development)
5. Session timeout: 30 minutes

### Deployment Process

Step 1: Run all tests
Step 2: Build production bundle
Step 3: Tag release with semver
Step 4: Push to GitHub
Step 5: npm publish
Step 6: Verify installation
Step 7: Monitor logs for errors
Step 8: Rollback if needed

### Monitoring Checklist

- CPU usage < 80%
- Memory usage < 2GB
- Response time < 200ms p95
- Error rate < 0.1%
- Disk usage < 80%

### Database Schema Notes

The primary database uses the following schema conventions:
- Primary keys: UUID v7
- Timestamps: ISO 8601 with millisecond precision
- Enums: stored as strings (not integers)
- JSON columns: validated via JSON Schema
- Foreign keys: always indexed

## Project Timeline

The following milestones are tracked in the project management system:

- Q1 2026: Initial architecture design and proof of concept
- Q2 2026: Core feature implementation and internal testing
- Q3 2026: Beta release and user acceptance testing
- Q4 2026: Production release and monitoring setup

## Risk Assessment

Identified risks and their mitigation strategies:

1. Performance degradation under load — implement caching layer and rate limiting
2. Data loss during migration — automated backup and rollback procedures
3. API breaking changes — versioned API endpoints with deprecation notices
4. Security vulnerabilities — regular dependency updates and security audits
5. Third-party service downtime — circuit breaker pattern and fallback mechanisms
6. Scope creep — strict change management process and weekly prioritization

## Budget Overview

| Item | Allocation |
|------|------------|
| Infrastructure | 40% |
| Development | 35% |
| Testing | 15% |
| Documentation | 10% |

## Stakeholder Information

- Product Owner: Jane Doe (jane@example.com)
- Tech Lead: John Smith (john@example.com)
- QA Lead: Alice Johnson (alice@example.com)
- DevOps: Bob Wilson (bob@example.com)
- Documentation: Charlie Brown (charlie@example.com)
- Security: Diana Prince (diana@example.com)

## Performance Metrics

Key performance indicators tracked across all services:

- API response time < 100ms (p50), < 300ms (p99)
- Database query time < 50ms (p95)
- Cache hit ratio > 90%
- Uptime SLA: 99.95%
- Deployment frequency: weekly (minor), bi-weekly (major)
- Mean time to recovery: < 30 minutes
- Code coverage: > 85%
- Vulnerability scan pass rate: 100%

## On-Call Rotation

The on-call schedule follows a weekly rotation pattern:

Week 1: Primary — Alice, Secondary — Bob
Week 2: Primary — Charlie, Secondary — Diana
Week 3: Primary — Eve, Secondary — Frank
Week 4: Primary — Grace, Secondary — Henry

Contact procedures: PagerDuty alert → 15 minute acknowledgement window → 60 minute resolution target. Escalation after 30 minutes if primary does not respond.

## Infrastructure Costs

Monthly cloud infrastructure costs are tracked per environment:

Development: $500 (shared t3.medium instances)
Staging: $1,200 (replica of production, scaled down)
Production: $4,500 (multi-AZ deployment with auto-scaling)
CDN: $350 (CloudFront distribution)
Database: $800 (RDS multi-AZ)
Monitoring: $250 (DataDog integration)

Total estimated monthly: $7,600

## Compliance Requirements

This project must adhere to the following regulatory standards:

GDPR: Right to erasure, data portability, consent management
SOC 2: Access controls, change management, risk monitoring
PCI-DSS: Encryption at rest and in transit, audit logging
HIPAA: BAA agreements, minimum necessary access, audit controls
ISO 27001: ISMS implementation, risk assessment, continuous improvement

This filler section contains extensive configuration, deployment, and operational documentation that is NOT relevant to AI coding context and SHOULD be stripped by the curator's repo_profile layer.
