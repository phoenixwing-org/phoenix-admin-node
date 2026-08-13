import { safeStartupDiagnostic } from '../../../src/modules/pah/service/safe-diagnostic';

describe('Phoenix 启动诊断脱敏', () => {
  it('截断并移除凭据、敏感查询和本机绝对路径', () => {
    const detail = safeStartupDiagnostic(
      new Error(
        'Bearer secret-token /Users/kathy/private/file.ts?password=123456&ticket=once'
      )
    );

    expect(detail).toContain('Bearer [redacted]');
    expect(detail).toContain('[local-path]');
    expect(detail).not.toContain('secret-token');
    expect(detail).not.toContain('123456');
    expect(detail).not.toContain('once');
    expect(detail.length).toBeLessThanOrEqual(300);
  });

  it('不序列化未知对象或响应体', () => {
    expect(safeStartupDiagnostic({ response: { data: 'secret' } })).toBe(
      'unknown startup error'
    );
  });
});
