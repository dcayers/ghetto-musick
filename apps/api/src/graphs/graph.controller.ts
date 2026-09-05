import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  Req,
  Autowired,
  HttpCode,
  NotFoundException,
  BadRequestException,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
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
  ApiConflictResponse,
  ApiSecurity,
  ApiBody,
  ApiParam,
  ApiQuery,
} from "@riktajs/swagger";
import {
  createGraphSchema,
  graphIdParamSchema,
  addGraphNodeSchema,
  updateLayoutSchema,
  nodeIdParamSchema,
  createTransitionSchema,
  updateTransitionSchema,
  transitionIdParamSchema,
  suggestQuerySchema,
  graphSchema,
  graphSummaryListSchema,
  graphDetailSchema,
  graphNodeSchema,
  transitionSchema,
  transitionSuggestionsSchema,
  errorResponseSchema,
  validator,
  type CreateGraphInput,
  type AddGraphNodeInput,
  type UpdateLayoutInput,
  type CreateTransitionInput,
  type UpdateTransitionInput,
} from "@flowgraph/contracts";
import {
  GraphNotFoundError,
  SelfTransitionError,
  TransitionTechniqueTakenError,
  TrackNotInWorkspaceError,
  type GraphService,
} from "./graph.service.js";
import { GraphVersionConflictError } from "./graph.repository.js";
import {
  UnauthenticatedError,
  NoWorkspaceError,
  type WorkspaceContext,
  type WorkspaceContextService,
} from "../auth/workspace-context.js";
import { GRAPH_SERVICE, WORKSPACE_CONTEXT } from "../tokens.js";

// Pre-widened so the decorator positions stay shallow (TS2589 with Zod 4).
const createGraphBody = validator(createGraphSchema);
const graphIdParam = validator(graphIdParamSchema);
const addNodeBody = validator(addGraphNodeSchema);
const layoutBody = validator(updateLayoutSchema);
const nodeIdParam = validator(nodeIdParamSchema);
const createTransitionBody = validator(createTransitionSchema);
const updateTransitionBody = validator(updateTransitionSchema);
const transitionIdParam = validator(transitionIdParamSchema);
const suggestQuery = validator(suggestQuerySchema);

/**
 * Graph and transition HTTP surface — plan §8.3.
 *
 * Thin: translate HTTP into service calls and domain errors into status
 * codes. All scoring lives in `@flowgraph/domain`; all persistence in the
 * repository.
 */
@Controller("/v1")
@ApiTags("Graphs")
@ApiSecurity("sessionCookie")
export class GraphController {
  @Autowired(GRAPH_SERVICE)
  private readonly graphs!: GraphService;

  @Autowired(WORKSPACE_CONTEXT)
  private readonly workspaces!: WorkspaceContextService;

  // --- Graphs ---------------------------------------------------------------

  @Get("/graphs")
  @ApiOperation({ summary: "List graphs", description: "Graphs in the caller's workspace." })
  @ApiOkResponse({ description: "Graphs.", schema: graphSummaryListSchema })
  @ApiUnauthorizedResponse({ description: "No valid session.", schema: errorResponseSchema })
  @ApiForbiddenResponse({ description: "No workspace.", schema: errorResponseSchema })
  async listGraphs(@Req() request: FastifyRequest) {
    const { workspaceId } = await this.requireWorkspace(request);
    return { items: await this.graphs.listGraphs(workspaceId) };
  }

  @Post("/graphs")
  @HttpCode(201)
  @ApiOperation({ summary: "Create a graph", description: "Creates an empty canvas." })
  @ApiBody({ description: "Graph to create.", schema: createGraphSchema })
  @ApiCreatedResponse({ description: "Graph created.", schema: graphSchema })
  @ApiBadRequestResponse({ description: "Invalid body.", schema: errorResponseSchema })
  @ApiUnauthorizedResponse({ description: "No valid session.", schema: errorResponseSchema })
  @ApiForbiddenResponse({ description: "No workspace.", schema: errorResponseSchema })
  async createGraph(
    @Body(createGraphBody) body: CreateGraphInput,
    @Req() request: FastifyRequest,
  ) {
    const { workspaceId } = await this.requireWorkspace(request);
    return this.graphs.createGraph(workspaceId, body);
  }

  @Get("/graphs/:graphId")
  @ApiOperation({
    summary: "Get a graph with its nodes and transitions",
    description:
      "One round trip for the whole canvas. Only transitions whose endpoints " +
      "are both placed on this graph are returned.",
  })
  @ApiParam({ name: "graphId", type: "string", description: "Graph UUID." })
  @ApiOkResponse({ description: "Graph detail.", schema: graphDetailSchema })
  @ApiNotFoundResponse({ description: "No such graph.", schema: errorResponseSchema })
  @ApiUnauthorizedResponse({ description: "No valid session.", schema: errorResponseSchema })
  @ApiForbiddenResponse({ description: "No workspace.", schema: errorResponseSchema })
  async getGraph(
    @Param(graphIdParam) params: { graphId: string },
    @Req() request: FastifyRequest,
  ) {
    const { workspaceId } = await this.requireWorkspace(request);
    return this.translate(() => this.graphs.getGraphDetail(workspaceId, params.graphId));
  }

