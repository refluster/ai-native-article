# Builds the wf-agent-runner Lambda. Bundles handler.ts with esbuild
# AND copies workforce/agents/** so the runner can read each persona's
# system.md at runtime. Same shape as seed-agents/Makefile.
#
# CWD when SAM invokes this is workforce/lambdas/agent-runner.

build-WfAgentRunnerFunction:
	../node_modules/.bin/esbuild handler.ts \
		--bundle \
		--platform=node \
		--target=node24 \
		--format=esm \
		--external:@aws-sdk/* \
		--outfile=$(ARTIFACTS_DIR)/handler.mjs
	mkdir -p $(ARTIFACTS_DIR)/agents
	cp -R ../../agents/. $(ARTIFACTS_DIR)/agents/
