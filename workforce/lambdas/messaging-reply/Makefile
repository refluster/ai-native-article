# Builds the wf-messaging-reply Lambda artefact via esbuild AND copies the
# workforce/agents/** tree into the artefact so the handler can read each
# talent's system.md (persona) at runtime — same bundling pattern as
# wf-seed-agents.
#
# CWD when SAM invokes this is workforce/lambdas/messaging-reply (CodeUri).
# Dependencies come from the shared workforce/lambdas/node_modules — the
# operator runs `cd workforce/lambdas && npm ci` before `sam build`.

build-WfMessagingReplyFunction:
	../node_modules/.bin/esbuild handler.ts \
		--bundle \
		--platform=node \
		--target=node24 \
		--format=esm \
		--external:@aws-sdk/* \
		--outfile=$(ARTIFACTS_DIR)/handler.mjs
	mkdir -p $(ARTIFACTS_DIR)/agents
	cp -R ../../agents/. $(ARTIFACTS_DIR)/agents/
