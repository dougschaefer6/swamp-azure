import { z } from "npm:zod@4";

export const AzureGlobalArgsSchema = z.object({
  subscriptionId: z.string().describe(
    "Azure subscription ID. Use: ${{ vault.get('azure', 'SUBSCRIPTION_ID') }}",
  ),
  resourceGroup: z
    .string()
    .optional()
    .describe("Default resource group for operations that require one"),
});

export async function az(
  args: string[],
  subscriptionId?: string,
): Promise<unknown> {
  const fullArgs = [...args, "--output", "json"];
  if (subscriptionId) {
    fullArgs.push("--subscription", subscriptionId);
  }

  const cmd = new Deno.Command("az", {
    args: fullArgs,
    stdout: "piped",
    stderr: "piped",
  });

  const result = await cmd.output();
  const stderr = new TextDecoder().decode(result.stderr);

  if (result.code !== 0) {
    throw new Error(`az ${args.slice(0, 2).join(" ")} failed: ${stderr}`);
  }

  const stdout = new TextDecoder().decode(result.stdout).trim();
  if (!stdout) return null;

  return JSON.parse(stdout);
}

export function sanitizeInstanceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.\./g, "--")
    .replace(/[/\\]/g, "-")
    .replace(/\0/g, "");
}

export function requireResourceGroup(
  methodArg: string | undefined,
  globalArg: string | undefined,
): string {
  const rg = methodArg || globalArg;
  if (!rg) {
    throw new Error(
      "resourceGroup is required — pass it as an argument or set it in globalArguments",
    );
  }
  return rg;
}
