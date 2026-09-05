import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  Autowired,
  HttpCode,
  NotFoundException,
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
  ApiSecurity,
  ApiBody,
} from "@riktajs/swagger";
import {
  startSeratoImportSchema,
  importRunSchema,
  importRunListSchema,
  seratoRootsSchema,
  errorResponseSchema,
  validator,
  type StartSeratoImportInput,
} from "@flowgraph/contracts";
import { SeratoRootNotFoundError } from "./serato-source.js";
import type { ImportService } from "./import.service.js";
import {
  UnauthenticatedError,
  NoWorkspaceError,
  type WorkspaceContext,
  type WorkspaceContextService,
} from "../auth/workspace-context.js";
import { IMPORT_SERVICE, WORKSPACE_CONTEXT } from "../tokens.js";

// Pre-widened so the decorator positions stay shallow (TS2589 with Zod 4).
const startImportBody = validator(startSeratoImportSchema);

/**
 * Import HTTP surface — plan §8.7, §12.3 S1.
 *
 * Read-only against Serato. The import reads a library and writes to our own
 * database; nothing here can modify a `_Serato_` directory, and the parser
 * underneath it cannot open a file for writing at all (ADR-0010).
 *
 * §8.7's bridge routes — device enrollment, signed commands — are absent.
 * There is no bridge yet: the API runs on the same machine as the library
 * (decision 18), so it reads directly. `SeratoSource` is the seam where a
 * bridge slots in when deployment moves off the machine.
 */
@Controller("/v1/imports")
@ApiTags("Imports")
@ApiSecurity("sessionCookie")
export class ImportController {
  @Autowired(IMPORT_SERVICE)
  private readonly imports!: ImportService;

  @Autowired(WORKSPACE_CONTEXT)
  private readonly workspaces!: WorkspaceContextService;

  @Get("/serato/roots")
  @ApiOperation({
    summary: "Find Serato libraries on this machine",
    description:
      "Standard macOS locations, with whether each holds a readable " +
      "`database V2`. Lets the client offer a root instead of asking the " +
      "user to type a path.",
  })
  @ApiOkResponse({ description: "Candidate roots.", schema: seratoRootsSchema })
  @ApiUnauthorizedResponse({ description: "No valid session.", schema: errorResponseSchema })
  @ApiForbiddenResponse({ description: "No workspace.", schema: errorResponseSchema })
  async roots(@Req() request: FastifyRequest) {
    await this.requireWorkspace(request);
    return { items: this.imports.discoverRoots() };
  }

  @Get()
  @ApiOperation({
    summary: "List import runs",
    description: "Most recent first — the audit trail for what an import did.",
  })
  @ApiOkResponse({ description: "Import runs.", schema: importRunListSchema })
  @ApiUnauthorizedResponse({ description: "No valid session.", schema: errorResponseSchema })
  @ApiForbiddenResponse({ description: "No workspace.", schema: errorResponseSchema })
  async listRuns(@Req() request: FastifyRequest) {
    const { workspaceId } = await this.requireWorkspace(request);
    return { items: await this.imports.listRuns(workspaceId) };
  }

  @Post("/serato")
  @HttpCode(201)
  @ApiOperation({
    summary: "Import a Serato library",
    description:
      "Read-only. Idempotent: a local entry matches on its canonical path " +
      "and a streaming entry on title and artist, so re-running updates " +
      "rather than duplicates. Tags, graph placement, and set membership are " +
      "never touched — those are the user's work, not Serato's.",
  })
  @ApiBody({ description: "Optional root to scan.", schema: startSeratoImportSchema })
  @ApiCreatedResponse({ description: "Completed run.", schema: importRunSchema })
  @ApiBadRequestResponse({ description: "Invalid body.", schema: errorResponseSchema })
  @ApiNotFoundResponse({ description: "No readable library found.", schema: errorResponseSchema })
  @ApiUnauthorizedResponse({ description: "No valid session.", schema: errorResponseSchema })
  @ApiForbiddenResponse({ description: "No workspace.", schema: errorResponseSchema })
  async importSerato(
    @Body(startImportBody) body: StartSeratoImportInput,
    @Req() request: FastifyRequest,
  ) {
    const { workspaceId } = await this.requireWorkspace(request);
    try {
      return await this.imports.importSerato(workspaceId, body.root);
    } catch (error) {
      if (error instanceof SeratoRootNotFoundError) {
        throw new NotFoundException(error.message);
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
