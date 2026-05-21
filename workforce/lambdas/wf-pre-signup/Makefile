# Builds the wf-pre-signup Lambda artefact via esbuild.
#
# CWD when SAM invokes this is workforce/lambdas/wf-pre-signup (CodeUri).
# Dependencies come from the shared workforce/lambdas/node_modules — the
# operator runs `cd workforce/lambdas && npm ci` before `sam build`.
#
# Emitting handler.mjs (not .js) is what gives Node ESM resolution at
# runtime. SAM InlineCode can't produce .mjs, so this directory-shaped
# CodeUri is the path to keeping export-style ESM in the source.

build-PreSignUpFn:
	../node_modules/.bin/esbuild handler.ts \
		--bundle \
		--platform=node \
		--target=node24 \
		--format=esm \
		--external:@aws-sdk/* \
		--outfile=$(ARTIFACTS_DIR)/handler.mjs
