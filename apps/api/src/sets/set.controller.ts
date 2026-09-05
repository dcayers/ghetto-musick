import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  Req,
  Autowired,
  HttpCode,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  type FastifyRequest,
} from "@riktajs/core";
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiSecurity,
  ApiBody,
  ApiParam,
} from "@riktajs/swagger";
import {
  createSetSchema,
  updateSetSchema,
  setIdParamSchema,
  setItemIdParamSchema,
  addSetItemSchema,
  reorderSetItemSchema,
  setSchema,
  setSummaryListSchema,
  setDetailSchema,
  setItemSchema,
  errorResponseSchema,
  validator,
  type AddSetItemInput,
  type CreateSetInput,
  type ReorderSetItemInput,
  type UpdateSetInput,
} from "@flowgraph/contracts";
import { InvalidRankError, RankOrderError } from "@flowgraph/domain";
import {
  SetItemNotFoundError,
  SetNotFoundError,
  TrackNotInWorkspaceError,
  type SetService,
} from "./set.service.js";
import {
  UnauthenticatedError,
  NoWorkspaceError,
  type WorkspaceContext,
  type WorkspaceContextService,
} from "../auth/workspace-context.js";
import { SET_SERVICE, WORKSPACE_CONTEXT } from "../tokens.js";

// Pre-widened so the decorator positions stay shallow (TS2589 with Zod 4).
const createSetBody = validator(createSetSchema);
const updateSetBody = validator(updateSetSchema);
const setIdParam = validator(setIdParamSchema);
const setItemIdParam = validator(setItemIdParamSchema);
const addItemBody = validator(addSetItemSchema);
const reorderBody = validator(reorderSetItemSchema);

/**
 * Set HTTP surface — plan §8.5.
 *
 * Thin: translate HTTP into service calls and domain errors into status
 * codes. Ordering lives in `@flowgraph/domain`; all persistence in the
 * repository.
 *
 * The §8.5 branch, validate, publish, and versions routes are deliberately
 * absent. Branches are deferred (decision 11); validation and publish follow,
 * and stub routes returning "not implemented" would appear in the contract as
 * capabilities the API does not have.
 */
@Controller("/v1/sets")
@ApiTags("Sets")
@ApiSecurity("sessionCookie")
export class SetController {
  @Autowired(SET_SERVICE)
  private readonly sets!: SetService;

  @Autowired(WORKSPACE_CONTEXT)
  private readonly workspaces!: WorkspaceContextService;

  // --- Sets -----------------------------------------------------------------

