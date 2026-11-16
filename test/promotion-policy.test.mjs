import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm, mkdtemp } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  loadPromotionPolicy,
  validatePromotionPolicy,
  resolvePromotionPolicyPath,
  REPO_POLICY_PATH,
  POLICY_CATEGORIES,
} from '../lib/promotion-policy.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('promotion-policy', () => {
  const validPolicy = {
    automatic: ['kanban_events'],
    explicit: ['share_true'],
    threshold: { concept_mention_count: 10, decision_confidence: 0.95 },
    manual_review: ['everything_else'],
  };

  describe('loadPromotionPolicy', () => {
    it('loads and validates the default config file', async () => {
      const policy = await loadPromotionPolicy(REPO_POLICY_PATH);
      assert.deepStrictEqual(policy.automatic, ['kanban_events']);
      assert.deepStrictEqual(policy.explicit, ['share_true']);
      assert.strictEqual(policy.threshold.concept_mention_count, 10);
      assert.strictEqual(policy.threshold.decision_confidence, 0.95);
      assert.deepStrictEqual(policy.manual_review, ['everything_else']);
    });

    it('rejects a missing file', async () => {
      await assert.rejects(
        () => loadPromotionPolicy('/nonexistent/path/policy.yaml'),
        { code: 'ENOENT' }
      );
    });

    it('loads a custom config path', async () => {
      const tmpDir = join(tmpdir(), `promo-policy-test-${Date.now()}`);
      await mkdir(tmpDir, { recursive: true });
      const customPath = join(tmpDir, 'custom-policy.yaml');
      const yaml = [
        'automatic:',
        '  - kanban_events',
        'explicit:',
        '  - share_true',
        'threshold:',
        '  concept_mention_count: 20',
        '  decision_confidence: 0.99',
        'manual_review:',
        '  - everything_else',
      ].join('\n');
      await writeFile(customPath, yaml, 'utf8');
      try {
        const policy = await loadPromotionPolicy(customPath);
        assert.strictEqual(policy.threshold.concept_mention_count, 20);
        assert.strictEqual(policy.threshold.decision_confidence, 0.99);
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('validatePromotionPolicy', () => {
    it('accepts a valid policy object', () => {
      const result = validatePromotionPolicy(validPolicy);
      assert.deepStrictEqual(result, validPolicy);
    });

    it('rejects null input', () => {
      assert.throws(() => validatePromotionPolicy(null), /non-null object/);
    });

    it('rejects missing required category', () => {
      const { threshold, ...partial } = validPolicy;
      assert.throws(
        () => validatePromotionPolicy(partial),
        /Missing required policy category: threshold/
      );
    });

    it('rejects unknown top-level key', () => {
      assert.throws(
        () => validatePromotionPolicy({ ...validPolicy, unknown_key: [] }),
        /Unknown policy category: unknown_key/
      );
    });

    it('rejects non-numeric threshold value', () => {
      assert.throws(
        () => validatePromotionPolicy({
          ...validPolicy,
          threshold: { concept_mention_count: 'five', decision_confidence: 0.95 },
        }),
        /must be a number/
      );
    });

    it('rejects unknown threshold key', () => {
      assert.throws(
        () => validatePromotionPolicy({
          ...validPolicy,
          threshold: { concept_mention_count: 10, decision_confidence: 0.95, unknown_threshold: 5 },
        }),
        /Unknown threshold key: unknown_threshold/
      );
    });
  });

  // A deployed lib/ (~/.openclaw/workspace/lib) has no config/ beside it: the
  // lib-relative default was ENOENT everywhere but a repo checkout.
  describe('resolvePromotionPolicyPath', () => {
    it('prefers $PROMOTION_POLICY, then ~/.openclaw/config, then the repo copy', async () => {
      const home = await mkdtemp(join(tmpdir(), 'promo-home-'));
      try {
        assert.equal(resolvePromotionPolicyPath({ env: {}, home }), REPO_POLICY_PATH);
        const nodePath = join(home, '.openclaw', 'config', 'promotion-policy.yaml');
        await mkdir(dirname(nodePath), { recursive: true });
        await writeFile(nodePath, readFileSync(REPO_POLICY_PATH));
        assert.equal(resolvePromotionPolicyPath({ env: {}, home }), nodePath);
        assert.equal(resolvePromotionPolicyPath({ env: { PROMOTION_POLICY: '/x/p.yaml' }, home }), '/x/p.yaml');
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    });

    it('the installer puts the policy where the resolver looks', () => {
      const config = readFileSync(join(ROOT, 'scripts/install/config.sh'), 'utf8');
      assert.match(config, /generate_config "\$REPO_DIR\/config\/promotion-policy\.yaml" "\$OPENCLAW_ROOT\/config\/promotion-policy\.yaml"/);
    });
  });

  describe('constants', () => {
    it('REPO_POLICY_PATH ends with config/promotion-policy.yaml', () => {
      assert.ok(REPO_POLICY_PATH.endsWith('config/promotion-policy.yaml'));
    });

    it('POLICY_CATEGORIES contains all four categories', () => {
      assert.deepStrictEqual(
        POLICY_CATEGORIES,
        ['automatic', 'explicit', 'threshold', 'manual_review']
      );
    });
  });
});
