import type { PahCapabilityEndpoint, PahCapabilityHttpMethod } from './plugin';

export const PAH_FILES_CAPABILITY_KINDS = ['read', 'write', 'admin'] as const;
export type PahFilesCapabilityKind =
  (typeof PAH_FILES_CAPABILITY_KINDS)[number];

const ownerPrefix = '/admin/phoenix/files/:ownerModuleId';

export const PAH_FILES_CAPABILITY_ENDPOINTS = {
  read: [
    { method: 'GET', path: ownerPrefix },
    { method: 'GET', path: `${ownerPrefix}/:fileId` },
    { method: 'GET', path: `${ownerPrefix}/:fileId/content` },
    { method: 'GET', path: `${ownerPrefix}/bindings` },
  ],
  write: [
    { method: 'POST', path: ownerPrefix },
    { method: 'PATCH', path: `${ownerPrefix}/:fileId` },
    { method: 'POST', path: `${ownerPrefix}/bindings` },
    { method: 'PATCH', path: `${ownerPrefix}/bindings/:bindingId` },
    { method: 'POST', path: `${ownerPrefix}/bindings/:bindingId/unbind` },
    { method: 'POST', path: `${ownerPrefix}/bindings/:bindingId/restore` },
  ],
  admin: [
    { method: 'POST', path: `${ownerPrefix}/:fileId/delete` },
    { method: 'POST', path: `${ownerPrefix}/:fileId/restore` },
  ],
} as const satisfies Readonly<
  Record<PahFilesCapabilityKind, readonly PahCapabilityEndpoint[]>
>;

export function pahFilesCapabilityId(
  moduleId: string,
  kind: PahFilesCapabilityKind
) {
  return `${moduleId}:files:${kind}`;
}

export function pahFilesCapabilityKind(
  moduleId: string,
  capabilityId: string
): PahFilesCapabilityKind | null {
  return (
    PAH_FILES_CAPABILITY_KINDS.find(
      kind => capabilityId === pahFilesCapabilityId(moduleId, kind)
    ) || null
  );
}

function endpointKey(endpoint: {
  method: PahCapabilityHttpMethod;
  path: string;
}) {
  return `${endpoint.method} ${endpoint.path}`;
}

export function isPahFilesCapabilityEndpoint(
  moduleId: string,
  capabilityId: string,
  endpoint: PahCapabilityEndpoint
) {
  const kind = pahFilesCapabilityKind(moduleId, capabilityId);
  return Boolean(
    kind &&
      PAH_FILES_CAPABILITY_ENDPOINTS[kind].some(
        candidate => endpointKey(candidate) === endpointKey(endpoint)
      )
  );
}

export function hasCompletePahFilesEndpointSet(
  moduleId: string,
  capabilityId: string,
  endpoints: readonly PahCapabilityEndpoint[]
) {
  const kind = pahFilesCapabilityKind(moduleId, capabilityId);
  if (!kind) return false;
  const expected = PAH_FILES_CAPABILITY_ENDPOINTS[kind].map(endpointKey).sort();
  const actual = endpoints.map(endpointKey).sort();
  return JSON.stringify(expected) === JSON.stringify(actual);
}

export type PahFileStatus = 'active' | 'deleted';
export type PahFileBindingStatus = 'active' | 'unbound';

export interface PahFileDescriptorV1 {
  schemaVersion: 1;
  fileId: string;
  version: number;
  sha256: string;
  mime: string;
  originalName: string;
  size: number;
  providerId: string;
  storageIdentity: string;
  status: PahFileStatus;
  ownerModuleId: string;
  createdBy: number;
  createdAt: string;
  updatedBy: number | null;
  updatedAt: string;
  deletedBy: number | null;
  deletedAt: string | null;
}

export interface PahFileBindingV1 {
  schemaVersion: 1;
  bindingId: string;
  ownerModuleId: string;
  resourceType: string;
  resourceKey: string;
  fileId: string;
  fileVersion: number;
  relationType: string;
  alias: string | null;
  note: string | null;
  attributes: Record<string, string | number | boolean | null>;
  sortOrder: number;
  isPrimary: boolean;
  status: PahFileBindingStatus;
  createdBy: number;
  createdAt: string;
  updatedBy: number | null;
  updatedAt: string;
  unboundBy: number | null;
  unboundAt: string | null;
}
