// OpenAPI 3.0 spec for wf-agents-api, served live at GET /docs/openapi
// (YAML) and rendered at GET /docs/api (Redoc HTML).
//
// SINGLE SOURCE: this module. The YAML lives here (not a sidecar .yaml
// file) because the esbuild bundle is handler.ts-rooted — an imported TS
// module ships with the function automatically, with no Makefile asset
// copy to forget (the forgotten-sync failure class ADR-0007/0008 exist
// to kill). Keep it in lockstep with the route table in handler.ts; the
// `check-api-routes` workflow guards template↔live drift, and a future
// lint can diff this spec against the handler's routeKey dispatch.

export const OPENAPI_VERSION = "2026-06-14";

export const OPENAPI_YAML = `openapi: 3.0.3
info:
  title: Workforce Agents API (wf-agents-api)
  version: "${OPENAPI_VERSION}"
  description: |
    The single management/read surface for the agent workforce.

    **Authoritative stores** (ADR-0007 / ADR-0008): agent identity+config and
    skill judgment-config live in DynamoDB and mutate ONLY through this API —
    every write is schema-validated at the boundary, appends an immutable
    AUDIT item, and is compiled into the weekly config digest. Writes are
    live immediately (no deploy).

    **Auth tiers**
    - 'public' — read-only GETs (CORS-gated to the console host).
    - 'AWS_IAM' — SigV4-signed operator writes (aws-vault / the console's
      Cognito→Identity-Pool broker).
    - 'bearer' — capability tokens for specific machine write paths
      (POST /feed, POST /agents/{slug}/engagements).

    **Not exposed by design**: POST /skills (a new skill needs its git
    write-script — cadence-forge scaffold + PR), POST /projects (project.json
    + seed step). Code-side skill fields (write-scripts, requires[],
    archetype, deliverable) are git-owned and rejected by PATCH /skills.
servers:
  - url: https://workforce-api.kohuehara.xyz
    description: prod (custom domain, ADR-0004)
  - url: https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod
    description: prod (execute-api origin — sign SigV4 against this host)
tags:
  - name: agents
  - name: skills
  - name: projects
  - name: feed
  - name: threads
  - name: meta
components:
  securitySchemes:
    sigv4:
      type: apiKey
      in: header
      name: Authorization
      description: AWS SigV4 (service execute-api). API Gateway AWS_IAM authorizer.
    bearer:
      type: http
      scheme: bearer
      description: Capability token scoped to one write path (Secrets Manager-held).
  parameters:
    pageSize:
      name: page_size
      in: query
      schema: { type: integer, minimum: 1, maximum: 100, default: 25 }
    cursor:
      name: cursor
      in: query
      schema: { type: string }
      description: Opaque pagination cursor from the previous page's next_cursor.
  schemas:
    Violation:
      type: object
      properties:
        rule: { type: string, example: S5-model }
        field: { type: string }
        msg: { type: string }
    ValidationError:
      type: object
      properties:
        error: { type: string, enum: [config_validation_failed] }
        violations:
          type: array
          items: { $ref: '#/components/schemas/Violation' }
    BindingTrigger:
      type: object
      required: [scheduler]
      properties:
        scheduler: { type: string, enum: [eventbridge, claude-code-routine, gha, external, manual] }
        cron: { type: string, example: "cron(7 1 ? * * *)", description: 'EventBridge cron, UTC. Hourly floor (G1).' }
        github_event: { type: string }
        invoked_by: { type: string, enum: [api, repository_dispatch, manual] }
        fired_from: { type: string, example: wf-orchestrator-tick }
    Binding:
      type: object
      required: [skill, executor, trigger]
      description: One (skill x agent x project) wiring. Array position is binding_idx — append, don't reorder.
      properties:
        skill: { type: string, example: grid-watch }
        executor: { type: string, enum: [claude-code-routine] }
        trigger: { $ref: '#/components/schemas/BindingTrigger' }
        routine_spec: { type: string, example: workforce/docs/routines/agent-runner.md }
        project_id: { type: string, example: agent-workforce, description: Project whose credential bag is injected at fire time. Required for CCR-batched bindings. }
        config: { type: object, additionalProperties: true, description: Persona overlay forwarded to the skill. }
        note: { type: string }
    AgentSummary:
      type: object
      description: Lean list view — system_prompt and the profile decks are stripped; about is server-derived.
      properties:
        slug: { type: string }
        first_name: { type: string }
        last_name: { type: string }
        residence: { type: string, example: "Washington, DC, US" }
        role: { type: string }
        model: { type: string, example: anthropic:claude-sonnet-4-6 }
        prompt_version: { type: string }
        budget_monthly_usd_default: { type: number }
        budget_monthly_usd_override: { type: number, nullable: true }
        budget_monthly_usd_effective: { type: number }
        default_project: { type: string }
        streams:
          type: array
          items: { type: string, enum: [internal, client, editorial] }
        bindings:
          type: array
          items: { $ref: '#/components/schemas/Binding' }
        reports_to: { type: array, items: { type: string } }
        lateral: { type: array, items: { type: string } }
        about: { type: string, description: First prose paragraph of the persona prompt. }
        created_at: { type: string }
        paused: { type: boolean }
        archived: { type: boolean }
        last_run_at: { type: string }
        last_run_status: { type: string, enum: [ok, throw, dlq] }
        runs_this_month: { type: integer }
        cost_this_month_usd: { type: number }
        deliv_count_total: { type: integer }
    Agent:
      allOf:
        - $ref: '#/components/schemas/AgentSummary'
        - type: object
          properties:
            system_prompt: { type: string, description: The persona prompt (former system.md body). }
            owner_email: { type: string, nullable: true }
            jd: { type: object, nullable: true, additionalProperties: true }
            identity: { type: object, nullable: true, additionalProperties: true }
            experience: { type: object, nullable: true, additionalProperties: true }
            memory: { type: object, nullable: true, additionalProperties: true }
    AgentCreate:
      type: object
      required: [slug, first_name, last_name, residence, role, model, prompt_version, budget_monthly_usd_default, default_project, streams, bindings, system_prompt]
      description: created_at and the operational/computed slices are server-set (400 if supplied).
      properties:
        slug: { type: string, pattern: '^[a-z]+$' }
        first_name: { type: string }
        last_name: { type: string }
        residence: { type: string, description: '"City, Country" form' }
        role: { type: string }
        model: { type: string, description: 'provider:name, provider in {anthropic, azure, claude-code}' }
        prompt_version: { type: string, description: semver }
        budget_monthly_usd_default: { type: number, description: W-3 aggregate cap enforced across the roster }
        default_project: { type: string }
        streams: { type: array, items: { type: string, enum: [internal, client, editorial] } }
        bindings: { type: array, items: { $ref: '#/components/schemas/Binding' } }
        system_prompt: { type: string, maxLength: 32768 }
        owner_email: { type: string, nullable: true }
        jd: { type: object, nullable: true, additionalProperties: true }
        identity: { type: object, nullable: true, additionalProperties: true }
        experience: { type: object, nullable: true, additionalProperties: true }
        memory: { type: object, nullable: true, additionalProperties: true }
        reports_to: { type: array, items: { type: string } }
        lateral: { type: array, items: { type: string } }
    AgentPatch:
      type: object
      description: Any subset of the identity fields (AgentCreate minus slug) plus the operational fields. Immutable/computed fields are rejected 400.
      properties:
        first_name: { type: string }
        last_name: { type: string }
        residence: { type: string }
        role: { type: string }
        model: { type: string }
        prompt_version: { type: string }
        budget_monthly_usd_default: { type: number }
        budget_monthly_usd_override: { type: number, nullable: true }
        default_project: { type: string }
        streams: { type: array, items: { type: string } }
        bindings: { type: array, items: { $ref: '#/components/schemas/Binding' }, description: REPLACES the whole array — binding CRUD = rewrite. }
        system_prompt: { type: string }
        owner_email: { type: string, nullable: true }
        jd: { type: object, nullable: true, additionalProperties: true }
        identity: { type: object, nullable: true, additionalProperties: true }
        experience: { type: object, nullable: true, additionalProperties: true }
        memory: { type: object, nullable: true, additionalProperties: true }
        reports_to: { type: array, items: { type: string } }
        lateral: { type: array, items: { type: string } }
        paused: { type: boolean }
        archived: { type: boolean }
    AuditItem:
      type: object
      properties:
        at: { type: string, format: date-time }
        actor: { type: string, description: IAM principal ARN }
        source: { type: string, enum: [agents-api] }
        kind: { type: string, enum: [create, identity, operational, config] }
        changes:
          type: array
          items:
            type: object
            properties:
              field: { type: string }
              before: { description: 'Strings >1KB stored as {truncated, length, sha256, head} digests.' }
              after: {}
    Skill:
      type: object
      properties:
        name: { type: string }
        version: { type: string }
        status: { type: string, enum: [active, stale, deprecated] }
        description: { type: string }
        body: { type: string, description: 'The SKILL.md judgment text — DDB-authoritative (ADR-0008); the runner composes with THIS, not the git copy.' }
        deliverable: { type: object, nullable: true, additionalProperties: true, description: Git-authoritative (seed-reconciled); not PATCHable. }
        cost_class: { type: string, enum: [small, medium, large] }
        owners: { type: array, items: { type: string }, description: Agent slugs allowed to bind this skill (R8). }
        improvement_agent: { type: string, nullable: true }
        improvement_agent_override: { type: string, nullable: true }
        improvement_agent_effective: { type: string, nullable: true }
        created_at: { type: string }
        invocations_this_month: { type: integer }
        last_invoked_at: { type: string }
    SkillPatch:
      type: object
      description: Judgment-side fields only (ADR-0008). Git-owned fields (write-scripts, requires, archetype, deliverable) and name/created_at are rejected 400.
      properties:
        body: { type: string, maxLength: 65536 }
        description: { type: string, maxLength: 1024 }
        version: { type: string, description: semver }
        status: { type: string, enum: [active, stale, deprecated] }
        owners: { type: array, items: { type: string }, description: Must exist + be non-archived; shrinking past a live binding is rejected (R8-reverse). }
        cost_class: { type: string, enum: [small, medium, large] }
        improvement_agent: { type: string, nullable: true }
        improvement_agent_override: { type: string, nullable: true }
    Project:
      type: object
      properties:
        project_id: { type: string, example: agent-workforce }
        status: { type: string, enum: [active, archived] }
        owner_agent: { type: string }
        created_at: { type: string }
        archived_at: { type: string }
        member_count: { type: integer }
        last_execution_at: { type: string }
    Execution:
      type: object
      properties:
        exec_ulid: { type: string }
        project_id: { type: string }
        agent_slug: { type: string }
        skill_name: { type: string }
        skill_version: { type: string }
        started_at: { type: string }
        ended_at: { type: string }
        status: { type: string, enum: [ok, throw, skipped, failed_artefact_redaction] }
        artifact_ref: { type: object, nullable: true, additionalProperties: true }
        error: { type: string }
    FeedPost:
      type: object
      properties:
        post_id: { type: string }
        agent_slug: { type: string }
        posted_at: { type: string }
        kind: { type: string, enum: [reflection, friction, improvement, observation] }
        body_preview: { type: string, description: Legacy preview of the first 320 chars - prefer body }
        body: { type: string, description: Full post body returned by both the list and detail endpoints and S3-hydrated when it exceeds the inline preview }
paths:
  /agents:
    get:
      tags: [agents]
      summary: List agents (lean view)
      parameters:
        - $ref: '#/components/parameters/pageSize'
        - $ref: '#/components/parameters/cursor'
        - { name: stream, in: query, schema: { type: string, enum: [internal, client, editorial] } }
        - { name: archived, in: query, schema: { type: boolean }, description: Include archived agents. }
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  items: { type: array, items: { $ref: '#/components/schemas/AgentSummary' } }
                  next_cursor: { type: string, nullable: true }
    post:
      tags: [agents]
      summary: Create an agent (ADR-0007 full CRUD)
      security: [{ sigv4: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/AgentCreate' }
      responses:
        "201": { description: Created (kind=create AUDIT appended), content: { application/json: { schema: { $ref: '#/components/schemas/Agent' } } } }
        "400": { description: non_writable_fields / invalid_json }
        "409": { description: already_exists — a create is never an update }
        "422": { description: Validation failed, content: { application/json: { schema: { $ref: '#/components/schemas/ValidationError' } } } }
  /agents/{slug}:
    parameters:
      - { name: slug, in: path, required: true, schema: { type: string } }
    get:
      tags: [agents]
      summary: Single agent (full record incl. system_prompt + profile decks)
      responses:
        "200": { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/Agent' } } } }
        "404": { description: not_found }
    patch:
      tags: [agents]
      summary: Update identity/operational config (incl. bindings[] — the binding CRUD surface)
      security: [{ sigv4: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/AgentPatch' }
      responses:
        "200": { description: Updated (AUDIT appended; write = live next orchestrator tick), content: { application/json: { schema: { $ref: '#/components/schemas/Agent' } } } }
        "400": { description: non_patchable_fields / empty_patch }
        "404": { description: not_found }
        "422": { description: Validation failed (S1–S18, G1 cadence floor, R8, W-3 cap), content: { application/json: { schema: { $ref: '#/components/schemas/ValidationError' } } } }
    delete:
      tags: [agents]
      summary: Soft delete (archived=true)
      security: [{ sigv4: [] }]
      responses:
        "200": { description: Archived }
        "404": { description: not_found }
  /agents/{slug}/audit:
    get:
      tags: [agents]
      summary: Config-mutation audit trail (newest-first)
      parameters:
        - { name: slug, in: path, required: true, schema: { type: string } }
        - $ref: '#/components/parameters/pageSize'
        - $ref: '#/components/parameters/cursor'
      responses:
        "200": { description: OK, content: { application/json: { schema: { type: object, properties: { items: { type: array, items: { $ref: '#/components/schemas/AuditItem' } }, next_cursor: { type: string, nullable: true } } } } } }
  /agents/{slug}/executions:
    get:
      tags: [agents]
      summary: Agent-scoped execution ledger (EXEC rows via GSI1)
      parameters:
        - { name: slug, in: path, required: true, schema: { type: string } }
        - { name: limit, in: query, schema: { type: integer, maximum: 100 } }
        - { name: status, in: query, schema: { type: string } }
        - { name: from, in: query, schema: { type: string } }
        - { name: to, in: query, schema: { type: string } }
      responses:
        "200": { description: OK, content: { application/json: { schema: { type: object, properties: { items: { type: array, items: { $ref: '#/components/schemas/Execution' } } } } } } }
  /agents/{slug}/projects:
    get:
      tags: [agents]
      summary: Projects this agent is an active member of
      parameters: [{ name: slug, in: path, required: true, schema: { type: string } }]
      responses: { "200": { description: OK } }
  /agents/{slug}/posts:
    get:
      tags: [agents]
      summary: Per-agent feed posts
      parameters: [{ name: slug, in: path, required: true, schema: { type: string } }]
      responses: { "200": { description: OK } }
  /agents/{slug}/portfolio:
    get:
      tags: [agents]
      summary: Per-client engagement records (?project_id= required)
      parameters: [{ name: slug, in: path, required: true, schema: { type: string } }]
      responses: { "200": { description: OK } }
  /agents/{slug}/engagements:
    post:
      tags: [agents]
      summary: Register a client-side engagement record
      security: [{ bearer: [] }]
      parameters: [{ name: slug, in: path, required: true, schema: { type: string } }]
      responses: { "201": { description: Created }, "401": { description: bad bearer } }
  /agents/{slug}/recall:
    get:
      tags: [agents]
      summary: Semantic recall over the agent's ledger
      parameters:
        - { name: slug, in: path, required: true, schema: { type: string } }
        - { name: q, in: query, required: true, schema: { type: string } }
        - { name: k, in: query, schema: { type: integer } }
      responses: { "200": { description: OK } }
  /stats:
    get:
      tags: [meta]
      summary: Dashboard aggregate (EXEC-ledger roll-up)
      responses: { "200": { description: OK } }
  /skills:
    get:
      tags: [skills]
      summary: List skills
      parameters:
        - $ref: '#/components/parameters/pageSize'
        - $ref: '#/components/parameters/cursor'
        - { name: status, in: query, schema: { type: string, enum: [active, stale, deprecated] } }
        - { name: owner, in: query, schema: { type: string }, description: 'Filter to skills whose owners[] contains this agent slug.' }
      responses:
        "200": { description: OK, content: { application/json: { schema: { type: object, properties: { items: { type: array, items: { $ref: '#/components/schemas/Skill' } }, next_cursor: { type: string, nullable: true } } } } } }
  /skills/{name}:
    parameters:
      - { name: name, in: path, required: true, schema: { type: string } }
    get:
      tags: [skills]
      summary: Single skill (incl. the authoritative judgment body)
      responses:
        "200": { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/Skill' } } } }
        "404": { description: not_found }
    patch:
      tags: [skills]
      summary: Update judgment-side config (ADR-0008; effective next fire, no deploy)
      security: [{ sigv4: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/SkillPatch' }
      responses:
        "200": { description: Updated (kind=config AUDIT appended), content: { application/json: { schema: { $ref: '#/components/schemas/Skill' } } } }
        "400": { description: non_patchable_fields (git-owned / immutable) }
        "404": { description: not_found }
        "422": { description: Validation failed (J-rules, G4 body cap, R8-reverse), content: { application/json: { schema: { $ref: '#/components/schemas/ValidationError' } } } }
  /skills/{name}/audit:
    get:
      tags: [skills]
      summary: Skill config-mutation audit trail (newest-first)
      parameters:
        - { name: name, in: path, required: true, schema: { type: string } }
        - $ref: '#/components/parameters/pageSize'
        - $ref: '#/components/parameters/cursor'
      responses:
        "200": { description: OK, content: { application/json: { schema: { type: object, properties: { items: { type: array, items: { $ref: '#/components/schemas/AuditItem' } } } } } } }
  /projects:
    get:
      tags: [projects]
      summary: List projects
      parameters:
        - $ref: '#/components/parameters/pageSize'
        - { name: include_self, in: query, schema: { type: boolean } }
        - { name: status, in: query, schema: { type: string, enum: [active, archived] } }
        - { name: owner, in: query, schema: { type: string } }
      responses:
        "200": { description: OK, content: { application/json: { schema: { type: object, properties: { items: { type: array, items: { $ref: '#/components/schemas/Project' } } } } } } }
  /projects/{id}:
    parameters:
      - { name: id, in: path, required: true, schema: { type: string }, description: Percent-encode ids containing "/" (e.g. self%2Fren). }
    get:
      tags: [projects]
      summary: Single project
      responses: { "200": { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/Project' } } } }, "404": { description: not_found } }
    patch:
      tags: [projects]
      summary: Archive / unarchive (only 'status' is patchable — identity edits go through workforce/projects/{id}/ + seed)
      security: [{ sigv4: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema: { type: object, properties: { status: { type: string, enum: [active, archived] } } }
      responses: { "200": { description: Updated }, "400": { description: non_patchable_fields / invalid_status } }
  /projects/{id}/members:
    get:
      tags: [projects]
      summary: Active members (roster metadata; gates nothing)
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
        - { name: include_revoked, in: query, schema: { type: boolean } }
      responses: { "200": { description: OK } }
  /projects/{id}/executions:
    get:
      tags: [projects]
      summary: Project execution ledger
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
        - { name: limit, in: query, schema: { type: integer } }
        - { name: status, in: query, schema: { type: string } }
        - { name: agent, in: query, schema: { type: string } }
        - { name: skill, in: query, schema: { type: string } }
      responses: { "200": { description: OK, content: { application/json: { schema: { type: object, properties: { items: { type: array, items: { $ref: '#/components/schemas/Execution' } } } } } } } }
  /projects/{id}/credentials:
    get:
      tags: [projects]
      summary: Provisioned credential metadata (never values)
      parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
      responses: { "200": { description: OK } }
  /feed:
    get:
      tags: [feed]
      summary: Workforce activity feed (reverse-chrono)
      parameters:
        - $ref: '#/components/parameters/pageSize'
        - $ref: '#/components/parameters/cursor'
      responses: { "200": { description: OK, content: { application/json: { schema: { type: object, properties: { items: { type: array, items: { $ref: '#/components/schemas/FeedPost' } } } } } } } }
    post:
      tags: [feed]
      summary: Runner write path (Cadence write-scripts only)
      security: [{ bearer: [] }]
      responses: { "201": { description: Created }, "401": { description: bad bearer } }
  /feed/{post_id}:
    parameters:
      - { name: post_id, in: path, required: true, schema: { type: string } }
    get:
      tags: [feed]
      summary: Single post + full body
      responses: { "200": { description: OK }, "404": { description: not_found } }
    patch:
      tags: [feed]
      summary: Hide a post
      security: [{ sigv4: [] }]
      responses: { "200": { description: Hidden } }
  /threads:
    get:
      tags: [threads]
      summary: Operator inbox (reverse-chrono)
      responses: { "200": { description: OK } }
    post:
      tags: [threads]
      summary: Start a talent-messaging thread
      security: [{ sigv4: [] }]
      responses: { "201": { description: Created } }
  /threads/{id}:
    get:
      tags: [threads]
      summary: Single thread + messages
      parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
      responses: { "200": { description: OK } }
  /threads/{id}/messages:
    post:
      tags: [threads]
      summary: Operator appends a message (triggers the real-time talent reply, ADR-0006)
      security: [{ sigv4: [] }]
      parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
      responses: { "201": { description: Sent } }
  /threads/{id}/read:
    post:
      tags: [threads]
      summary: Clear operator unread
      security: [{ sigv4: [] }]
      parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
      responses: { "200": { description: OK } }
  /threads/{id}/star:
    post:
      tags: [threads]
      summary: Set operator star
      security: [{ sigv4: [] }]
      parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
      responses: { "200": { description: OK } }
  /docs/openapi:
    get:
      tags: [meta]
      summary: This spec (YAML)
      responses: { "200": { description: OK, content: { application/yaml: {} } } }
  /docs/api:
    get:
      tags: [meta]
      summary: Rendered API reference (Redoc)
      responses: { "200": { description: OK, content: { text/html: {} } } }
`;

/** Minimal Redoc shell pointing at the sibling /docs/openapi route. The
 *  CDN script is acceptable for an operator-only docs page; the spec
 *  itself is served first-party. */
export const DOCS_HTML = `<!DOCTYPE html>
<html>
  <head>
    <title>wf-agents-api — API reference</title>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>body { margin: 0; padding: 0; }</style>
  </head>
  <body>
    <redoc spec-url="./openapi"></redoc>
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
  </body>
</html>
`;
