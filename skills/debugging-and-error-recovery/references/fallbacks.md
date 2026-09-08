# Safe Fallback Patterns

Under time pressure, prefer a degraded-but-honest path over a crash. These are
stopgaps: they keep the system usable while the root cause is being fixed, and they
are never a substitute for step 4 of the triage checklist.

## Warned default instead of a crash

```typescript
function getConfig(key: string): string {
  const value = process.env[key];
  if (!value) {
    console.warn(`Missing config: ${key}, using default`);
    return DEFAULTS[key] ?? '';
  }
  return value;
}
```

The warning matters as much as the default. A silent fallback hides the failure and
turns a loud bug into a slow one.

## Graceful degradation instead of a broken feature

```typescript
function renderChart(data: ChartData[]) {
  if (data.length === 0) {
    return <EmptyState message="No data available for this period" />;
  }
  try {
    return <Chart data={data} />;
  } catch (error) {
    console.error('Chart render failed:', error);
    return <ErrorState message="Unable to display chart" />;
  }
}
```

The empty case and the failure case are different states and should read differently
to the user. Collapsing them makes the failure invisible.

## When not to use a fallback

- The value is required for correctness (a key, an identity, a balance). Fail loudly.
- The fallback would silently produce wrong output that downstream code trusts.
- You are using it to avoid diagnosing a failure you can reproduce right now.
