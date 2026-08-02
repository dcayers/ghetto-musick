import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Headers,
  Autowired,
  HttpCode,
  NotFoundException,
  BadRequestException,
} from "@riktajs/core";
import {
  createTrackSchema,
  listTracksQuerySchema,
  trackIdParamSchema,
  validator,
  type CreateTrackInput,
  type ListTracksQuery,
} from "@flowgraph/contracts";

// Pre-widened at module scope so the decorator positions below stay shallow —
// see `validator` for why (TS2589 with Zod 4 + Rikta's generic overloads).
const bodySchema = validator(createTrackSchema);
const querySchema = validator(listTracksQuerySchema);
const paramSchema = validator(trackIdParamSchema);
import { TrackNotFoundError, type TrackService } from "./track.service.js";
import { TRACK_SERVICE } from "../tokens.js";

/**
 * Track HTTP surface — plan §8.2.
 *
 * One of only two places allowed to import `@riktajs/*` (ADR-0002 rule 2).
 * Its entire job is translating HTTP into service calls and domain errors
 * into HTTP status codes.
 *
 * Uses an explicit DI token (`@Autowired(TrackService)`) rather than bare
 * `@Autowired()`, per ADR-0002 rule 5: property injection by type inference
 * requires `emitDecoratorMetadata` and breaks under esbuild/tsx.
 */
@Controller("/v1/tracks")
export class TrackController {
  @Autowired(TRACK_SERVICE)
  private readonly tracks!: TrackService;

  @Post()
  @HttpCode(201)
  async create(
    @Body(bodySchema) body: CreateTrackInput,
    @Headers("x-workspace-id") workspaceId: string | undefined,
  ) {
    return this.tracks.create(requireWorkspace(workspaceId), body);
  }

  @Get()
  async list(
    @Query(querySchema) query: ListTracksQuery,
    @Headers("x-workspace-id") workspaceId: string | undefined,
  ) {
    return this.tracks.list(requireWorkspace(workspaceId), query);
  }

  @Get("/:trackId")
  async getById(
    @Param(paramSchema) params: { trackId: string },
    @Headers("x-workspace-id") workspaceId: string | undefined,
  ) {
    try {
      return await this.tracks.getById(requireWorkspace(workspaceId), params.trackId);
    } catch (error) {
      if (error instanceof TrackNotFoundError) {
        throw new NotFoundException(`Track ${params.trackId} not found`);
      }
      throw error;
    }
  }
}

/**
 * PLACEHOLDER — replaced by session-derived workspace context in Phase 1.
 *
 * Plan §8 requires every endpoint be workspace-scoped from the authenticated
 * context, with clients never choosing an owner ID. This header stub exists
 * only so the Phase 0 vertical slice can prove the data path end to end.
 *
 * ADR-0004 (better-auth) supplies the real implementation. Until then this
 * endpoint is not safe to expose.
 */
function requireWorkspace(workspaceId: string | undefined): string {
  if (!workspaceId) {
    throw new BadRequestException("x-workspace-id header is required");
  }
  return workspaceId;
}