  @Get()
  @ApiOperation({ summary: "List sets", description: "Sets in the caller's workspace." })
  @ApiOkResponse({ description: "Sets.", schema: setSummaryListSchema })
  @ApiUnauthorizedResponse({ description: "No valid session.", schema: errorResponseSchema })
  @ApiForbiddenResponse({ description: "No workspace.", schema: errorResponseSchema })
  async listSets(@Req() request: FastifyRequest) {
    const { workspaceId } = await this.requireWorkspace(request);
    return { items: await this.sets.listSets(workspaceId) };
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: "Create a set", description: "Creates an empty running order." })
  @ApiBody({ description: "Set to create.", schema: createSetSchema })
  @ApiCreatedResponse({ description: "Set created.", schema: setSchema })
  @ApiBadRequestResponse({ description: "Invalid body.", schema: errorResponseSchema })
  @ApiUnauthorizedResponse({ description: "No valid session.", schema: errorResponseSchema })
  @ApiForbiddenResponse({ description: "No workspace.", schema: errorResponseSchema })
  async createSet(
    @Body(createSetBody) body: CreateSetInput,
    @Req() request: FastifyRequest,
  ) {
    const { workspaceId } = await this.requireWorkspace(request);
    return this.sets.createSet(workspaceId, body);
  }

  @Get("/:setId")
  @ApiOperation({
    summary: "Get a set with its items",
    description: "One round trip for the whole timeline: the set and its tracks in order.",
  })
  @ApiParam({ name: "setId", type: "string", description: "Set UUID." })
  @ApiOkResponse({ description: "Set detail.", schema: setDetailSchema })
  @ApiNotFoundResponse({ description: "No such set.", schema: errorResponseSchema })
  @ApiUnauthorizedResponse({ description: "No valid session.", schema: errorResponseSchema })
  @ApiForbiddenResponse({ description: "No workspace.", schema: errorResponseSchema })
  async getSet(
    @Param(setIdParam) params: { setId: string },
    @Req() request: FastifyRequest,
  ) {
    const { workspaceId } = await this.requireWorkspace(request);
    return this.translate(() => this.sets.getSetDetail(workspaceId, params.setId));
  }

  @Patch("/:setId")
  @ApiOperation({
    summary: "Update a set",
    description:
      "Name, target tempo, and target key. Targets are the set's plan, not a " +
      "measurement of its contents, so they may disagree with the tracks in it.",
  })
  @ApiParam({ name: "setId", type: "string", description: "Set UUID." })
  @ApiBody({ description: "Fields to change.", schema: updateSetSchema })
  @ApiOkResponse({ description: "Updated set.", schema: setSchema })
  @ApiBadRequestResponse({ description: "Invalid body.", schema: errorResponseSchema })
  @ApiNotFoundResponse({ description: "No such set.", schema: errorResponseSchema })
  @ApiUnauthorizedResponse({ description: "No valid session.", schema: errorResponseSchema })
  @ApiForbiddenResponse({ description: "No workspace.", schema: errorResponseSchema })
  async updateSet(
    @Param(setIdParam) params: { setId: string },
    @Body(updateSetBody) body: UpdateSetInput,
    @Req() request: FastifyRequest,
  ) {
    const { workspaceId } = await this.requireWorkspace(request);
    return this.translate(() => this.sets.updateSet(workspaceId, params.setId, body));
  }

  @Delete("/:setId")
  @HttpCode(204)
  @ApiOperation({
    summary: "Delete a set",
    description: "Removes the running order. The tracks in it are untouched.",
  })
  @ApiParam({ name: "setId", type: "string", description: "Set UUID." })
  @ApiNoContentResponse({ description: "Set deleted." })
  @ApiNotFoundResponse({ description: "No such set.", schema: errorResponseSchema })
  @ApiUnauthorizedResponse({ description: "No valid session.", schema: errorResponseSchema })
  @ApiForbiddenResponse({ description: "No workspace.", schema: errorResponseSchema })
  async deleteSet(
    @Param(setIdParam) params: { setId: string },
    @Req() request: FastifyRequest,
  ) {
    const { workspaceId } = await this.requireWorkspace(request);
    await this.translate(() => this.sets.deleteSet(workspaceId, params.setId));
  }

  // --- Items ----------------------------------------------------------------

  @Post("/:setId/items")
  @HttpCode(201)
  @ApiOperation({
    summary: "Add a track to the set",
    description:
      "Appends unless a position is given. A track may appear more than once: " +
      "set entries are occurrences, not membership.",
  })
  @ApiParam({ name: "setId", type: "string", description: "Set UUID." })
  @ApiBody({ description: "Track and optional position.", schema: addSetItemSchema })
  @ApiCreatedResponse({ description: "Item added.", schema: setItemSchema })
  @ApiBadRequestResponse({ description: "Invalid body.", schema: errorResponseSchema })
  @ApiNotFoundResponse({ description: "Set or track not found.", schema: errorResponseSchema })
  @ApiUnauthorizedResponse({ description: "No valid session.", schema: errorResponseSchema })
  @ApiForbiddenResponse({ description: "No workspace.", schema: errorResponseSchema })
  async addItem(
    @Param(setIdParam) params: { setId: string },
    @Body(addItemBody) body: AddSetItemInput,
    @Req() request: FastifyRequest,
  ) {
    const { workspaceId } = await this.requireWorkspace(request);
    return this.translate(() => this.sets.addItem(workspaceId, params.setId, body));
  }

  @Patch("/:setId/items/reorder")
  @ApiOperation({
    summary: "Move an item to a position",
    description:
      "Writes one row: the moved item gets a rank between its new neighbours, " +
      "and nothing else is renumbered. `toIndex` is the position the item " +
      "should occupy after the move.",
  })
  @ApiParam({ name: "setId", type: "string", description: "Set UUID." })
  @ApiBody({ description: "Item and target index.", schema: reorderSetItemSchema })
  @ApiOkResponse({ description: "Moved item.", schema: setItemSchema })
  @ApiBadRequestResponse({ description: "Invalid body.", schema: errorResponseSchema })
  @ApiNotFoundResponse({ description: "Set or item not found.", schema: errorResponseSchema })
  @ApiUnauthorizedResponse({ description: "No valid session.", schema: errorResponseSchema })
  @ApiForbiddenResponse({ description: "No workspace.", schema: errorResponseSchema })
  async reorderItem(
    @Param(setIdParam) params: { setId: string },
    @Body(reorderBody) body: ReorderSetItemInput,
    @Req() request: FastifyRequest,
  ) {
    const { workspaceId } = await this.requireWorkspace(request);
    return this.translate(() => this.sets.reorderItem(workspaceId, params.setId, body));
  }

  @Delete("/:setId/items/:itemId")
  @HttpCode(204)
  @ApiOperation({
    summary: "Remove an item from the set",
    description: "Removes one occurrence. The track stays in the library and on the graph.",
  })
  @ApiParam({ name: "setId", type: "string", description: "Set UUID." })
  @ApiParam({ name: "itemId", type: "string", description: "Set item UUID." })
  @ApiNoContentResponse({ description: "Item removed." })
  @ApiNotFoundResponse({ description: "Set or item not found.", schema: errorResponseSchema })
  @ApiUnauthorizedResponse({ description: "No valid session.", schema: errorResponseSchema })
  @ApiForbiddenResponse({ description: "No workspace.", schema: errorResponseSchema })
  async removeItem(
    @Param(setItemIdParam) params: { setId: string; itemId: string },
    @Req() request: FastifyRequest,
  ) {
    const { workspaceId } = await this.requireWorkspace(request);
    await this.translate(() =>
      this.sets.removeItem(workspaceId, params.setId, params.itemId),
    );
  }

  // --- Error translation ----------------------------------------------------

  private async translate<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof SetNotFoundError ||
        error instanceof SetItemNotFoundError ||
        error instanceof TrackNotInWorkspaceError
      ) {
        // 404 rather than 403 for cross-workspace ids, so the status code is
        // not an existence oracle.
        throw new NotFoundException(error.message);
      }
      if (error instanceof InvalidRankError || error instanceof RankOrderError) {
        // Reachable only if stored ranks are corrupt, which is a server-side
        // fault — but a 500 would hide it in logs, and a 400 at least names
        // the set that needs repairing.
        throw new BadRequestException(error.message);
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
