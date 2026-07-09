import { findRuleOverlap } from "./site-rules.js";

function ruleKey(item) {
  const type = item.type || "domain";
  const pattern = String(item.pattern || "").trim().toLowerCase();
  return `${type}:${pattern}`;
}

export function detectRuleImportIssues(existingRules, importedItems, { replace = false } = {}) {
  const warnings = [];
  const seen = new Set();
  const baseRules = replace ? [] : existingRules;

  for (let i = 0; i < importedItems.length; i++) {
    const item = importedItems[i];
    const pattern = String(item.pattern || "").trim();
    const type = item.type || "domain";
    const key = ruleKey(item);

    if (!pattern) continue;

    if (seen.has(key)) {
      warnings.push(`文件内重复：第 ${i + 1} 条「${pattern}」`);
      continue;
    }
    seen.add(key);

    const exact = baseRules.find((r) => r.pattern === pattern && r.type === type);
    if (exact && !replace) {
      warnings.push(`已存在相同规则：「${pattern}」`);
    }

    if (type === "domain") {
      const overlap = findRuleOverlap(baseRules, pattern.toLowerCase(), type);
      if (overlap) {
        warnings.push(`「${pattern}」与已有「${overlap}」可能重复`);
      }

      for (let j = 0; j < i; j++) {
        const other = importedItems[j];
        const otherType = other.type || "domain";
        const otherPattern = String(other.pattern || "").trim().toLowerCase();
        if (otherType !== "domain" || otherPattern === pattern.toLowerCase()) continue;
        if (
          pattern.toLowerCase().endsWith(`.${otherPattern}`) ||
          otherPattern.endsWith(`.${pattern.toLowerCase()}`)
        ) {
          warnings.push(`文件内可能重复：「${pattern}」与「${other.pattern}」`);
        }
      }
    }
  }

  return [...new Set(warnings)];
}
