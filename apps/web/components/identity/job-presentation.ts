import { identityMessage } from './client';
const explanations: Record<string, string> = {
  AI_SNAPSHOT_REQUIRED: '没有可复用的模型快照，请核对当前配置后新建运行。',
  AI_LEGACY_CONFIGURATION_REQUIRED: '旧模型配置尚未迁入 AI 中心，请完成配置后新建运行。',
  RUN_REQUEST_INCOMPATIBLE: '旧输入契约需要检查，不能直接重放。',
  RUN_QUEUE_NOT_TERMINAL: '队列中的上一项仍在等待或执行，请刷新核对后再操作。',
  RUN_NOT_RETRYABLE: '此运行当前不允许按原配置重试。',
  RUN_NOT_TERMINAL: '此运行尚未结束，请等待当前任务完成。',
  AI_CREDENTIAL_UNAVAILABLE: '原凭据已撤销、过期或不可用，请更新配置。',
  AI_SCOPE_DISABLED: '作答账号或所属学校已停用，或所属范围发生变化。',
  MODEL_AUTH_FAILED: '供应商认证失败，请核对对应凭据版本。',
  MODEL_NOT_FOUND: '供应商没有找到该模型，请核对模型 ID。',
  MODEL_RATE_LIMIT: '供应商限流，请查看调用记录和重试状态。',
  MODEL_TIMEOUT: '模型响应超时，计费状态可能未知，请先核对调用记录。',
  MODEL_UNAVAILABLE: '模型连接中断或不可达，请核对服务状态。',
  MODEL_REFUSED: '模型拒绝了请求，未生成可用建议。',
  MODEL_TRUNCATED: '模型响应被截断，请核对输出 Token 上限。',
  MODEL_STOP_UNSUPPORTED: '模型未正常结束输出，响应不可直接使用。',
  MODEL_RESPONSE_INVALID: '模型响应格式不符合契约，请查看安全诊断。',
  INVALID_JSON: '模型未返回合法 JSON，结果未进入正式评分。',
  AI_DAILY_BUDGET_LIMIT: '当前调用额度已用完，请核对模块和供应商限制。',
  AI_CONCURRENCY_LIMIT: '并发调用已达上限，请稍后核对任务状态。',
  AI_BUDGET_UNAVAILABLE: '调用额度服务暂不可用，请检查 Redis 状态。',
  GRADING_INVALID_OR_FAILED: '批改结果未通过校验或执行失败，正式成绩未改变。',
  LEASE_EXPIRED: '执行租约已过期，服务正在恢复或已达到重试上限。',
  SECRET_KEY_UNAVAILABLE: '服务器缺少该凭据的解密主密钥，请联系部署管理员。',
  DIAGNOSTIC_UNAVAILABLE: '该错误没有可安全展示的摘要，请按运行编号核查。',
};
export function jobMessage(code: string | null | undefined): string {
  if (!code) return '无错误';
  return (
    explanations[code] ??
    (/^PROVIDER_HTTP_\d{3}$/.test(code)
      ? '供应商返回 HTTP 错误，请核对调用记录（' + code + '）。'
      : identityMessage(code) === code
        ? '执行受阻，请核对配置和调用记录（' + code + '）。'
        : identityMessage(code))
  );
}
