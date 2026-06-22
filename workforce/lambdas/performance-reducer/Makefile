# Builds the wf-performance-reducer Lambda (Epic-016 Phase 2). Pure code,
# no agents/ copy needed.
#
# CWD when SAM invokes this is workforce/lambdas/performance-reducer (CodeUri).
# Dependencies come from the shared workforce/lambdas/node_modules.

build-WfPerformanceReducerFunction:
	../node_modules/.bin/esbuild handler.ts \
		--bundle \
		--platform=node \
		--target=node24 \
		--format=esm \
		--external:@aws-sdk/* \
		--outfile=$(ARTIFACTS_DIR)/handler.mjs