  // --- Nodes ----------------------------------------------------------------

  @Post("/graphs/:graphId/nodes")
  @HttpCode(201)
  @ApiOperation({
    summary: "Place a track on the graph",
    description:
      "Idempotent: re-adding a track already on the canvas returns the " +
      "existing node rather than erroring. Duplicate occurrences of one " +
      "track are not allowed in v1.",
  })
  @ApiParam({ name: "graphId", type: "string", description: "Graph UUID." })
  @ApiBody({ description: "Track and position.", schema: addGraphNodeSchema })
  @ApiCreatedResponse({ description: "Node placed.", schema: graphNodeSchema })
  @ApiNotFoundResponse({ description: "Graph or track not found.", schema: errorResponseSchema })
  @ApiUnauthorizedResponse({ description: "No valid session.", schema: errorResponseSchema })
  @ApiForbiddenResponse({ description: "No workspace.", schema: errorResponseSchema })
  async addNode(
    @Param(graphIdParam) params: { graphId: string },
    @Body(addNodeBody) body: AddGraphNodeInput,
    @Req() request: FastifyRequest,
  ) {
    const { workspaceId } = await this.requireWorkspace(request);
    return this.translate(() => this.graphs.addNode(workspaceId, params.graphId, body));
  }

  @Patch("/graphs/:graphId/layout")
  @ApiOperation({
    summary: "Apply a batch of node positions",
    description:
      "Bounded batch sent on pointer release, not per frame. `expectedVersion` " +
      "is optimistic concurrency: a mismatch returns 409 so the client can " +
      "reload rather than clobber another session's layout.",
  })
  @ApiParam({ name: "graphId", type: "string", description: "Graph UUID." })
  @ApiBody({ description: "Positions and expected version.", schema: updateLayoutSchema })
  @ApiOkResponse({ description: "Layout applied; version bumped.", schema: graphSchema })
  @ApiConflictResponse({ description: "Version is stale.", schema: errorResponseSchema })
  @ApiNotFoundResponse({ description: "No such graph.", schema: errorResponseSchema })
  @ApiUnauthorizedResponse({ description: "No valid session.", schema: errorResponseSchema })
  @ApiForbiddenResponse({ description: "No workspace.", schema: errorResponseSchema })
  async updateLayout(
    @Param(graphIdParam) params: { graphId: string },
    @Body(layoutBody) body: UpdateLayoutInput,
    @Req() request: FastifyRequest,
  ) {
    const { workspaceId } = await this.requireWorkspace(request);
    return this.translate(() =>
      this.graphs.updateLayout(workspaceId, params.graphId, body),
    );
  }

  @Delete("/graphs/:graphId/nodes/:nodeId")
  @HttpCode(204)
  @ApiOperation({
    summary: "Remove a track from the graph",
    description:
      "Delete-from-graph, not delete-from-library — the track stays in the " +
      "workspace and on any other canvas.",
  })
  @ApiParam({ name: "graphId", type: "string", description: "Graph UUID." })
  @ApiParam({ name: "nodeId", type: "string", description: "Node UUID." })
  @ApiOkResponse({ description: "Node removed." })
  @ApiNotFoundResponse({ description: "No such node.", schema: errorResponseSchema })
  @ApiUnauthorizedResponse({ description: "No valid session.", schema: errorResponseSchema })
  @ApiForbiddenResponse({ description: "No workspace.", schema: errorResponseSchema })
  async removeNode(
    @Param(nodeIdParam) params: { graphId: string; nodeId: string },
    @Req() request: FastifyRequest,
  ) {
    const { workspaceId } = await this.requireWorkspace(request);
    await this.translate(() =>
      this.graphs.removeNode(workspaceId, params.graphId, params.nodeId),
    );
    return null;
  }

  // --- Transitions ----------------------------------------------------------

  @Post("/transitions")
  @HttpCode(201)
  @ApiOperation({
    summary: "Create a transition",
    description:
      "Directed: A→B is not automatically valid as B→A. Scored " +
      "deterministically at authoring time and stored with the algorithm " +
      "version that produced it.",
  })
  @ApiBody({ description: "Transition to create.", schema: createTransitionSchema })
  @ApiCreatedResponse({ description: "Transition created.", schema: transitionSchema })
  @ApiBadRequestResponse({ description: "Invalid body or self-transition.", schema: errorResponseSchema })
  @ApiNotFoundResponse({ description: "Track not in this workspace.", schema: errorResponseSchema })
  @ApiUnauthorizedResponse({ description: "No valid session.", schema: errorResponseSchema })
  @ApiForbiddenResponse({ description: "No workspace.", schema: errorResponseSchema })
  async createTransition(
    @Body(createTransitionBody) body: CreateTransitionInput,
    @Req() request: FastifyRequest,
  ) {
    const { workspaceId } = await this.requireWorkspace(request);
    return this.translate(() => this.graphs.createTransition(workspaceId, body));
  }

