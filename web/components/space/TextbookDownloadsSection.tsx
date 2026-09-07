"use client";

import { useEffect, useMemo, useState } from "react";
import { BookDown, MapPin, RefreshCw, Search } from "lucide-react";

import SpaceSectionHeader from "@/components/space/SpaceSectionHeader";
import SimpleMarkdownRenderer from "@/components/common/SimpleMarkdownRenderer";
import { getTextbookManifest, type TextbookManifest } from "@/lib/textbook-manifest-api";

/**
 * 教材下载 — 全国通用指南 + 分省版本速查 + 已核实样例。
 *
 * 三层结构：通用层（渠道/方法/怎么查版本，全国一致）→ 速查层（31 省主科
 * 主流版本，点选或搜索自己省份）→ 样例层（运城已核实完整明细）。数据全部
 * 内置后端常量，与本地文件系统零依赖；速查表约九成准，页面明确标注以
 * 学校/本省目录为准。
 */
export default function TextbookDownloadsSection() {
  const [manifest, setManifest] = useState<TextbookManifest | null>(null);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [province, setProvince] = useState<string>("");
  const [query, setQuery] = useState<string>("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setManifest(await getTextbookManifest());
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const names = useMemo(
    () => (manifest ? Object.keys(manifest.provinces).sort((a, b) => a.localeCompare(b, "zh")) : []),
    [manifest],
  );

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return names;
    return names.filter((n) => n.includes(q));
  }, [names, query]);

  const current = manifest && province ? manifest.provinces[province] : null;
  const updatedAt = manifest
    ? new Date(manifest.updated_at * 1000).toLocaleDateString()
    : "";

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6">
      <SpaceSectionHeader
        icon={BookDown}
        title="教材下载"
        description="下载渠道与方法全国通用；先选你的省份查主流教材版本，再按版本逐册下载。"
        action={
          <div className="flex items-center gap-2">
            {manifest && (
              <span className="text-xs text-[var(--muted-foreground)]">
                数据更新 {updatedAt}
              </span>
            )}
            <button
              type="button"
              onClick={() => void load()}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--foreground)] transition hover:bg-[var(--card)]"
              disabled={loading}
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              刷新
            </button>
          </div>
        }
      />

      {loading && !manifest && (
        <div className="py-16 text-center text-sm text-[var(--muted-foreground)]">
          正在加载…
        </div>
      )}

      {error && !manifest && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm text-rose-600 dark:text-rose-400">
          读取失败：{error}
        </div>
      )}

      {manifest && (
        <div className="space-y-6">
          {/* ① 通用层：渠道 / 方法 / 怎么查 */}
          <article className="rounded-2xl border border-[var(--border)]/60 bg-[var(--card)] px-5 py-4 md:px-7 md:py-6">
            <SimpleMarkdownRenderer content={manifest.general_md} />
          </article>

          {/* ② 速查层：省份选择器 */}
          <section className="rounded-2xl border border-[var(--border)]/60 bg-[var(--card)] px-5 py-4 md:px-7 md:py-6">
            <h2 className="flex items-center gap-2 font-serif text-[17px] font-semibold text-[var(--foreground)]">
              <MapPin size={16} className="text-teal-600 dark:text-teal-400" />
              各省主流版本速查
            </h2>
            <p className="mt-1 text-[13px] text-[var(--muted-foreground)]">
              点选省份查看主科版本；省内地市可能分用不同版本，<b>以学校为准</b>。
            </p>

            <div className="mt-3 flex items-center gap-2">
              <div className="relative flex-1">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
                />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索省份，如：山西 / 江苏…"
                  className="w-full rounded-lg border border-[var(--border)] bg-transparent py-1.5 pl-8 pr-3 text-sm text-[var(--foreground)] outline-none focus:border-teal-500/60"
                />
              </div>
              {province && (
                <button
                  type="button"
                  onClick={() => setProvince("")}
                  className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--card)]"
                >
                  清除
                </button>
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {filtered.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setProvince(name)}
                  className={`rounded-full border px-3 py-1 text-xs transition ${
                    province === name
                      ? "border-teal-500/60 bg-teal-500/10 font-medium text-teal-700 dark:text-teal-300"
                      : "border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--card)]"
                  }`}
                >
                  {name}
                </button>
              ))}
              {filtered.length === 0 && (
                <span className="py-2 text-xs text-[var(--muted-foreground)]">
                  没有匹配的省份
                </span>
              )}
            </div>

            {current && (
              <div className="mt-4 rounded-xl border border-teal-500/30 bg-teal-500/5 px-4 py-3">
                <div className="text-sm font-semibold text-[var(--foreground)]">
                  {province}
                </div>
                <dl className="mt-2 space-y-1.5 text-[13px] leading-relaxed">
                  <div className="flex gap-2">
                    <dt className="shrink-0 font-medium text-teal-700 dark:text-teal-300">
                      高中主科
                    </dt>
                    <dd className="text-[var(--foreground)]">{current.hs}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="shrink-0 font-medium text-teal-700 dark:text-teal-300">
                      小学主科
                    </dt>
                    <dd className="text-[var(--foreground)]">{current.ps}</dd>
                  </div>
                </dl>
                <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                  速查表按公开资料整理，个别地市可能有出入；下载前按「怎么查自己地区用什么版本」再核对一次。
                </p>
              </div>
            )}
          </section>

          {/* ③ 样例层：运城已核实 */}
          <details className="group rounded-2xl border border-[var(--border)]/60 bg-[var(--card)] px-5 py-4 md:px-7 md:py-6">
            <summary className="cursor-pointer list-none font-serif text-[17px] font-semibold text-[var(--foreground)]">
              已核实样例：山西运城（完整明细）
              <span className="ml-2 text-xs font-normal text-[var(--muted-foreground)] group-open:hidden">
                点击展开
              </span>
            </summary>
            <div className="mt-4">
              <SimpleMarkdownRenderer content={manifest.sample_md} />
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
