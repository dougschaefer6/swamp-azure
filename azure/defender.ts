import { z } from "npm:zod@4.3.6";
import { az, AzureGlobalArgsSchema, sanitizeInstanceName } from "./_helpers.ts";

const PricingSchema = z
  .object({
    name: z.string(),
    pricingTier: z.string().optional(),
    subPlan: z.string().nullish(),
    freeTrialRemainingTime: z.string().nullish(),
  })
  .passthrough();

const SecureScoreSchema = z
  .object({
    name: z.string(),
    displayName: z.string().nullish(),
    current: z.number().optional(),
    max: z.number().optional(),
    percentage: z.number().optional(),
    weight: z.number().optional(),
  })
  .passthrough();

const AssessmentSchema = z
  .object({
    name: z.string(),
    displayName: z.string().nullish(),
    status: z.record(z.string(), z.unknown()).nullish(),
    resourceDetails: z.record(z.string(), z.unknown()).nullish(),
  })
  .passthrough();

const AlertSchema = z
  .object({
    name: z.string(),
    alertDisplayName: z.string().nullish(),
    severity: z.string().nullish(),
    status: z.string().nullish(),
    timeGeneratedUtc: z.string().nullish(),
    description: z.string().nullish(),
  })
  .passthrough();

/**
 * `@dougschaefer/azure-defender` model — Microsoft Defender for Cloud
 * posture and detections, wrapping the `az security` CLI. listPricing
 * reports which Defender plans are enabled (Free vs Standard) per
 * resource type and setPricing toggles a plan. listSecureScores and
 * listSecureScoreControls read the secure-score rollup and its
 * per-control breakdown. listAssessments enumerates security
 * recommendations and their healthy/unhealthy status; listAlerts
 * reads active security alerts (detections) with severity and state.
 * setPricing changes billing and protection coverage — moving a plan
 * to Standard enables paid Defender protections — so confirm intent
 * before running it.
 */
export const model = {
  type: "@dougschaefer/azure-defender",
  version: "2026.07.24.3",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    pricing: {
      description: "Defender for Cloud plan (pricing tier) per resource type",
      schema: PricingSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    secureScore: {
      description: "Defender for Cloud secure score",
      schema: SecureScoreSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    assessment: {
      description: "Defender for Cloud security assessment (recommendation)",
      schema: AssessmentSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    alert: {
      description: "Defender for Cloud security alert (detection)",
      schema: AlertSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    listPricing: {
      description:
        "List Defender for Cloud plans (Free/Standard) per resource type.",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;
        const result = (await az(
          ["security", "pricing", "list"],
          g.subscriptionId,
        )) as Record<string, unknown>;
        const pricings = ((result?.value ?? result) as Array<
          Record<string, unknown>
        >) ?? [];

        context.logger.info("Found {count} Defender plans", {
          count: pricings.length,
        });

        const handles = [];
        for (const p of pricings) {
          const handle = await context.writeResource(
            "pricing",
            sanitizeInstanceName(p.name as string),
            p,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    setPricing: {
      description:
        "Set a Defender plan's tier (Free or Standard) for a resource type.",
      arguments: z.object({
        name: z
          .string()
          .describe(
            "Plan name, e.g. VirtualMachines, StorageAccounts, KeyVaults",
          ),
        tier: z
          .enum(["Free", "Standard"])
          .describe("Standard enables paid Defender protections"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const pricing = (await az(
          [
            "security",
            "pricing",
            "create",
            "--name",
            args.name,
            "--tier",
            args.tier,
          ],
          g.subscriptionId,
        )) as Record<string, unknown>;

        context.logger.info("Set Defender plan {name} to {tier}", {
          name: args.name,
          tier: args.tier,
        });

        const handle = await context.writeResource(
          "pricing",
          sanitizeInstanceName(args.name),
          pricing,
        );
        return { dataHandles: [handle] };
      },
    },

    listSecureScores: {
      description: "List Defender for Cloud secure scores.",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;
        const scores = (await az(
          ["security", "secure-scores", "list"],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} secure scores", {
          count: scores.length,
        });

        const handles = [];
        for (const s of scores) {
          const handle = await context.writeResource(
            "secureScore",
            sanitizeInstanceName(s.name as string),
            s,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    listSecureScoreControls: {
      description: "List the per-control breakdown behind the secure score.",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;
        const controls = (await az(
          ["security", "secure-score-controls", "list"],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} secure-score controls", {
          count: controls.length,
        });

        const handles = [];
        for (const c of controls) {
          const handle = await context.writeResource(
            "secureScore",
            sanitizeInstanceName(c.name as string),
            c,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    listAssessments: {
      description:
        "List Defender for Cloud security assessments (recommendations).",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;
        const assessments = (await az(
          ["security", "assessment", "list"],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} security assessments", {
          count: assessments.length,
        });

        const handles = [];
        for (const a of assessments) {
          const handle = await context.writeResource(
            "assessment",
            sanitizeInstanceName(a.name as string),
            a,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    listAlerts: {
      description: "List active Defender for Cloud security alerts.",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;
        const alerts = (await az(
          ["security", "alert", "list"],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} security alerts", {
          count: alerts.length,
        });

        const handles = [];
        for (const a of alerts) {
          const handle = await context.writeResource(
            "alert",
            sanitizeInstanceName(a.name as string),
            a,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },
  },

  checks: {
    "subscription-accessible": {
      description:
        "Verify the target subscription is reachable from the active az session before changing Defender pricing.",
      labels: ["live"],
      appliesTo: ["setPricing"],
      execute: async (context) => {
        const g = context.globalArgs;
        try {
          await az(["account", "show"], g.subscriptionId);
          return { pass: true };
        } catch (err) {
          return {
            pass: false,
            errors: [
              `Subscription ${g.subscriptionId} is not accessible from the active az session: ${
                String(err)
              }`,
            ],
          };
        }
      },
    },
  },
};
