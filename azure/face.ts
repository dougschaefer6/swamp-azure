import { z } from "npm:zod@4.3.6";
import {
  AzureFaceGlobalArgsSchema,
  type DataHandle,
  faceRequest,
  type MethodContext,
  slugify,
} from "./_face_client.ts";

/**
 * `@dougschaefer/azure-face` model type — wraps the Azure AI Vision Face REST
 * API (https://learn.microsoft.com/en-us/rest/api/face/) for identity-aware
 * room services (IARS). Part of the multi-type `@dougschaefer/azure` extension.
 *
 * Unlike the other types in this extension (which shell out to the `az` CLI
 * against an `az login` session), the Face API is a data-plane REST service
 * authenticated by a per-resource subscription key, so this type keeps its own
 * fetch-based client (`_face_client.ts`) and its own globalArguments schema.
 *
 * The recognition pipeline:
 *   camera frame → `detect` (returns faceIds) → `identify` (1:N match against
 *   a PersonGroup) → candidate Person whose `userData` field holds the Entra
 *   objectId → downstream `iars-correlate` workflow loads the AV scene.
 *
 * Credentials resolve from vault — create a vault named `azure-face` with two
 * keys before running any method. Extensions have no vault API in model
 * context; the values arrive via globalArguments:
 *   endpoint: ${{ vault.get(azure-face, endpoint) }}
 *   key:      ${{ vault.get(azure-face, key) }}
 *
 * **GATE — Microsoft Limited Access**: the `identify` method (1:N face
 * recognition) and `addPersonFace` / `trainPersonGroup` are gated behind
 * Microsoft's Limited Access program for the Face API. The scaffold is
 * complete and methods are correctly wired; live calls will fail with HTTP 401
 * until Limited Access is approved and the Azure resource is provisioned.
 * `detect` works today at all subscription tiers without Limited Access.
 * File at: https://aka.ms/facerecognition
 */
