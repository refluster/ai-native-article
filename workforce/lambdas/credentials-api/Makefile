# Builds the wf-credentials-api Lambda artefact via esbuild. Mirrors
# workforce/lambdas/agents-api/Makefile.
#
# CWD when SAM invokes this is workforce/lambdas/credentials-api
# (CodeUri). Dependencies come from the shared workforce/lambdas/
# node_modules.

build-WfCredentialsApiFunction:
	../node_modules/.bin/esbuild handler.ts \
		--bundle \
		--platform=node \
		--target=node24 \
		--format=esm \
		--external:@aws-sdk/* \
		--outfile=$(ARTIFACTS_DIR)/handler.mjs
