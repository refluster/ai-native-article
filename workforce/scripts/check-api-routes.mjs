#!/usr/bin/env node
// check-api-routes.mjs — guard the ApiGatewayV2::Api drift blind spot.
//
// Why this exists
// ---------------
// CloudFormation drift detection does NOT compare the routes inside an
// `AWS::ApiGatewayV2::Api` resource's OpenAPI body. So a route can be
// missing from the LIVE api — because it was deleted out-of-band, or
// because it was silently dropped at import time (e.g. a greedy `{id+}`
// parent route conflicting with its `{id}/child` routes) — while
// CloudFormation still reports the stack `IN_SYNC`. That is exactly how
// `GET /projects/{id+}/members|executions|credentials` 404'd in prod with
// "no drift". `detect-stack-drift` cannot catch this class; this script can.
//
// What it does
// ------------
// For every `AWS::ApiGatewayV2::Api` in the stack, it compares the DESIRED
// route set (the CloudFormation *processed* template's Api body) against the
// LIVE route set (`apigatewayv2 get-routes`). Any desired route missing from
// live is a hard failure (C-4: fail loud). Live routes absent from the
// template are reported as a warning (out-of-band additions), not a failure.
//
// Usage
//   node workforce/scripts/check-api-routes.mjs [stack-name]
//   STACK=wf-data-plane-prod AWS_REGION=us-west-2 node workforce/scripts/check-api-routes.mjs
//
// Requires the `aws` CLI on PATH with credentials that can call
// cloudformation:GetTemplate, cloudformation:DescribeStackResource, and
// apigatewayv2:GetRoutes (the data-plane deploy role already has these).

import { execFileSync } from 'node:child_process';

const STACK = process.env.STACK || process.argv[2] || 'wf-data-plane-prod';
const REGION = process.env.AWS_REGION || process.env.REGION || 'us-west-2';

// OpenAPI operation keys that map to a real HTTP method/route. Anything else
// under a path item (`parameters`, `x-amazon-apigateway-*`, `summary`, …) is
// not a route and is skipped.
const METHOD_KEYS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'trace']);

function aws(args) {
  return execFileSync('aws', [...args, '--region', REGION, '--output', 'json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function routeKey(method, path) {
  return `${method.toUpperCase()} ${path}`;
}

// logicalId -> Set(routeKey) from the CloudFormation *processed* template.
function desiredRoutesByApi() {
  const tmpl = JSON.parse(
    aws(['cloudformation', 'get-template', '--stack-name', STACK, '--template-stage', 'Processed', '--query', 'TemplateBody']),
  );
  if (!tmpl || typeof tmpl !== 'object' || !tmpl.Resources) {
    throw new Error(
      `could not parse a resource map from the processed template of ${STACK} ` +
        `(got ${typeof tmpl}); refusing to report green without verifying`,
    );
  }
  const byApi = {};
  for (const [logicalId, res] of Object.entries(tmpl.Resources)) {
    if (res.Type !== 'AWS::ApiGatewayV2::Api') continue;
    const paths = res.Properties?.Body?.paths;
    if (!paths) {
      // An Api defined via discrete Route resources (no inline body) is not
      // subject to this blind spot — CloudFormation tracks those routes as
      // first-class resources. Record an empty set so it shows up as checked.
      byApi[logicalId] = new Set();
      continue;
    }
    const keys = new Set();
    for (const [path, item] of Object.entries(paths)) {
      for (const [method] of Object.entries(item)) {
        if (method === 'x-amazon-apigateway-any-method') {
          keys.add(routeKey('ANY', path));
        } else if (METHOD_KEYS.has(method.toLowerCase())) {
          keys.add(routeKey(method, path));
        }
      }
    }
    byApi[logicalId] = keys;
  }
  return byApi;
}

function physicalId(logicalId) {
  return JSON.parse(
    aws([
      'cloudformation',
      'describe-stack-resource',
      '--stack-name',
      STACK,
      '--logical-resource-id',
      logicalId,
      '--query',
      'StackResourceDetail.PhysicalResourceId',
    ]),
  );
}

function liveRoutes(apiId) {
  return new Set(JSON.parse(aws(['apigatewayv2', 'get-routes', '--api-id', apiId, '--query', 'Items[].RouteKey'])));
}

function main() {
  const desired = desiredRoutesByApi();
  const apis = Object.keys(desired);
  if (apis.length === 0) {
    console.error(`No AWS::ApiGatewayV2::Api resources found in ${STACK}; nothing to verify (treating as failure).`);
    process.exit(1);
  }

  const report = [`Route audit for stack ${STACK} (${REGION})`, ''];
  let failed = false;

  for (const logicalId of apis.sort()) {
    const want = desired[logicalId];
    const apiId = physicalId(logicalId);
    const live = liveRoutes(apiId);
    const missing = [...want].filter((r) => !live.has(r)).sort();
    const extra = [...live].filter((r) => !want.has(r) && r !== '$default').sort();

    report.push(`${logicalId} (${apiId}): desired=${want.size} live=${live.size}`);
    if (missing.length) {
      failed = true;
      report.push('  MISSING in live (CloudFormation desired but not deployed):');
      missing.forEach((r) => report.push(`    - ${r}`));
    }
    if (extra.length) {
      report.push('  EXTRA in live (out-of-band, not in the template):');
      extra.forEach((r) => report.push(`    - ${r}`));
    }
    if (!missing.length && !extra.length) report.push('  in sync');
    report.push('');
  }

  console.log(report.join('\n'));

  if (failed) {
    console.error(
      'FAIL: live HTTP API routes are missing relative to the CloudFormation desired body.\n' +
        'This is the route-drift class that ApiGatewayV2::Api drift detection cannot see.\n' +
        'Common cause: a greedy `{id+}` parent route silently dropping its `{id}/child` routes on import.',
    );
    process.exit(1);
  }
  console.log('OK: every desired route is present in every live HTTP API.');
}

main();
