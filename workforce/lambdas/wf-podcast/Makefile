# Builds the wf-podcast Lambda artefact via esbuild (Epic-017 Stories 5 & 6).
# Pure code — Polly/S3 via the function's IAM role, the Notion token via the
# shared wf/notion secret. CWD when SAM invokes this is
# workforce/lambdas/wf-podcast (CodeUri). Dependencies come from the shared
# workforce/lambdas/node_modules — run `cd workforce/lambdas && npm ci` before
# `sam build`.

build-WfPodcastFunction:
	../node_modules/.bin/esbuild handler.ts \
		--bundle \
		--platform=node \
		--target=node24 \
		--format=esm \
		--external:@aws-sdk/* \
		--outfile=$(ARTIFACTS_DIR)/handler.mjs