  @Patch("/transitions/:transitionId")
  @ApiOperation({
    summary: "Refine a transition",
    description:
      "Updates technique, planned bars, notes, or tags on an existing " +
      "transition — the refinement half of quick-create. Endpoints are not " +
      "editable: re-pointing an edge is a different transition with a " +
      "different score. The stored score is left untouched, because no " +
      "editable field is an input to it.",
  })
  @ApiParam({ name: "transitionId", type: "string", description: "Transition UUID." })
  @ApiBody({ description: "Fields to change.", schema: updateTransitionSchema })
  @ApiOkResponse({ description: "Transition updated.", schema: transitionSchema })
  @ApiBadRequestResponse({ description: "Invalid or empty body.", schema: errorResponseSchema })
  @ApiNotFoundResponse({ description: "No such transition.", schema: errorResponseSchema })
  @ApiConflictResponse({
    description: "Another transition between these tracks already uses that technique.",
    schema: errorResponseSchema,
  })
  @ApiUnauthorizedResponse({ description: "No valid session.", schema: errorResponseSchema })
  @ApiForbiddenResponse({ description: "No workspace.", schema: errorResponseSchema })
  async updateTransition(
    @Param(transitionIdParam) params: { transitionId: string },
    @Body(updateTransitionBody) body: UpdateTransitionInput,
    @Req() request: FastifyRequest,
  ) {
    const { workspaceId } = await this.requireWorkspace(request);
    return this.translate(() =>
      this.graphs.updateTransition(workspaceId, params.transitionId, body),
    );
  }

  @Delete("/transitions/:transitionId")
  @HttpCode(204)
  @ApiOperation({
    summary: "Delete a transition",
    description: "Soft delete — set items may still reference it historically.",
  })
  @ApiParam({ name: "transitionId", type: "string", description: "Transition UUID." })
  @ApiOkResponse({ description: "Transition deleted." })
  @ApiNotFoundResponse({ description: "No such transition.", schema: errorResponseSchema })
  @ApiUnauthorizedResponse({ description: "No valid session.", schema: errorResponseSchema })
  @ApiForbiddenResponse({ description: "No workspace.", schema: errorResponseSchema })
  async deleteTransition(
    @Param(transitionIdParam) params: { transitionId: string },
    @Req() request: FastifyRequest,
  ) {
    const { workspaceId } = await this.requireWorkspace(request);
    await this.translate(() =>
      this.graphs.deleteTransition(workspaceId, params.transitionId),
    );
    return null;
  }

  @Get("/transitions/suggestions")
  @ApiOperation({
    summary: "Suggest next tracks",
    description:
      "Ranks the whole library by deterministic compatibility — Camelot " +
      "harmonic relation, tempo window including half/double time, energy " +
      "delta, and shared tags. Considers tracks the DJ has not connected " +
      "yet, which is the point.",
  })
  @ApiQuery({ name: "fromTrackId", required: true, type: "string", description: "Track to mix out of." })
  @ApiQuery({ name: "limit", required: false, type: "integer", description: "Max suggestions, 1-50. Defaults to 10." })
  @ApiOkResponse({ description: "Ranked candidates.", schema: transitionSuggestionsSchema })
  @ApiBadRequestResponse({ description: "Invalid query.", schema: errorResponseSchema })
  @ApiNotFoundResponse({ description: "Track not in this workspace.", schema: errorResponseSchema })
  @ApiUnauthorizedResponse({ description: "No valid session.", schema: errorResponseSchema })
  @ApiForbiddenResponse({ description: "No workspace.", schema: errorResponseSchema })
  async suggest(
    @Query(suggestQuery) query: { fromTrackId: string; limit: number },
    @Req() request: FastifyRequest,
  ) {
    const { workspaceId } = await this.requireWorkspace(request);
    return this.translate(async () => ({
      items: await this.graphs.suggestTransitions(
        workspaceId,
        query.fromTrackId,
        query.limit,
      ),
    }));
  }

  // --- Error translation ----------------------------------------------------

  private async translate<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof GraphNotFoundError || error instanceof TrackNotInWorkspaceError) {
        // 404 rather than 403 for cross-workspace ids, so the status code is
        // not an existence oracle.
        throw new NotFoundException(error.message);
      }
      if (error instanceof SelfTransitionError) {
        throw new BadRequestException(error.message);
      }
      if (
        error instanceof GraphVersionConflictError ||
        error instanceof TransitionTechniqueTakenError
      ) {
        throw new ConflictException(error.message);
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
