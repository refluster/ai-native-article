# Builds the wf-orchestrator Lambda. Pure code, no agents/ copy needed
# — the orchestrator reads from DDB, not filesystem.
#
# CWD when SAM invokes this is workforce/lambdas/orchestrator.

build-WfOrchestratorFunction:
	../node_modules/.bin/esbuild handler.ts \
		--bundle \
		--platform=node \
		--target=node24 \
		--format=esm \
		--external:@aws-sdk/* \
		--outfile=$(ARTIFACTS_DIR)/handler.mjs
