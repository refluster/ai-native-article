# Builds the wf-migrate-credentials Lambda. Pure code, no agents/ copy
# needed. Mirrors workforce/lambdas/backfill-tasks/Makefile.
#
# CWD when SAM invokes this is workforce/lambdas/migrate-credentials
# (CodeUri). Dependencies come from the shared workforce/lambdas/
# node_modules.

build-WfMigrateCredentialsFunction:
	../node_modules/.bin/esbuild handler.ts \
		--bundle \
		--platform=node \
		--target=node24 \
		--format=esm \
		--external:@aws-sdk/* \
		--outfile=$(ARTIFACTS_DIR)/handler.mjs
