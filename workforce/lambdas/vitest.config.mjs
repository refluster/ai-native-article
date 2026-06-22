// Vitest discovery config for workforce/lambdas/.
//
// We name test files `*-tests.ts` instead of vitest's default `*.test.ts`
// so the workforce naming lint (R-N7 / `workforce/scripts/validate-naming.mjs`,
// regex KEBAB_TS = /^[a-z][a-z0-9-]*\.ts$/) is satisfied without
// loosening the convention to allow dotted segments. The trade-off is
// this config file — small, local, mechanical.

export default {
  test: {
    // Also picks up skill-handler tests living alongside their source
    // (workforce/skills/{name}/*-tests.ts) and pipeline-script tests
    // (workforce/scripts/{name}-tests.ts). Adding a new skill or script that
    // wants tests = drop a sibling -tests.ts; no test-config edit.
    include: ["**/*-tests.ts", "../skills/**/*-tests.ts", "../scripts/**/*-tests.ts"],
    exclude: ["node_modules/**", "dist/**", ".aws-sam/**"],
  },
};
