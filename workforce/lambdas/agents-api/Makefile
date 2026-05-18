# Builds the wf-agents-api Lambda artefact via esbuild.
#
# CWD when SAM invokes this is workforce/lambdas/agents-api (CodeUri).
# Dependencies come from the shared workforce/lambdas/node_modules — the
# operator runs `cd workforce/lambdas && npm ci` before `sam build`.
# The shared install pattern (instead of one node_modules per function)
# keeps R-N8 data-shape uniformity at the build layer: same toolchain,
# one place to upgrade.

build-WfAgentsApiFunction:
	../node_modules/.bin/esbuild handler.ts \
		--bundle \
		--platform=node \
		--target=node24 \
		--format=esm \
		--external:@aws-sdk/* \
		--outfile=$(ARTIFACTS_DIR)/handler.mjs
