export function validateRulePattern(pattern, type) {
  const trimmed = pattern?.trim() ?? "";
  if (!trimmed) {
    throw new Error("匹配模式不能为空");
  }

  if (type === "regex") {
    try {
      // eslint-disable-next-line no-new
      new RegExp(trimmed);
    } catch (err) {
      throw new Error(`正则表达式无效：${err.message}`);
    }
  }

  if (type === "wildcard" && /[\[\]{}()+^$|\\]/.test(trimmed.replace(/\*/g, ""))) {
    throw new Error("通配符模式仅支持 * 作为通配符");
  }

  return trimmed;
}
