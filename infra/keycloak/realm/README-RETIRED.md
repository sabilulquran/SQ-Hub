# CI fixtures and historical identity configuration

HCIS/SQ Hub staging on the production VPS was permanently retired by owner decision on 2 October 2026. Production-only is the intended topology. Do not recreate, deploy, enable, or infer a requirement for staging from historical files, backups, Docker resources, workflows, or documentation. Reintroduction requires a new explicit owner decision and a new deployment plan.

`sq-staff-staging-realm.json` is retained only as a synthetic disposable-CI fixture. It is not copied into production images and must never be imported to production. Use only the localhost CI topology. Production realm/client source files retain their explicitly reviewed production purpose.
