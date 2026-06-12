# Builds the wf-messaging-reply Lambda artefact via esbuild. Pure code —
# the persona is read from the AGENT#{slug}/META row (ADR-0007); the
# agents-tree bundle copy retired with step 6b.
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
