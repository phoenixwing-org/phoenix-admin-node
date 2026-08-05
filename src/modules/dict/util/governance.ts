import { CoolCommException } from '@cool-midway/core';

const DICTIONARY_TAG_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const DICTIONARY_TAG_LIMIT = 32;

export function normalizeDictionaryTags(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return [];
  if (!Array.isArray(value)) {
    throw new CoolCommException('字典标签必须是字符串数组');
  }
  const tags = [
    ...new Set(value.map(item => String(item).trim().toLowerCase())),
  ];
  if (tags.length > DICTIONARY_TAG_LIMIT) {
    throw new CoolCommException(`字典标签不能超过 ${DICTIONARY_TAG_LIMIT} 个`);
  }
  if (tags.some(tag => !DICTIONARY_TAG_PATTERN.test(tag))) {
    throw new CoolCommException(
      '字典标签只能包含小写字母、数字、点、下划线和连字符'
    );
  }
  return tags.sort();
}

export function mergeDictionaryTags(...values: unknown[]): string[] {
  return normalizeDictionaryTags(
    values.flatMap(value => (Array.isArray(value) ? value : []))
  );
}
