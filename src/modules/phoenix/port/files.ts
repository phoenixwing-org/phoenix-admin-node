export const PAH_HOST_FILES_PORT = 'pahHostFilesPortV1' as const;

export type PahHostFilesPortErrorCode =
  | 'INVALID_ARGUMENT'
  | 'UNAUTHENTICATED'
  | 'ACCESS_DENIED'
  | 'NOT_FOUND'
  | 'INACTIVE'
  | 'VERSION_CONFLICT'
  | 'HOST_FAILURE';

export class PahHostFilesPortError extends Error {
  readonly name = 'PahHostFilesPortError';

  constructor(
    readonly code: PahHostFilesPortErrorCode,
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface PahResolveActiveFileDescriptorInputV1 {
  readonly ownerModuleId: string;
  readonly fileId: string;
  readonly expectedVersion?: number;
}

export interface PahActiveFileDescriptorV1 {
  readonly fileId: string;
  readonly version: number;
  readonly sha256: string;
  readonly originalName: string;
  readonly mime: string;
  readonly size: number;
  readonly ownerModuleId: string;
}

export interface PahResolveActiveFileBindingInputV1 {
  readonly ownerModuleId: string;
  readonly bindingId: string;
}

export interface PahActiveFileBindingV1 {
  readonly bindingId: string;
  readonly resourceType: string;
  readonly resourceKey: string;
  readonly relationType: string;
  readonly fileId: string;
  readonly fileVersion: number;
}

/**
 * Stable Host-owned Node port for plugin domain services.
 *
 * Consumers inject this interface with `@Inject(PAH_HOST_FILES_PORT)` and must
 * never import the Host Files service, provider, repository, or entities.
 */
export interface PahHostFilesPortV1 {
  resolveActiveDescriptor(
    input: PahResolveActiveFileDescriptorInputV1
  ): Promise<Readonly<PahActiveFileDescriptorV1>>;
  resolveActiveBinding(
    input: PahResolveActiveFileBindingInputV1
  ): Promise<Readonly<PahActiveFileBindingV1>>;
}
