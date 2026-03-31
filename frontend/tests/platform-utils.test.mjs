import test from "node:test";
import assert from "node:assert/strict";

import {
  applyAlertsFilter,
  applyRunsFilter,
  buildGrafanaHref,
  buildQueryString,
  normalizeAlertsQuery,
  normalizeRunsQuery,
} from "../public/platform-utils.js";

test("normalizeRunsQuery should sanitize enum and pagination", () => {
  const query = normalizeRunsQuery({
    engineType: "Spark",
    runStatus: "FAILED",
    slaTier: "gold",
    queueName: " prod ",
    page: "0",
    pageSize: "500",
  });

  assert.deepEqual(query, {
    engineType: "spark",
    runStatus: "failed",
    slaTier: "gold",
    queueName: "prod",
    page: 1,
    pageSize: 200,
  });
});

test("normalizeAlertsQuery should reject unknown enums", () => {
  const query = normalizeAlertsQuery({
    alertSeverity: "P9",
    runStatus: "running",
    page: "2",
    pageSize: "20",
  });

  assert.deepEqual(query, {
    alertSeverity: "",
    runStatus: "running",
    page: 2,
    pageSize: 20,
  });
});

test("buildQueryString should ignore empty values", () => {
  const queryString = buildQueryString({
    runStatus: "failed",
    queueName: "",
    page: 2,
    pageSize: 20,
  });

  assert.equal(queryString, "runStatus=failed&page=2&pageSize=20");
});

test("buildGrafanaHref should compose panel and vars", () => {
  const href = buildGrafanaHref("https://grafana.example.com", {
    grafanaDashboardUid: "ops-runtime",
    grafanaPanelId: 7,
    grafanaFrom: "now-30m",
    grafanaTo: "now",
    grafanaVars: {
      queue: "prod-realtime",
      engineType: "flink",
    },
  });

  assert.equal(
    href,
    "https://grafana.example.com/d/ops-runtime?viewPanel=7&from=now-30m&to=now&var-queue=prod-realtime&var-engineType=flink",
  );
});

test("applyRunsFilter should return filtered and paginated items", () => {
  const result = applyRunsFilter(
    [
      { runId: "r1", engineType: "spark", runStatus: "running", slaTier: "gold", queueName: "prod-realtime" },
      { runId: "r2", engineType: "flink", runStatus: "failed", slaTier: "silver", queueName: "batch-nightly" },
    ],
    { engineType: "flink", page: 1, pageSize: 10 },
  );

  assert.equal(result.total, 1);
  assert.equal(result.items[0].runId, "r2");
});

test("applyAlertsFilter should match runStatus from relatedRunStatus", () => {
  const result = applyAlertsFilter(
    [
      { alertId: "a1", alertSeverity: "p1", relatedRunStatus: "failed" },
      { alertId: "a2", alertSeverity: "p2", relatedRunStatus: "running" },
    ],
    { runStatus: "failed", page: 1, pageSize: 10 },
  );

  assert.equal(result.total, 1);
  assert.equal(result.items[0].alertId, "a1");
});
