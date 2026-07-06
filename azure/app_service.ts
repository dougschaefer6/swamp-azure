// Ported from https://github.com/rkcoleman/swamp-azure-app-service — MIT © Ryan Coleman

/**
 * `@dougschaefer/azure-app-service` model — Azure Web App
 * (Microsoft.Web/sites) lifecycle, wrapping `az webapp`. Covers the
 * full surface a Web App owner needs: CRUD (list/get/sync/create/
 * update/delete), power state (start/stop/restart), application
 * settings (list/set/delete), deployment slots (list/create/swap/
 * delete), custom domains (list/add/delete), and SSL certificate
 * lifecycle (list/upload/bind/unbind). For Function Apps use
 * `@dougschaefer/azure-function-app`; for the underlying compute see
 * `@dougschaefer/azure-app-service-plan`.
 *
 * @module
 */
import { z } from "npm:zod@4.3.6";
import {
  az,
  AzureGlobalArgsSchema,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const WebAppSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string().optional(),
    kind: z.string().optional(),
    state: z.string().optional(),
    defaultHostName: z.string().optional(),
    hostNames: z.array(z.string()).optional(),
    enabled: z.boolean().optional(),
    serverFarmId: z.string().optional(),
    httpsOnly: z.boolean().optional(),
    siteConfig: z.record(z.string(), z.unknown()).optional().nullable(),
    identity: z.record(z.string(), z.unknown()).optional().nullable(),
    tags: z.record(z.string(), z.string()).optional().nullable(),
  })
  .passthrough();

const SlotSchema = WebAppSchema;

