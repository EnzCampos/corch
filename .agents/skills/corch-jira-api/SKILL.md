---
name: corch-jira-api
description: Perform explicitly authorized Jira REST operations using project configuration and runtime credentials when a permitted role needs an API adapter.
---

# Jira API adapter

Use this adapter when Jira is the selected external scrum provider or publication
destination. It supplements the assigned role without taking over its decisions.
Resolve its origin/project from `.agents/workflow.json.scrum`, `workItem.scrum`,
the selected item, or runtime `JIRA_BASE_URL` / `JIRA_PROJECT_KEY`. Obtain account,
token, cloud, and board identifiers from the user's configured secret provider or
runtime environment. Never embed account emails, tokens, tenant IDs, or board IDs
in the skill or a committed configuration.

Prefer a connected Jira tool when available. Normal Refinement requires an
external scrum provider; Jira is one supported choice. This adapter does not
authorize mutations. If selected Jira access is unavailable, report the blocker
without silently substituting a local backlog.

Before a write, resolve the exact issues and verify existing user authorization.
Search narrowly for duplicates before creating issues. Use the site's supported
Jira REST endpoints and discover its issue types, transitions, board IDs, and
parent relationship fields instead of assuming project-specific values.

For API-token authentication, read `JIRA_EMAIL` and `JIRA_API_TOKEN` at runtime
and construct the authorization header in memory. Keep credentials out of command
arguments, output, logs, and artifacts. Do not pass authenticated responses to a
public report without reviewing their content.

Keep batch changes within the requested scope and the endpoint's documented
limits. After writes, re-query only affected fields or board membership. On an
ambiguous result, inspect the existing issue or operation before retrying; do not
create duplicate issues, comments, or links. Report the verified result and any
unresolved operation.
