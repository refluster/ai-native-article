# Builds the wf-l1-source-register Lambda. Pure code, no agents/ copy needed.
#
# CWD when SAM invokes this is workforce/lambdas/l1-source-register (CodeUri).
# Dependencies come from the shared workforce/lambdas/node_modules.

build-WfL1SourceRegisterFunction:
	../node_modules/.bin/esbuild handler.ts \
		--bundle \
		--platform=node \
		--target=node24 \
		--format=esm \
		--external:@aws-sdk/* \
		--outfile=$(ARTIFACTS_DIR)/handler.mjs