export const model = {
  type: "@dougschaefer/azure-face",
  version: "2026.08.04.1",
  globalArguments: AzureFaceGlobalArgsSchema,
  resources: {
    detectionResult: {
      description:
        "Detected faces from a single image: faceIds, bounding rectangles, and optional attributes",
      schema: z.object({
        imageUrl: z.string(),
        faceCount: z.number(),
        faces: z.array(z.unknown()),
        capturedAt: z.iso.datetime(),
      }),
      lifetime: "1h",
      garbageCollection: 20,
    },
    personGroup: {
      description:
        "A Face API PersonGroup: id, name, userData, and training status",
      schema: z.object({
        personGroupId: z.string(),
        name: z.string(),
        userData: z.string(),
        recognitionModel: z.string(),
        capturedAt: z.iso.datetime(),
      }),
      lifetime: "7d",
      garbageCollection: 10,
    },
    personGroupList: {
      description: "List of all PersonGroups under this Face resource",
      schema: z.object({
        groups: z.array(z.unknown()),
        count: z.number(),
        capturedAt: z.iso.datetime(),
      }),
      lifetime: "1d",
      garbageCollection: 5,
    },
    person: {
      description:
        "A Person in a PersonGroup: personId, name, and userData (holds Entra objectId for IARS)",
      schema: z.object({
        personGroupId: z.string(),
        personId: z.string(),
        name: z.string(),
        userData: z.string(),
        persistedFaceIds: z.array(z.string()),
        capturedAt: z.iso.datetime(),
      }),
      lifetime: "7d",
      garbageCollection: 10,
    },
    personList: {
      description: "List of Persons in a PersonGroup",
      schema: z.object({
        personGroupId: z.string(),
        persons: z.array(z.unknown()),
        count: z.number(),
        capturedAt: z.iso.datetime(),
      }),
      lifetime: "1d",
      garbageCollection: 5,
    },
    trainingStatus: {
      description:
        "Training status for a PersonGroup: running, succeeded, or failed",
      schema: z.object({
        personGroupId: z.string(),
        status: z.string(),
        createdDateTime: z.string(),
        lastActionDateTime: z.string(),
        lastSuccessfulTrainingDateTime: z.string(),
        message: z.string(),
        capturedAt: z.iso.datetime(),
      }),
      lifetime: "5m",
      garbageCollection: 10,
    },
    identifyResult: {
      description:
        "1:N identification result: for each faceId, an ordered list of candidate Persons with confidence scores. The top candidate's userData holds the Entra objectId for downstream iars-correlate.",
      schema: z.object({
        personGroupId: z.string(),
        results: z.array(z.unknown()),
        candidateCount: z.number(),
        topPersonId: z.string(),
        topUserData: z.string(),
        topConfidence: z.number(),
        capturedAt: z.iso.datetime(),
      }),
      lifetime: "1h",
      garbageCollection: 20,
    },
    addPersonFaceResult: {
      description:
        "Confirmation that a face image was added to a Person in a PersonGroup",
      schema: z.object({
        personGroupId: z.string(),
        personId: z.string(),
        persistedFaceId: z.string(),
        capturedAt: z.iso.datetime(),
      }),
      lifetime: "30d",
      garbageCollection: 50,
    },
  },
  methods: {
    detect: {
      description:
        "POST /face/v1.0/detect — detect faces in an image supplied as a URL. Returns one faceId per detected face. faceIds are ephemeral (24h TTL) and are passed directly to `identify`. " +
        "Set returnFaceAttributes to a comma-separated list (e.g. `age,gender,headPose`) to include optional attributes; leave empty to save quota. " +
        "GATE: this method works at all Face API subscription tiers; no Limited Access required for detection alone.",
      arguments: z.object({
        imageUrl: z.string().describe(
          "Publicly accessible URL of the image frame to analyze",
        ),
        returnFaceId: z.boolean().default(true).describe(
          "Whether to return a faceId (required for identify)",
        ),
        returnFaceLandmarks: z.boolean().default(false).describe(
          "Whether to return face landmark points",
        ),
        returnFaceAttributes: z.string().default("").describe(
          "Comma-separated face attribute names to return, e.g. `age,gender,headPose`. Leave empty to minimize quota usage.",
        ),
        recognitionModel: z.string().default("recognition_04").describe(
          "Recognition model to use. recognition_04 is the most accurate as of 2024.",
        ),
        detectionModel: z.string().default("detection_03").describe(
          "Detection model to use. detection_03 is recommended for still images.",
        ),
      }),
      execute: async (
        args: {
          imageUrl: string;
          returnFaceId: boolean;
          returnFaceLandmarks: boolean;
          returnFaceAttributes: string;
          recognitionModel: string;
          detectionModel: string;
        },
        context: MethodContext,
      ): Promise<{ dataHandles: DataHandle[] }> => {
        context.logger.info("Face detect: {url}", { url: args.imageUrl });
        const query: Record<string, string> = {
          returnFaceId: String(args.returnFaceId),
          returnFaceLandmarks: String(args.returnFaceLandmarks),
          recognitionModel: args.recognitionModel,
          detectionModel: args.detectionModel,
        };
        if (args.returnFaceAttributes) {
          query.returnFaceAttributes = args.returnFaceAttributes;
        }
        const { data } = await faceRequest(
          context.globalArgs,
          "POST",
          "/detect",
          {
            query,
            json: { url: args.imageUrl },
          },
        );
        const faces = Array.isArray(data) ? data : [];
        const handle = await context.writeResource(
          "detectionResult",
          `detect-${slugify(args.imageUrl)}`,
          {
            imageUrl: args.imageUrl,
            faceCount: faces.length,
            faces,
            capturedAt: new Date().toISOString(),
          },
        );
        context.logger.info("Detected {n} face(s)", { n: faces.length });
        return { dataHandles: [handle] };
      },
    },

    identify: {
      description:
        "POST /face/v1.0/identify — 1:N identification: given one or more faceIds (from `detect`) and a personGroupId, return ordered candidate Persons with confidence scores. " +
        "The top candidate's `userData` field holds the Entra objectId consumed by the `iars-correlate` workflow. " +
        "GATE: requires Microsoft Limited Access approval. Live calls will fail with HTTP 401 until approved. See: https://aka.ms/facerecognition",
      arguments: z.object({
        faceIds: z.array(z.string()).describe(
          "One or more faceIds returned by `detect` (max 10, TTL 24h)",
        ),
        personGroupId: z.string().describe(
          "Id of the PersonGroup to search against. Each Person's userData must hold the Entra objectId.",
        ),
        maxNumOfCandidatesReturned: z.number().int().default(1).describe(
          "Max candidates per face (1-5). Default 1 returns only the best match.",
        ),
        confidenceThreshold: z.number().default(0.5).describe(
          "Minimum confidence score to include a candidate (0.0-1.0). Default 0.5.",
        ),
      }),
      execute: async (
        args: {
          faceIds: string[];
          personGroupId: string;
          maxNumOfCandidatesReturned: number;
          confidenceThreshold: number;
        },
        context: MethodContext,
      ): Promise<{ dataHandles: DataHandle[] }> => {
        context.logger.info(
          "Face identify: {n} faceId(s) against personGroup {pg}",
          { n: args.faceIds.length, pg: args.personGroupId },
        );
        const { data } = await faceRequest(
          context.globalArgs,
          "POST",
          "/identify",
          {
            json: {
              faceIds: args.faceIds,
              personGroupId: args.personGroupId,
              maxNumOfCandidatesReturned: args.maxNumOfCandidatesReturned,
              confidenceThreshold: args.confidenceThreshold,
            },
          },
        );
        const results = Array.isArray(data) ? data : [];
        // Extract the top candidate from the first result for quick CEL access
        const firstResult = (results[0] ?? {}) as Record<string, unknown>;
        const candidates = Array.isArray(firstResult.candidates)
          ? firstResult.candidates
          : [];
        const top = (candidates[0] ?? {}) as Record<string, unknown>;
        const topPersonId = String(top.personId ?? "");
        const topConfidence = Number(top.confidence ?? 0);
        // Resolve the top candidate's userData (the Entra objectId for IARS) by
        // reading the Person record — Azure's identify response returns only the
        // personId, not userData. Best-effort: a lookup failure leaves topUserData
        // empty and never breaks identification. This is the value iars-correlate
        // consumes, so resolving it here saves the caller a separate lookup.
        let topUserData = "";
        if (topPersonId) {
          try {
            const { data: person } = await faceRequest(
              context.globalArgs,
              "GET",
              `/persongroups/${
                encodeURIComponent(args.personGroupId)
              }/persons/${encodeURIComponent(topPersonId)}`,
            );
            topUserData = String(
              (person as Record<string, unknown>)?.userData ?? "",
            );
          } catch (err) {
            context.logger.warn(
              "identify: could not resolve userData for person {pid}: {err}",
              { pid: topPersonId, err: String(err) },
            );
          }
        }
        const handle = await context.writeResource(
          "identifyResult",
          `identify-${args.personGroupId}`,
          {
            personGroupId: args.personGroupId,
            results,
            candidateCount: candidates.length,
            topPersonId,
            topUserData,
            topConfidence,
            capturedAt: new Date().toISOString(),
          },
        );
        context.logger.info(
          "Top candidate: {pid} (confidence {conf})",
          { pid: topPersonId || "none", conf: topConfidence },
        );
        return { dataHandles: [handle] };
      },
    },

    createPersonGroup: {
      description:
        "PUT /face/v1.0/persongroups/{personGroupId} — create a new PersonGroup. " +
        "For IARS: create one group per deployment (e.g. `iars-building-a`). Each Person's `userData` field stores the Entra objectId. " +
        "Use recognitionModel `recognition_04` (most accurate). " +
        "GATE: requires Limited Access for training/identify; creation itself may succeed on standard tier.",
      arguments: z.object({
        personGroupId: z.string().describe(
          "Unique id for the group (lowercase, alphanumeric, hyphens, underscores; max 64 chars)",
        ),
        name: z.string().describe(
          "Human-readable display name for the group (max 128 chars)",
        ),
        userData: z.string().default("").describe(
          "Optional metadata string (max 16KB). Useful for tagging the deployment site or environment.",
        ),
        recognitionModel: z.string().default("recognition_04").describe(
          "Recognition model for faces enrolled in this group. Must match the model used during detect.",
        ),
      }),
      execute: async (
        args: {
          personGroupId: string;
          name: string;
          userData: string;
          recognitionModel: string;
        },
        context: MethodContext,
      ): Promise<{ dataHandles: DataHandle[] }> => {
        context.logger.info(
          "Creating PersonGroup {id} (model: {model})",
          { id: args.personGroupId, model: args.recognitionModel },
        );
        await faceRequest(
          context.globalArgs,
          "PUT",
          `/persongroups/${encodeURIComponent(args.personGroupId)}`,
          {
            json: {
              name: args.name,
              userData: args.userData,
              recognitionModel: args.recognitionModel,
            },
          },
        );
        const handle = await context.writeResource(
          "personGroup",
          args.personGroupId,
          {
            personGroupId: args.personGroupId,
            name: args.name,
            userData: args.userData,
            recognitionModel: args.recognitionModel,
            capturedAt: new Date().toISOString(),
          },
        );
        context.logger.info("PersonGroup {id} created", {
          id: args.personGroupId,
        });
        return { dataHandles: [handle] };
      },
    },

    listPersonGroups: {
      description:
        "GET /face/v1.0/persongroups — list PersonGroups under this Face resource, with optional pagination. Returns a snapshot of groups available for identify.",
      arguments: z.object({
        start: z.string().default("").describe(
          "List groups with id > start (for pagination)",
        ),
        top: z.number().int().default(1000).describe(
          "Max groups to return (1-1000)",
        ),
        returnRecognitionModel: z.boolean().default(true).describe(
          "Include the recognitionModel field in each group",
        ),
      }),
      execute: async (
        args: {
          start: string;
          top: number;
          returnRecognitionModel: boolean;
        },
        context: MethodContext,
      ): Promise<{ dataHandles: DataHandle[] }> => {
        const query: Record<string, string> = {
          top: String(Math.max(1, Math.min(1000, args.top))),
          returnRecognitionModel: String(args.returnRecognitionModel),
        };
        if (args.start) query.start = args.start;
        const { data } = await faceRequest(
          context.globalArgs,
          "GET",
          "/persongroups",
          { query },
        );
        const groups = Array.isArray(data) ? data : [];
        const handle = await context.writeResource(
          "personGroupList",
          "list",
          {
            groups,
            count: groups.length,
            capturedAt: new Date().toISOString(),
          },
        );
        context.logger.info("Found {n} PersonGroup(s)", { n: groups.length });
        return { dataHandles: [handle] };
      },
    },

    deletePersonGroup: {
      description:
        "DELETE /face/v1.0/persongroups/{personGroupId} — delete a PersonGroup and all its Persons and faces. " +
        "DESTRUCTIVE: irreversible. Run `listPersonGroups` first to verify the id.",
      arguments: z.object({
        personGroupId: z.string().describe("Id of the PersonGroup to delete"),
      }),
      execute: async (
        args: { personGroupId: string },
        context: MethodContext,
      ): Promise<{ dataHandles: DataHandle[] }> => {
        context.logger.warning(
          "Deleting PersonGroup {id} — all enrolled persons and faces will be removed",
          { id: args.personGroupId },
        );
        await faceRequest(
          context.globalArgs,
          "DELETE",
          `/persongroups/${encodeURIComponent(args.personGroupId)}`,
        );
        context.logger.info("PersonGroup {id} deleted", {
          id: args.personGroupId,
        });
        return { dataHandles: [] };
      },
    },

    addPerson: {
      description:
        "POST /face/v1.0/persongroups/{personGroupId}/persons — add a named Person to a PersonGroup. " +
        "For IARS: set `userData` to the Entra objectId of the employee. This is the value `identify` returns and `iars-correlate` consumes. " +
        "Returns a personId which is then passed to `addPersonFace`.",
      arguments: z.object({
        personGroupId: z.string().describe("Id of the PersonGroup to add to"),
        name: z.string().describe(
          "Display name for the person (e.g. the employee's full name)",
        ),
        userData: z.string().describe(
          "Entra objectId of the employee — this is what `identify` returns as the identity assertion. Max 16KB.",
        ),
      }),
      execute: async (
        args: { personGroupId: string; name: string; userData: string },
        context: MethodContext,
      ): Promise<{ dataHandles: DataHandle[] }> => {
        context.logger.info(
          "Adding person {name} to PersonGroup {pg}",
          { name: args.name, pg: args.personGroupId },
        );
        const { data } = await faceRequest(
          context.globalArgs,
          "POST",
          `/persongroups/${encodeURIComponent(args.personGroupId)}/persons`,
          {
            json: { name: args.name, userData: args.userData },
          },
        );
        const d = (data ?? {}) as Record<string, unknown>;
        const personId = String(d.personId ?? "");
        const handle = await context.writeResource(
          "person",
          `${args.personGroupId}-${personId}`,
          {
            personGroupId: args.personGroupId,
            personId,
            name: args.name,
            userData: args.userData,
            persistedFaceIds: [],
            capturedAt: new Date().toISOString(),
          },
        );
        context.logger.info("Person {name} created: personId={pid}", {
          name: args.name,
          pid: personId,
        });
        return { dataHandles: [handle] };
      },
    },

    addPersonFace: {
      description:
        "POST /face/v1.0/persongroups/{personGroupId}/persons/{personId}/persistedfaces — add a face image to an enrolled Person. " +
        "Accepts an image URL. Add at least 1 face per person before training; more faces (different angles, lighting) improve accuracy. " +
        "GATE: requires Microsoft Limited Access approval.",
      arguments: z.object({
        personGroupId: z.string().describe("Id of the PersonGroup"),
        personId: z.string().describe(
          "Id of the Person (returned by `addPerson`)",
        ),
        imageUrl: z.string().describe(
          "Publicly accessible URL of the enrollment image (face clearly visible)",
        ),
        userData: z.string().default("").describe(
          "Optional metadata for this specific face image",
        ),
        targetFace: z.string().default("").describe(
          "Optional bounding box to target a specific face in the image: left,top,width,height (pixels)",
        ),
        detectionModel: z.string().default("detection_03").describe(
          "Detection model to use when adding the face",
        ),
      }),
      execute: async (
        args: {
          personGroupId: string;
          personId: string;
          imageUrl: string;
          userData: string;
          targetFace: string;
          detectionModel: string;
        },
        context: MethodContext,
      ): Promise<{ dataHandles: DataHandle[] }> => {
        context.logger.info(
          "Adding face to person {pid} in group {pg}",
          { pid: args.personId, pg: args.personGroupId },
        );
        const query: Record<string, string> = {
          detectionModel: args.detectionModel,
        };
        if (args.userData) query.userData = args.userData;
        if (args.targetFace) query.targetFace = args.targetFace;
        const { data } = await faceRequest(
          context.globalArgs,
          "POST",
          `/persongroups/${encodeURIComponent(args.personGroupId)}/persons/${
            encodeURIComponent(args.personId)
          }/persistedfaces`,
          {
            query,
            json: { url: args.imageUrl },
          },
        );
        const d = (data ?? {}) as Record<string, unknown>;
        const persistedFaceId = String(d.persistedFaceId ?? "");
        const handle = await context.writeResource(
          "addPersonFaceResult",
          persistedFaceId || `face-${slugify(args.imageUrl)}`,
          {
            personGroupId: args.personGroupId,
            personId: args.personId,
            persistedFaceId,
            capturedAt: new Date().toISOString(),
          },
        );
        context.logger.info("Face enrolled: persistedFaceId={fid}", {
          fid: persistedFaceId,
        });
        return { dataHandles: [handle] };
      },
    },

    listPersons: {
      description:
        "GET /face/v1.0/persongroups/{personGroupId}/persons — list all Persons in a PersonGroup. " +
        "Use this to verify enrollment or to look up a personId's `userData` (Entra objectId) outside of an identify call.",
      arguments: z.object({
        personGroupId: z.string().describe("Id of the PersonGroup"),
        start: z.string().default("").describe(
          "List persons with id > start (for pagination)",
        ),
        top: z.number().int().default(1000).describe(
          "Max persons to return (1-1000)",
        ),
      }),
      execute: async (
        args: { personGroupId: string; start: string; top: number },
        context: MethodContext,
      ): Promise<{ dataHandles: DataHandle[] }> => {
        const query: Record<string, string> = {
          top: String(Math.max(1, Math.min(1000, args.top))),
        };
        if (args.start) query.start = args.start;
        const { data } = await faceRequest(
          context.globalArgs,
          "GET",
          `/persongroups/${encodeURIComponent(args.personGroupId)}/persons`,
          { query },
        );
        const persons = Array.isArray(data) ? data : [];
        const handle = await context.writeResource(
          "personList",
          args.personGroupId,
          {
            personGroupId: args.personGroupId,
            persons,
            count: persons.length,
            capturedAt: new Date().toISOString(),
          },
        );
        context.logger.info("PersonGroup {pg}: {n} person(s) enrolled", {
          pg: args.personGroupId,
          n: persons.length,
        });
        return { dataHandles: [handle] };
      },
    },

    trainPersonGroup: {
      description:
        "POST /face/v1.0/persongroups/{personGroupId}/train — trigger training on a PersonGroup after adding or removing Persons/faces. " +
        "Training is required before `identify` will work. Check progress with `getPersonGroupTrainingStatus`. " +
        "GATE: requires Microsoft Limited Access approval.",
      arguments: z.object({
        personGroupId: z.string().describe(
          "Id of the PersonGroup to train",
        ),
      }),
      execute: async (
        args: { personGroupId: string },
        context: MethodContext,
      ): Promise<{ dataHandles: DataHandle[] }> => {
        context.logger.info("Triggering training for PersonGroup {pg}", {
          pg: args.personGroupId,
        });
        await faceRequest(
          context.globalArgs,
          "POST",
          `/persongroups/${encodeURIComponent(args.personGroupId)}/train`,
        );
        context.logger.info(
          "Training started for PersonGroup {pg} — poll getPersonGroupTrainingStatus",
          { pg: args.personGroupId },
        );
        return { dataHandles: [] };
      },
    },

    getPersonGroupTrainingStatus: {
      description:
        "GET /face/v1.0/persongroups/{personGroupId}/training — get the current training status for a PersonGroup. " +
        "Returns `status` (running | succeeded | failed), last training timestamps, and an error message on failure. " +
        "Poll this after `trainPersonGroup` until status is `succeeded` before running `identify`.",
      arguments: z.object({
        personGroupId: z.string().describe(
          "Id of the PersonGroup to check",
        ),
      }),
      execute: async (
        args: { personGroupId: string },
        context: MethodContext,
      ): Promise<{ dataHandles: DataHandle[] }> => {
        const { data } = await faceRequest(
          context.globalArgs,
          "GET",
          `/persongroups/${encodeURIComponent(args.personGroupId)}/training`,
        );
        const d = (data ?? {}) as Record<string, unknown>;
        const status = String(d.status ?? "unknown");
        const handle = await context.writeResource(
          "trainingStatus",
          args.personGroupId,
          {
            personGroupId: args.personGroupId,
            status,
            createdDateTime: String(d.createdDateTime ?? ""),
            lastActionDateTime: String(d.lastActionDateTime ?? ""),
            lastSuccessfulTrainingDateTime: String(
              d.lastSuccessfulTrainingDateTime ?? "",
            ),
            message: String(d.message ?? ""),
            capturedAt: new Date().toISOString(),
          },
        );
        context.logger.info("PersonGroup {pg} training status: {status}", {
          pg: args.personGroupId,
          status,
        });
        return { dataHandles: [handle] };
      },
    },

    detectLiveness: {
      description:
        "Liveness detection stub — Azure Face liveness is a session-based client-side flow, NOT a simple REST call. " +
        "It requires the Azure AI Vision Face SDK (iOS/Android/Web) to run an active liveness challenge in the camera feed, then POST a session result to the Face API. " +
        "This method is intentionally left as a stub. " +
        "TODO: implement using the Azure Face liveness session API: " +
        "  1. POST /face/v1.0/detectLiveness/singleModal/sessions (create a session, get a token) " +
        "  2. Client SDK (npm:@azure/ai-vision-face@latest or the native SDK) runs the liveness check using the token " +
        "  3. GET /face/v1.0/detectLiveness/singleModal/sessions/{sessionId}/result to retrieve the verdict " +
        "See: https://learn.microsoft.com/en-us/azure/ai-services/computer-vision/tutorials/liveness",
      arguments: z.object({
        sessionId: z.string().optional().describe(
          "Reserved: sessionId for polling a completed liveness session result (not yet implemented)",
        ),
      }),
      execute: (
        _args: { sessionId?: string },
        context: MethodContext,
      ): Promise<{ dataHandles: DataHandle[] }> => {
        context.logger.warning(
          "detectLiveness is not yet implemented — liveness requires the Azure AI Vision Face SDK client-side flow. See JSDoc for the implementation plan.",
        );
        return Promise.reject(
          new Error(
            "detectLiveness is not yet implemented. " +
              "Azure liveness detection requires a client-side SDK session flow. " +
              "See the method JSDoc for the implementation TODO.",
          ),
        );
      },
    },
  },
};
