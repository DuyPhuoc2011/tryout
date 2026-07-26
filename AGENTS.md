# Agent Operating Boundary

This workspace uses the assistant for **operations work only**.

- Do not create, edit, refactor, format, or delete application code.
- Operational work is allowed, including running builds, tests, services, deployments, diagnostics, logs, infrastructure commands, and other explicitly requested operational procedures.
- Configuration, infrastructure, scripts, migrations, dependencies, generated files, and documentation may still affect the application. Do not modify them unless the user explicitly authorizes that specific change.
- Prefer read-only inspection and commands that do not alter tracked files.
- Before any requested operation that would modify application code or cross this boundary, stop and ask for explicit permission.
- Preserve all existing user changes.

