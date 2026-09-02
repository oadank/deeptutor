export const SKILL_NAME_PATTERN = "^[a-z0-9\\u4e00-\\u9fff][a-z0-9\\u4e00-\\u9fff-]{0,63}$";
export const SKILL_NAME_RE = /^[a-z0-9\u4e00-\u9fff][a-z0-9\u4e00-\u9fff-]{0,63}$/;

export function slugifySkillName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fff-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "");
}

export function isValidSkillName(value: string): boolean {
  return SKILL_NAME_RE.test(value);
}
