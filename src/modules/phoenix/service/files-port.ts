import { CoolCommException } from '@cool-midway/core';
import { Inject, Provide } from '@midwayjs/core';
import {
  PAH_HOST_FILES_PORT,
  PahHostFilesPortError,
  PahHostFilesPortV1,
  PahResolveActiveFileBindingInputV1,
  PahResolveActiveFileDescriptorInputV1,
} from '../port/files';
import { PahFilesService } from './files';

const MODULE_ID = /^[a-z][a-z0-9-]{0,127}$/u;
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const INPUT_KEYS = new Set(['ownerModuleId', 'fileId', 'expectedVersion']);
const BINDING_INPUT_KEYS = new Set(['ownerModuleId', 'bindingId']);

function invalidArgument(message: string): never {
  throw new PahHostFilesPortError('INVALID_ARGUMENT', message, 400);
}

function normalizeInput(
  input: PahResolveActiveFileDescriptorInputV1
): PahResolveActiveFileDescriptorInputV1 {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    return invalidArgument('Host Files descriptor 请求必须是普通对象');
  }
  const unknownKey = Reflect.ownKeys(input).find(
    key => typeof key !== 'string' || !INPUT_KEYS.has(key)
  );
  if (unknownKey !== undefined) {
    return invalidArgument('Host Files descriptor 请求包含未知字段');
  }
  const ownerModuleId =
    typeof input.ownerModuleId === 'string' ? input.ownerModuleId.trim() : '';
  if (!MODULE_ID.test(ownerModuleId)) {
    return invalidArgument('Host Files ownerModuleId 不合法');
  }
  const fileId =
    typeof input.fileId === 'string' ? input.fileId.toLowerCase() : '';
  if (!UUID.test(fileId)) {
    return invalidArgument('Host Files fileId 不合法');
  }
  const expectedVersion = input.expectedVersion;
  if (
    expectedVersion !== undefined &&
    (!Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 1 ||
      expectedVersion > 2_147_483_647)
  ) {
    return invalidArgument('Host Files expectedVersion 不合法');
  }
  return Object.freeze({ ownerModuleId, fileId, expectedVersion });
}

function normalizeBindingInput(
  input: PahResolveActiveFileBindingInputV1
): PahResolveActiveFileBindingInputV1 {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    return invalidArgument('Host Files binding 请求必须是普通对象');
  }
  const unknownKey = Reflect.ownKeys(input).find(
    key => typeof key !== 'string' || !BINDING_INPUT_KEYS.has(key)
  );
  if (unknownKey !== undefined) {
    return invalidArgument('Host Files binding 请求包含未知字段');
  }
  const ownerModuleId =
    typeof input.ownerModuleId === 'string' ? input.ownerModuleId.trim() : '';
  if (!MODULE_ID.test(ownerModuleId)) {
    return invalidArgument('Host Files ownerModuleId 不合法');
  }
  const bindingId =
    typeof input.bindingId === 'string' ? input.bindingId.toLowerCase() : '';
  if (!UUID.test(bindingId)) {
    return invalidArgument('Host Files bindingId 不合法');
  }
  return Object.freeze({ ownerModuleId, bindingId });
}

function stableFailure(error: unknown): PahHostFilesPortError {
  if (error instanceof PahHostFilesPortError) return error;
  if (error instanceof CoolCommException) {
    if (error.statusCode === 401) {
      return new PahHostFilesPortError(
        'UNAUTHENTICATED',
        'Host Files 缺少有效登录身份',
        401
      );
    }
    if (error.statusCode === 403) {
      return new PahHostFilesPortError(
        'ACCESS_DENIED',
        'Host Files descriptor 访问被拒绝',
        403
      );
    }
  }
  return new PahHostFilesPortError(
    'HOST_FAILURE',
    'Host Files descriptor 解析失败',
    500
  );
}

@Provide(PAH_HOST_FILES_PORT)
export class PahHostFilesPortAdapter implements PahHostFilesPortV1 {
  @Inject()
  pahFilesService: PahFilesService;

  async resolveActiveDescriptor(input: PahResolveActiveFileDescriptorInputV1) {
    try {
      const normalized = normalizeInput(input);
      return await this.pahFilesService.resolveActiveDescriptorForPort(
        normalized
      );
    } catch (error) {
      throw stableFailure(error);
    }
  }

  async resolveActiveBinding(input: PahResolveActiveFileBindingInputV1) {
    try {
      const normalized = normalizeBindingInput(input);
      return await this.pahFilesService.resolveActiveBindingForPort(normalized);
    } catch (error) {
      throw stableFailure(error);
    }
  }
}
