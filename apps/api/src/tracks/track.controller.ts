import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  Autowired,
  HttpCode,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  // Rikta re-exports Fastify's types. Importing from "fastify" directly would
  // require adding it as a dependency, which ADR-0002 rule 7 forbids — Rikta
  // runs its own bundled copy, so an app-level pin has no effect anyway.
  type FastifyRequest,
} from "@riktajs/core";
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiSecurity,
  ApiBody,
  ApiQuery,
  ApiParam,
} from "@riktajs/swagger";
import {
  createTrackSchema,
  listTracksQuerySchema,
  trackIdParamSchema,
  trackSchema,
  trackPageSchema,
  errorResponseSchema,
  validator,
  type CreateTrackInput,
  type ListTracksQuery,
} from "@flowgraph/contracts";
import { TrackNotFoundError, type TrackService } from "./track.service.js";
import {
  UnauthenticatedError,
  NoWorkspaceError,
  type WorkspaceContext,
  type WorkspaceContextService,
} from "../auth/workspace-context.js";
import { TRACK_SERVICE, WORKSPACE_CONTEXT } from "../tokens.js";

// Pre-widened at module scope so the decorator positions below stay shallow —
// see `validator` for why (TS2589 with Zod 4 + Rikta's generic overloads).
const bodySchema = validator(createTrackSchema);
const querySchema = validator(listTracksQuerySchema);
const paramSchema = validator(trackIdParamSchema);

/**
 * Track HTTP surface — plan §8.2.
 *
 * One of only two places allowed to import `@riktajs/*` (ADR-0002 rule 2).
 * Its entire job is translating HTTP into service calls and domain errors
 * into HTTP status codes.
 *
 * Workspace scope comes from the session (§8, §16.2) — never from a
 * client-supplied value. The `x-workspace-id` header this replaced let any
 * caller name any workspace.
 */
@Controller("/v1/tracks")
@ApiTags("Tracks")
@ApiSecurity("sessionCookie")
export class TrackController {
  @Autowired(TRACK_SERVICE)
  private readonly tracks!: TrackService;

  @Autowired(WORKSPACE_CONTEXT)
  private readonly workspaces!: WorkspaceContextService;

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: "Create a track",
    description:
      "Creates a track in the caller's workspace. The workspace is derived " +
      "from the session; it cannot be supplied by the client.",
  })
  @ApiBody({ description: "Track to create.", schema: createTrackSchema })
  @ApiCreatedResponse({ description: "Track created.", schema: trackSchema })
  @ApiBadRequestResponse({
    description: "Request body failed validation.",
    schema: errorResponseSchema,
  })
  @ApiUnauthorizedResponse({
    description: "No valid session cookie.",
    schema: errorResponseSchema,
  })
  @ApiForbiddenResponse({
    description: "Authenticated, but the account has no workspace.",
    schema: errorResponseSchema,
  })
  async create(@Body(bodySchema) body: CreateTrackInput, @Req() request: FastifyRequest) {
    const { workspaceId } = await this.requireWorkspace(request);
    return this.tracks.create(workspaceId, body);
  }

  @Get()
  @ApiOperation({
    summary: "List tracks",
    description:
      "Cursor-paginated over (createdAt DESC, id DESC). Pass the previous " +
      "response's `nextCursor` to fetch the following page; a null cursor " +
      "means the last page.",
  })
  @ApiQuery({ name: "query", required: false, type: "string", description: "Case-insensitive match on title or artist." })
  @ApiQuery({ name: "bpmMin", required: false, type: "number", description: "Lower bound on BPM (inclusive)." })
  @ApiQuery({ name: "bpmMax", required: false, type: "number", description: "Upper bound on BPM (inclusive)." })
  @ApiQuery({ name: "cursor", required: false, type: "string", description: "Opaque cursor from a previous response." })
  @ApiQuery({ name: "limit", required: false, type: "integer", description: "Page size, 1-100. Defaults to 50." })
  @ApiOkResponse({ description: "A page of tracks.", schema: trackPageSchema })
  @ApiBadRequestResponse({
    description: "Query parameters failed validation.",
    schema: errorResponseSchema,
  })
  @ApiUnauthorizedResponse({
    description: "No valid session cookie.",
    schema: errorResponseSchema,
  })
  @ApiForbiddenResponse({
    description: "Authenticated, but the account has no workspace.",
    schema: errorResponseSchema,
  })
  async list(@Query(querySchema) query: ListTracksQuery, @Req() request: FastifyRequest) {
    const { workspaceId } = await this.requireWorkspace(request);
    return this.tracks.list(workspaceId, query);
  }

  @Get("/:trackId")
  @ApiOperation({
    summary: "Get a track by id",
    description:
      "Returns 404 rather than 403 for a track in another workspace — a " +
      "distinct status would confirm the row exists and turn the response " +
      "code into a cross-workspace existence oracle.",
  })
  @ApiParam({ name: "trackId", type: "string", description: "Track UUID." })
  @ApiOkResponse({ description: "The track.", schema: trackSchema })
  @ApiNotFoundResponse({
    description: "No such track in the caller's workspace.",
    schema: errorResponseSchema,
  })
  @ApiBadRequestResponse({
    description: "Malformed track id.",
    schema: errorResponseSchema,
  })
  @ApiUnauthorizedResponse({
    description: "No valid session cookie.",
    schema: errorResponseSchema,
  })
  @ApiForbiddenResponse({
    description: "Authenticated, but the account has no workspace.",
    schema: errorResponseSchema,
  })
  async getById(
    @Param(paramSchema) params: { trackId: string },
    @Req() request: FastifyRequest,
  ) {
    const { workspaceId } = await this.requireWorkspace(request);

    try {
      return await this.tracks.getById(workspaceId, params.trackId);
    } catch (error) {
      if (error instanceof TrackNotFoundError) {
        // Deliberately 404, not 403: a track in another workspace must be
        // indistinguishable from one that does not exist, or the response
        // code itself becomes a cross-workspace existence oracle.
        throw new NotFoundException(`Track ${params.trackId} not found`);
      }
      throw error;
    }
  }

  private async requireWorkspace(request: FastifyRequest): Promise<WorkspaceContext> {
    try {
      return await this.workspaces.resolve(request.headers);
    } catch (error) {
      if (error instanceof UnauthenticatedError) {
        throw new UnauthorizedException("Authentication required");
      }
      if (error instanceof NoWorkspaceError) {
        throw new ForbiddenException("No workspace available for this account");
      }
      throw error;
    }
  }
}
