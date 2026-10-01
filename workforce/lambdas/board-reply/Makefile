# Builds the wf-board-reply Lambda artefact via esbuild, then assembles the
# public knowledge pack next to it (ADR-0034 §Decision 3): the handler
# reads `board-knowledge.md` from its own directory at cold start, so the
# pack is refreshed on every data-plane deploy and never committed.
#
# CWD when SAM invokes this is workforce/lambdas/board-reply (CodeUri).
# Dependencies come from the shared workforce/lambdas/node_modules — the
# operator runs `cd workforce/lambdas && npm ci` before `sam build`. The
# pack builder is dependency-free Node (no npm install needed).

build-WfBoardReplyFunction:
	../node_modules/.bin/esbuild handler.ts \
		--bundle \
		--platform=node \
		--target=node24 \
		--format=esm \
		--external:@aws-sdk/* \
		--outfile=$(ARTIFACTS_DIR)/handler.mjs
	node ../../scripts/build-board-knowledge.mjs --out $(ARTIFACTS_DIR)/board-knowledge.md
