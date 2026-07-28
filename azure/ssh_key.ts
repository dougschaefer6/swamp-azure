import { z } from "npm:zod@4.3.6";
import {
  az,
  AzureGlobalArgsSchema,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const SshKeySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string(),
    publicKey: z.string().optional().nullable(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

/**
 * `@dougschaefer/azure-ssh-key` model — SSH public key lifecycle for
 * Azure (Microsoft.Compute/sshPublicKeys) wrapping the `az sshkey` CLI.
 * list enumerates keys in a resource group or subscription-wide. get
 * and sync return or refresh a single key. create provisions a new
 * key with a supplied public-key PEM and optional tags. delete removes
 * a key. Used by VM provisioning workflows that need a pre-registered
 * SSH key resource (referenced by ID from `azure-vm` create), keeping
 * key material out of VM custom data and centralizing key rotation.
 */
export const model = {
  type: "@dougschaefer/azure-ssh-key",
  version: "2026.07.28.4",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    sshKey: {
      description: "Azure SSH public key resource",
      schema: SshKeySchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List all SSH public keys in a resource group (or all in the subscription).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["sshkey", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) {
          cmdArgs.push("--resource-group", rg);
        }

        const keys = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} SSH public keys", {
          count: keys.length,
        });

        const handles = [];
        for (const key of keys) {
          const handle = await context.writeResource(
            "sshKey",
            sanitizeInstanceName(key.name as string),
            key,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single SSH public key by name.",
      arguments: z.object({
        name: z.string().describe("SSH public key name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const key = await az(
          [
            "sshkey",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "sshKey",
          sanitizeInstanceName(args.name),
          key,
        );
        return { dataHandles: [handle] };
      },
    },

    sync: {
      description:
        "Refresh the stored state of an SSH public key without making changes.",
      arguments: z.object({
        name: z.string().describe("SSH public key name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const key = await az(
          [
            "sshkey",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "sshKey",
          sanitizeInstanceName(args.name),
          key,
        );
        context.logger.info("Synced SSH public key {name}", {
          name: args.name,
        });
        return { dataHandles: [handle] };
      },
    },

    create: {
      description: "Create an SSH public key resource.",
      arguments: z.object({
        name: z.string().describe("SSH public key name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        location: z.string().describe("Azure region, e.g. eastus2"),
        publicKey: z
          .string()
          .describe(
            "SSH public key content (e.g. starting with 'ssh-rsa AAAA…' or 'ssh-ed25519 AAAA…')",
          ),
        tags: z
          .record(z.string(), z.string())
          .optional()
          .describe("Tags as key=value pairs"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "sshkey",
          "create",
          "--name",
          args.name,
          "--resource-group",
          rg,
          "--location",
          args.location,
          "--public-key",
          args.publicKey,
        ];

        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }

        await az(cmdArgs, g.subscriptionId);

        context.logger.info(
          "Created SSH public key {name} in {location}",
          { name: args.name, location: args.location },
        );

        const key = await az(
          [
            "sshkey",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "sshKey",
          sanitizeInstanceName(args.name),
          key,
        );
        return { dataHandles: [handle] };
      },
    },

    delete: {
      description: "Delete an SSH public key resource.",
      arguments: z.object({
        name: z.string().describe("SSH public key name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "sshkey",
            "delete",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--yes",
          ],
          g.subscriptionId,
        );

        context.logger.info("Deleted SSH public key {name}", {
          name: args.name,
        });
        return { dataHandles: [] };
      },
    },
  },
};
