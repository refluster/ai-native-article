# Builds the wf-seed-skills Lambda. Mirror of seed-agents/Makefile but
# copies workforce/skills/** into the bundle instead.
#
# CWD when SAM invokes this is workforce/lambdas/seed-skills.

build-WfSeedSkillsFunction:
	../node_modules/.bin/esbuild handler.ts \
		--bundle \
		--platform=node \
		--target=node24 \
		--format=esm \
		--external:@aws-sdk/* \
		--outfile=$(ARTIFACTS_DIR)/handler.mjs
	mkdir -p $(ARTIFACTS_DIR)/skills
	cp -R ../../skills/. $(ARTIFACTS_DIR)/skills/
