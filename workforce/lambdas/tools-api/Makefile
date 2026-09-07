# Builds the wf-tools-api Lambda artefact via esbuild. Mirrors
# workforce/lambdas/agents-api/Makefile.
#
# CWD when SAM invokes this is workforce/lambdas/tools-api
# (CodeUri). Dependencies come from the shared workforce/lambdas/
# node_modules.

build-WfToolsApiFunction:
	../node_modules/.bin/esbuild handler.ts \
		--bundle \
		--platform=node \
		--target=node24 \
		--format=esm \
		--external:@aws-sdk/* \
		--outfile=$(ARTIFACTS_DIR)/handler.mjs