const AppSettingsSchema = z
  .object({
    webapp: z.string(),
    settings: z.array(
      z
        .object({
          name: z.string(),
          value: z.string().optional(),
          slotSetting: z.boolean().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const HostnameBindingSchema = z
  .object({
    name: z.string(),
    hostName: z.string().optional(),
    sslState: z.string().optional(),
  })
  .passthrough();

const SslCertificateSchema = z
  .object({
    name: z.string(),
    thumbprint: z.string().optional(),
    subjectName: z.string().optional(),
    expirationDate: z.string().optional(),
  })
  .passthrough();

/** Swamp model for Azure Web App lifecycle. */
export const model = {
  type: "@dougschaefer/azure-app-service",
  version: "2026.07.06.1",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    webapp: {
      description: "Azure Web App",
      schema: WebAppSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    slot: {
      description: "Web App deployment slot",
      schema: SlotSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    appSettings: {
      description: "Web App application settings",
      schema: AppSettingsSchema,
      lifetime: "infinite",
      garbageCollection: 5,
    },
    hostnameBinding: {
      description: "Web App custom-domain hostname binding",
      schema: HostnameBindingSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    sslCertificate: {
      description: "Web App SSL certificate",
      schema: SslCertificateSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List all Web Apps in a resource group (or all in the subscription).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["webapp", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) cmdArgs.push("--resource-group", rg);

        const apps = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;
        context.logger.info("Found {count} Web Apps", { count: apps.length });

        const handles = [];
        for (const app of apps) {
          const handle = await context.writeResource(
            "webapp",
            sanitizeInstanceName(app.name as string),
            app,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single Web App.",
      arguments: z.object({
        name: z.string().describe("Web App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const app = await az(
          ["webapp", "show", "--name", args.name, "--resource-group", rg],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "webapp",
          sanitizeInstanceName(args.name),
          app,
        );
        return { dataHandles: [handle] };
      },
    },

    sync: {
      description: "Refresh the stored state of a Web App without changes.",
      arguments: z.object({
        name: z.string().describe("Web App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const app = await az(
          ["webapp", "show", "--name", args.name, "--resource-group", rg],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "webapp",
          sanitizeInstanceName(args.name),
          app,
        );
        context.logger.info("Synced Web App {name}", { name: args.name });
        return { dataHandles: [handle] };
      },
    },

    create: {
      description: "Create a Web App on an existing App Service Plan.",
      arguments: z.object({
        name: z
          .string()
          .describe(
            "Web App name (must be globally unique on azurewebsites.net)",
          ),
        resourceGroup: z.string().optional().describe("Resource group name"),
        plan: z.string().describe("App Service Plan name or resource ID"),
        runtime: z
          .string()
          .optional()
          .describe(
            "Runtime stack (e.g. 'NODE:20-lts', 'PYTHON:3.11', 'DOTNETCORE:8.0')",
          ),
        deploymentContainerImageName: z
          .string()
          .optional()
          .describe("Container image for Linux container Web App"),
        httpsOnly: z
          .boolean()
          .optional()
          .describe("Require HTTPS only"),
        tags: z
          .record(z.string(), z.string())
          .optional()
          .describe("Tags as key=value pairs"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "webapp",
          "create",
          "--name",
          args.name,
          "--resource-group",
          rg,
          "--plan",
          args.plan,
        ];
        if (args.runtime) cmdArgs.push("--runtime", args.runtime);
        if (args.deploymentContainerImageName) {
          cmdArgs.push(
            "--deployment-container-image-name",
            args.deploymentContainerImageName,
          );
        }
        if (args.httpsOnly !== undefined) {
          cmdArgs.push("--https-only", args.httpsOnly.toString());
        }
        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }

        await az(cmdArgs, g.subscriptionId);
        context.logger.info("Created Web App {name}", { name: args.name });

        const app = await az(
          ["webapp", "show", "--name", args.name, "--resource-group", rg],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "webapp",
          sanitizeInstanceName(args.name),
          app,
        );
        return { dataHandles: [handle] };
      },
    },

    update: {
      description:
        "Update a Web App — change httpsOnly, client affinity, tags, or other top-level properties.",
      arguments: z.object({
        name: z.string().describe("Web App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        httpsOnly: z
          .boolean()
          .optional()
          .describe("Require HTTPS only"),
        clientAffinityEnabled: z
          .boolean()
          .optional()
          .describe("Enable ARR affinity cookies"),
        tags: z
          .record(z.string(), z.string())
          .optional()
          .describe("Tags as key=value pairs"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "webapp",
          "update",
          "--name",
          args.name,
          "--resource-group",
          rg,
        ];
        if (args.httpsOnly !== undefined) {
          cmdArgs.push("--https-only", args.httpsOnly.toString());
        }
        if (args.clientAffinityEnabled !== undefined) {
          cmdArgs.push(
            "--client-affinity-enabled",
            args.clientAffinityEnabled.toString(),
          );
        }
        if (args.tags) {
          for (const [k, v] of Object.entries(args.tags)) {
            cmdArgs.push("--set", `tags.${k}=${v}`);
          }
        }

        await az(cmdArgs, g.subscriptionId);
        context.logger.info("Updated Web App {name}", { name: args.name });

        const app = await az(
          ["webapp", "show", "--name", args.name, "--resource-group", rg],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "webapp",
          sanitizeInstanceName(args.name),
          app,
        );
        return { dataHandles: [handle] };
      },
    },

    delete: {
      description: "Delete a Web App.",
      arguments: z.object({
        name: z.string().describe("Web App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          ["webapp", "delete", "--name", args.name, "--resource-group", rg],
          g.subscriptionId,
        );
        context.logger.info("Deleted Web App {name}", { name: args.name });
        return { dataHandles: [] };
      },
    },

    start: {
      description: "Start a stopped Web App.",
      arguments: z.object({
        name: z.string().describe("Web App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          ["webapp", "start", "--name", args.name, "--resource-group", rg],
          g.subscriptionId,
        );
        const app = await az(
          ["webapp", "show", "--name", args.name, "--resource-group", rg],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "webapp",
          sanitizeInstanceName(args.name),
          app,
        );
        context.logger.info("Started Web App {name}", { name: args.name });
        return { dataHandles: [handle] };
      },
    },

    stop: {
      description: "Stop a running Web App.",
      arguments: z.object({
        name: z.string().describe("Web App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          ["webapp", "stop", "--name", args.name, "--resource-group", rg],
          g.subscriptionId,
        );
        const app = await az(
          ["webapp", "show", "--name", args.name, "--resource-group", rg],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "webapp",
          sanitizeInstanceName(args.name),
          app,
        );
        context.logger.info("Stopped Web App {name}", { name: args.name });
        return { dataHandles: [handle] };
      },
    },

    restart: {
      description: "Restart a Web App.",
      arguments: z.object({
        name: z.string().describe("Web App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          ["webapp", "restart", "--name", args.name, "--resource-group", rg],
          g.subscriptionId,
        );
        context.logger.info("Restarted Web App {name}", { name: args.name });
        return { dataHandles: [] };
      },
    },

    listAppSettings: {
      description: "List application settings for a Web App.",
      arguments: z.object({
        name: z.string().describe("Web App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const settings = (await az(
          [
            "webapp",
            "config",
            "appsettings",
            "list",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;
        context.logger.info("Found {count} app settings on {name}", {
          count: settings.length,
          name: args.name,
        });
        const handle = await context.writeResource(
          "appSettings",
          sanitizeInstanceName(args.name),
          { webapp: args.name, settings },
        );
        return { dataHandles: [handle] };
      },
    },

    setAppSettings: {
      description: "Set (add or update) application settings on a Web App.",
      arguments: z.object({
        name: z.string().describe("Web App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        settings: z
          .record(z.string(), z.string())
          .describe("Settings to set as key=value pairs"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const pairs = Object.entries(args.settings).map(
          ([k, v]) => `${k}=${v}`,
        );
        const settings = (await az(
          [
            "webapp",
            "config",
            "appsettings",
            "set",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--settings",
            ...pairs,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;
        context.logger.info("Set {count} app settings on {name}", {
          count: pairs.length,
          name: args.name,
        });
        const handle = await context.writeResource(
          "appSettings",
          sanitizeInstanceName(args.name),
          { webapp: args.name, settings },
        );
        return { dataHandles: [handle] };
      },
    },

    deleteAppSettings: {
      description: "Delete application settings from a Web App.",
      arguments: z.object({
        name: z.string().describe("Web App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        settingNames: z
          .array(z.string())
          .min(1)
          .describe("Names of app settings to delete"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "webapp",
            "config",
            "appsettings",
            "delete",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--setting-names",
            ...args.settingNames,
          ],
          g.subscriptionId,
        );
        context.logger.info("Deleted {count} app settings from {name}", {
          count: args.settingNames.length,
          name: args.name,
        });
        return { dataHandles: [] };
      },
    },

    listSlots: {
      description: "List deployment slots for a Web App.",
      arguments: z.object({
        name: z.string().describe("Web App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const slots = (await az(
          [
            "webapp",
            "deployment",
            "slot",
            "list",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;
        context.logger.info("Found {count} slots on {name}", {
          count: slots.length,
          name: args.name,
        });
        const handles = [];
        for (const slot of slots) {
          const handle = await context.writeResource(
            "slot",
            sanitizeInstanceName(slot.name as string),
            slot,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    createSlot: {
      description: "Create a deployment slot on a Web App.",
      arguments: z.object({
        name: z.string().describe("Web App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        slot: z.string().describe("Slot name (e.g. 'staging')"),
        configurationSource: z
          .string()
          .optional()
          .describe(
            "Source app or slot to clone configuration from (e.g. the production app name)",
          ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "webapp",
          "deployment",
          "slot",
          "create",
          "--name",
          args.name,
          "--resource-group",
          rg,
          "--slot",
          args.slot,
        ];
        if (args.configurationSource) {
          cmdArgs.push("--configuration-source", args.configurationSource);
        }
        const slot = await az(cmdArgs, g.subscriptionId);
        context.logger.info("Created slot {slot} on {name}", {
          slot: args.slot,
          name: args.name,
        });
        const handle = await context.writeResource(
          "slot",
          sanitizeInstanceName(`${args.name}-${args.slot}`),
          slot as Record<string, unknown>,
        );
        return { dataHandles: [handle] };
      },
    },

    swapSlots: {
      description:
        "Swap two deployment slots (typically staging → production).",
      arguments: z.object({
        name: z.string().describe("Web App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        slot: z.string().describe("Source slot name (e.g. 'staging')"),
        targetSlot: z
          .string()
          .optional()
          .describe("Target slot name (defaults to production)"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "webapp",
          "deployment",
          "slot",
          "swap",
          "--name",
          args.name,
          "--resource-group",
          rg,
          "--slot",
          args.slot,
        ];
        if (args.targetSlot) cmdArgs.push("--target-slot", args.targetSlot);
        await az(cmdArgs, g.subscriptionId);
        context.logger.info("Swapped slot {slot} on {name}", {
          slot: args.slot,
          name: args.name,
        });
        return { dataHandles: [] };
      },
    },

    deleteSlot: {
      description: "Delete a deployment slot.",
      arguments: z.object({
        name: z.string().describe("Web App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        slot: z.string().describe("Slot name to delete"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "webapp",
            "deployment",
            "slot",
            "delete",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--slot",
            args.slot,
          ],
          g.subscriptionId,
        );
        context.logger.info("Deleted slot {slot} on {name}", {
          slot: args.slot,
          name: args.name,
        });
        return { dataHandles: [] };
      },
    },

    listCustomDomains: {
      description: "List custom-domain hostname bindings on a Web App.",
      arguments: z.object({
        name: z.string().describe("Web App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const bindings = (await az(
          [
            "webapp",
            "config",
            "hostname",
            "list",
            "--webapp-name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;
        context.logger.info("Found {count} hostname bindings on {name}", {
          count: bindings.length,
          name: args.name,
        });
        const handles = [];
        for (const b of bindings) {
          const handle = await context.writeResource(
            "hostnameBinding",
            sanitizeInstanceName(b.name as string),
            b,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    addCustomDomain: {
      description:
        "Bind a custom hostname to a Web App. The DNS record (CNAME or A) must already point at the Web App's default hostname or an IP of the App Service.",
      arguments: z.object({
        name: z.string().describe("Web App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        hostname: z.string().describe(
          "Custom hostname (e.g. 'www.example.com')",
        ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const binding = await az(
          [
            "webapp",
            "config",
            "hostname",
            "add",
            "--webapp-name",
            args.name,
            "--resource-group",
            rg,
            "--hostname",
            args.hostname,
          ],
          g.subscriptionId,
        );
        context.logger.info("Bound hostname {host} to {name}", {
          host: args.hostname,
          name: args.name,
        });
        const handle = await context.writeResource(
          "hostnameBinding",
          sanitizeInstanceName(args.hostname),
          binding as Record<string, unknown>,
        );
        return { dataHandles: [handle] };
      },
    },

    deleteCustomDomain: {
      description: "Unbind a custom hostname from a Web App.",
      arguments: z.object({
        name: z.string().describe("Web App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        hostname: z.string().describe("Custom hostname"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "webapp",
            "config",
            "hostname",
            "delete",
            "--webapp-name",
            args.name,
            "--resource-group",
            rg,
            "--hostname",
            args.hostname,
          ],
          g.subscriptionId,
        );
        context.logger.info("Unbound hostname {host} from {name}", {
          host: args.hostname,
          name: args.name,
        });
        return { dataHandles: [] };
      },
    },

    listSslBindings: {
      description: "List SSL certificates uploaded for a Web App.",
      arguments: z.object({
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const certs = (await az(
          [
            "webapp",
            "config",
            "ssl",
            "list",
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;
        context.logger.info("Found {count} SSL certificates in {rg}", {
          count: certs.length,
          rg,
        });
        const handles = [];
        for (const cert of certs) {
          const handle = await context.writeResource(
            "sslCertificate",
            sanitizeInstanceName(cert.name as string),
            cert,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    uploadSslCertificate: {
      description:
        "Upload a PFX SSL certificate to a Web App's resource group.",
      arguments: z.object({
        name: z.string().describe("Web App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        certificateFile: z.string().describe("Path to the PFX file"),
        certificatePassword: z
          .string()
          .optional()
          .describe("PFX password"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "webapp",
          "config",
          "ssl",
          "upload",
          "--name",
          args.name,
          "--resource-group",
          rg,
          "--certificate-file",
          args.certificateFile,
        ];
        if (args.certificatePassword) {
          cmdArgs.push("--certificate-password", args.certificatePassword);
        }
        const cert = await az(cmdArgs, g.subscriptionId);
        context.logger.info(
          "Uploaded SSL certificate to {name}",
          { name: args.name },
        );
        const handle = await context.writeResource(
          "sslCertificate",
          sanitizeInstanceName(
            (cert as Record<string, unknown>).name as string ??
              args.certificateFile,
          ),
          cert as Record<string, unknown>,
        );
        return { dataHandles: [handle] };
      },
    },

    bindSslCertificate: {
      description: "Bind an SSL certificate to a custom hostname on a Web App.",
      arguments: z.object({
        name: z.string().describe("Web App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        hostname: z.string().describe("Custom hostname to bind"),
        certificateThumbprint: z
          .string()
          .describe("Thumbprint of the uploaded SSL certificate"),
        sslType: z
          .enum(["SNI", "IP"])
          .default("SNI")
          .describe("SSL binding type"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "webapp",
            "config",
            "ssl",
            "bind",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--certificate-thumbprint",
            args.certificateThumbprint,
            "--ssl-type",
            args.sslType,
          ],
          g.subscriptionId,
        );
        context.logger.info(
          "Bound SSL cert {thumb} to {name}/{host}",
          {
            thumb: args.certificateThumbprint,
            name: args.name,
            host: args.hostname,
          },
        );
        return { dataHandles: [] };
      },
    },

    unbindSslCertificate: {
      description: "Unbind an SSL certificate from a Web App hostname.",
      arguments: z.object({
        name: z.string().describe("Web App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        certificateThumbprint: z
          .string()
          .describe("Thumbprint of the SSL certificate"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "webapp",
            "config",
            "ssl",
            "unbind",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--certificate-thumbprint",
            args.certificateThumbprint,
          ],
          g.subscriptionId,
        );
        context.logger.info("Unbound SSL cert from {name}", {
          name: args.name,
        });
        return { dataHandles: [] };
      },
    },
  },
};
