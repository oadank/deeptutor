"use client";

import dynamic from "next/dynamic";
import { UsageFooter } from "./UsageFooter";
import { cumulativeMessageUsage, messageUsage } from "./usage-summary";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  BookMarked,
  BookOpen,
  Bot,
  Brain,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Copy,
  AlertCircle,
  Database,
  Loader2,
  MessageSquare,
  Pencil,
  RefreshCcw,
  Square,
  UserRound,
  UsersRound,
  Volume2,
  X,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SelectedHistorySession } from "@/components/chat/HistorySessionPicker";
import type { SelectedQuestionEntry } from "@/components/chat/QuestionBankPicker";
import { ActivityFold, FoldCaret } from "@/components/activity";
import AssistantResponse from "@/components/common/AssistantResponse";
import {
  InlineFileCardProvider,
  mergeGeneratedFiles,
} from "@/components/common/InlineFileCard";
import Tooltip from "@/shared/ui/Tooltip";
import type {
  MessageAttachment,
  MessageRequestSnapshot,
} from "@/features/chat/ChatStateAdapter";
import { apiFetch, apiUrl } from "@/lib/api";
import { docIconFor } from "@/lib/doc-attachments";
import { useVoiceAutoplay } from "@/hooks/useVoiceAutoplay";
import { extractMathAnimatorResult } from "@/lib/math-animator-types";
import {
  extractQuizQuestions,
  extractQuizTurnId,
  extractStreamingQuizQuestions,
} from "@/lib/quiz-types";
import { extractVisualizeResult } from "@/lib/visualize-types";
import type { StreamEvent } from "@/features/chat/model/protocol";
import { hasVisibleMarkdownContent } from "@/lib/markdown-display";
import type { SelectedBookReference } from "@/lib/book-references";
import { buildVisiblePath, type SiblingInfo } from "@/lib/message-branches";
import { turnAnchorKey } from "@/lib/chat-outline";
import { readingPassageHref } from "@/lib/reading-citations";
import { shouldSubmitOnEnter } from "@/lib/composer-keyboard";
import { useImeComposing } from "@/lib/use-ime-composing";
import type { SpaceMemoryFile } from "@/lib/space-items";
import {
  AskUserOptions,
  extractAskUserPayload,
  extractMessageSegments,
  leadingTraceEvents,
  type MessageSegment,
} from "@/components/chat/home/AskUserOptions";
import { MasteryQuestionCard } from "@/components/chat/home/MasteryQuestionCard";
import {
  collectMasteryGrades,
  collectMasterySkips,
  extractMasteryQuestion,
  type MasteryGradeResult,
  type MasteryQuestion,
} from "@/lib/mastery-question";
import { SetupCredentialCard } from "@/components/chat/home/SetupCredentialCard";
import { extractSetupCredential } from "@/lib/setup-signals";
import { PartnerDraftCard } from "@/components/chat/home/PartnerDraftCard";
import { extractPartnerDraft } from "@/lib/partner-draft";
import { CourseHandoffCards } from "@/components/chat/home/CourseHandoffCard";
import { MasteryHandoffCards } from "@/components/chat/home/MasteryHandoffCard";
import {
  extractCourseHandoffs,
  stripLeakedHandoffJson,
} from "@/lib/course-handoff";
import { extractMasteryHandoffs } from "@/lib/mastery-handoff";
import ContextReferenceTree, {
  type ContextTreeItem,
} from "@/components/chat/home/ContextReferenceTree";
import {
  AssistantActivity,
  NestedTraceFlow,
  TraceFlow,
} from "@/features/chat/trace/TracePresentation";
import { hasSettledFinalRound } from "@/features/chat/trace/selectors";
import type { MessageTraceMetadata } from "@/features/chat/trace/memory";
import { agentGlyph } from "@/components/agents/agent-icons";
import { useConsultationReference } from "@/hooks/useConsultationReference";
import { useConnectedAgentKinds } from "@/hooks/useConnectedAgentKinds";
import {
  authoritativeResearchReport,
  isConfirmedResearchFollowup,
  researchFollowupStatus,
} from "@/lib/deep-research-report";

const MathAnimatorViewer = dynamic(
  () => import("@/components/math-animator/MathAnimatorViewer"),
  { ssr: false },
);
const QuizViewer = dynamic(() => import("@/components/quiz/QuizViewer"), {
  ssr: false,
});

const ResearchOutlineEditor = dynamic(
  () => import("@/components/research/ResearchOutlineEditor"),
  { ssr: false },
);
const VisualizationViewer = dynamic(
  () => import("@/components/visualize/VisualizationViewer"),
  { ssr: false },
);


interface ChatMessageItem {
  id?: number;
  role: "user" | "assistant" | "system";
  content: string;
  capability?: string;
  events?: StreamEvent[];
  trace?: MessageTraceMetadata;
  attachments?: MessageAttachment[];
  requestSnapshot?: MessageRequestSnapshot;
  parentMessageId?: number | null;
  /** [local patch 2026-09-03] 消息时间戳（秒级 epoch；后端字段 created_at）。 */
  createdAt?: number | null;
}

interface NotebookReferenceGroup {
  notebookId: string;
  notebookName: string;
  count: number;
}

const MODE_BADGE_LABELS: Record<string, string> = {
  chat: "Chat",
  ask_questions: "Ask Questions",
  deep_solve: "Deep Solve",
  deep_question: "Quiz Generation",
  deep_research: "Deep Research",
  math_animator: "Math Animator",
  visualize: "Visualize",
  mastery_path: "Mastery Path",
  immersive_reading: "Immersive Reading",
};

// Returns the i18n key (and a sensible fallback) for the capability badge
// shown above the user's message. Callers must run `t(...)` on the result.
// Exported so the turn navigator's hover card labels a turn with exactly
// the same wording the bubble carries.
//
// A capability with no entry is title-cased rather than printed raw: an
// unlisted mode used to surface its internal id ("immersive_reading") in the
// conversation, which reads as a bug to everyone who sees it.
/**
 * What a run of working-out actually contains, for the memo below.
 *
 * Prose is identified by its length rather than its text because a streamed
 * segment only ever grows; a run of steps by how many events it holds.
 *
 * ``settled`` says a turn has moved on to writing its answer, and then only
 * the shape matters. The region a turn is working in stays open in the event
 * stream and keeps absorbing everything that arrives, so a finished run of
 * steps went on counting the answer's own deltas — 3300 events for a trace
 * drawing two rows — and reported itself as changed on every one of them.
 * Nothing below the answer can alter the working-out above it: a new round
 * would take the answer back into the process, which moves the shape.
 */
/**
 * The width of an ActivityRow's mark column: the 15px dot cell, the 10px gap
 * after it, and the 2px the stack insets itself by. Pulling a row left by
 * this lands its text on the same edge as the prose around it.
 */
const ROW_GUTTER = 27;

function processContentKey(
  segments: MessageSegment[],
  settled: boolean,
): string {
  return segments
    .map((seg) =>
      seg.kind === "ask_user"
        ? `q${seg.key}:${JSON.stringify(seg.data)}`
        : settled
          ? seg.key
          : seg.kind === "text"
            ? `t${seg.key}:${seg.text.length}`
            : seg.kind === "trace"
              ? `r${seg.key}:${seg.events.length}`
              : seg.key,
    )
    .join("|");
}

/**
 * Prose and the steps it introduced, in the order they were written.
 *
 * Spacing is owned here rather than left to each piece. Markdown carries a
 * bottom margin and the trace rows carried only a top one, so a row sat 24px
 * below the sentence that introduced it and flush against the one that
 * followed — reading as a heading for the next paragraph instead of as the
 * step between them. Both margins are stripped and one gap governs the whole
 * column, so the rhythm is even whichever way you read it.
 *
 * Alignment is owned here too, for the same reason. A trace row carries its
 * own mark column, so its text started {@link ROW_GUTTER}px right of the
 * prose above it and the column had four left edges inside 42px — the rule,
 * the prose, the dots, the row text. Read down it, every other line stepped
 * sideways. The rows are pulled back by exactly that gutter instead, which
 * leaves two edges: one content edge that prose and steps share, and the
 * dots hanging in the margin beside it, which is what a bullet gutter is.
 *
 * Memoized on what it holds rather than on the props it is handed.
 * ``messageSegments`` is rebuilt from scratch on every streamed delta, so the
 * working-out — which stops changing the moment a turn starts writing its
 * answer — arrived as a brand-new element tree on every frame of that answer.
 * React cannot skip a subtree whose elements it has never seen, so the whole
 * trace re-rendered for the answer's full length: profiled over one 35s turn,
 * 2905 renders costing 10.3s, none of which changed a pixel.
 *
 * ``events`` is deliberately left out of the comparison. It is read only to
 * verify reading-material locators, and anything that could verify one is a
 * tool call — which lands in a run of steps and moves the key on its own.
 */
const ProcessBody = memo(
  function ProcessBody({
    segments,
    events,
    language,
    isStreaming,
    readingMaterialId,
    readingMaterialRevision,
  }: {
    segments: MessageSegment[];
    events: StreamEvent[];
    /** The turn has moved on to its answer, so this run is finished. */
    settled: boolean;
    language?: string;
    isStreaming?: boolean;
    readingMaterialId?: string;
    readingMaterialRevision?: number;
  }) {
    return (
      <div
        className="flex flex-col gap-3"
        // The padding is the content edge — where prose starts and where a
        // row's text is pulled back to. Wide enough to hold the dots.
        style={{ paddingLeft: ROW_GUTTER }}
      >
        {segments.map((seg) =>
          seg.kind === "text" ? (
            <div key={seg.key} className="[&_.md-renderer>*:last-child]:mb-0">
              <AssistantResponse
                content={seg.text}
                language={language}
                isStreaming={isStreaming}
                readingMaterialId={readingMaterialId}
                readingMaterialRevision={readingMaterialRevision}
                events={events}
              />
            </div>
          ) : seg.kind === "trace" ? (
            <div
              key={seg.key}
              className="[&>div]:mb-0"
              style={{ marginLeft: -ROW_GUTTER }}
            >
              <TraceFlow events={seg.events} isStreaming={isStreaming} />
            </div>
          ) : seg.kind === "ask_user" && seg.data.resolved ? (
            <AskUserOptions
              key={seg.key}
              data={seg.data}
              onSubmit={() => false}
            />
          ) : null,
        )}
      </div>
    );
  },
  (a, b) =>
    a.language === b.language &&
    a.isStreaming === b.isStreaming &&
    a.settled === b.settled &&
    a.readingMaterialId === b.readingMaterialId &&
    a.readingMaterialRevision === b.readingMaterialRevision &&
    processContentKey(a.segments, a.settled) ===
      processContentKey(b.segments, b.settled),
);

/**
 * A run of working-out that folds itself away.
 *
 * Used for the runs that follow a card — the leading run rides in the
 * message's activity header instead, which is already a disclosure and
 * already pinned at the top, so the common turn shows one line of chrome
 * rather than two.
 */
function ProcessFold({
  segments,
  settled,
  children,
}: {
  segments: MessageSegment[];
  /** The turn has moved on: fold by default, and say what is inside. */
  settled: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? !settled;
  const toolCalls = countProcessToolCalls(segments);

  return (
    <div className="mb-3">
      {/* Same shape as the activity header this fold echoes: the label first,
          the caret after it. The header has an orb holding the left column,
          so a leading caret here would make the two controls read as two
          different kinds of thing. */}
      <button
        type="button"
        onClick={() => setUserOpen(!open)}
        aria-expanded={open}
        className="group/act flex items-center gap-2 text-left text-[12px] font-medium text-[var(--muted-foreground)]/55 transition-colors hover:text-[var(--foreground)]"
      >
        {toolCalls > 0
          ? t("{{count}} tool calls", { count: toolCalls })
          : t("Working notes")}
        <FoldCaret open={open} />
      </button>
      <ActivityFold open={open}>
        <div className="pt-1">{children}</div>
      </ActivityFold>
    </div>
  );
}

/**
 * One row of the assistant message: a run of working-out, a card, or answer
 * prose. Cards and the answer stand on their own; a process run is what the
 * turn did before either of them and folds away once the turn has settled.
 */
type MessageBlock =
  | { kind: "process"; key: string; segments: MessageSegment[] }
  | { kind: "card"; key: string; segment: MessageSegment }
  | { kind: "answer"; key: string; segment: MessageSegment };

/**
 * Split a message into its blocks.
 *
 * A mastery question ends its turn, so the prose introducing it is teaching,
 * not commentary awaiting a later answer. Keep that text outside the fold as
 * well as the card. Earlier exploration and any intervening tool rows still
 * fold normally. Answered clarifications belong to the same process as the
 * work before and after them; only pending cards stand outside the fold.
 */
function buildMessageBlocks(
  segments: MessageSegment[],
  answerStart: number,
): MessageBlock[] {
  const teaching = new Set<number>();
  segments.forEach((segment, index) => {
    if (segment.kind !== "mastery_question") return;
    let before = index - 1;
    // Recording a grade or updating state can share the round with the quiz.
    // Those rows do not turn the preceding teaching into working notes.
    while (before >= 0 && segments[before].kind === "trace") before -= 1;
    while (before >= 0 && segments[before].kind === "text") {
      teaching.add(before);
      before -= 1;
    }
  });
  const blocks: MessageBlock[] = [];
  let run: MessageSegment[] = [];
  const flush = () => {
    if (!run.length) return;
    blocks.push({ kind: "process", key: `p-${run[0].key}`, segments: run });
    run = [];
  };
  segments.slice(0, answerStart).forEach((segment, index) => {
    if (
      (segment.kind === "ask_user" && !segment.data.resolved) ||
      segment.kind === "mastery_question"
    ) {
      flush();
      blocks.push({ kind: "card", key: segment.key, segment });
      return;
    }
    if (teaching.has(index)) {
      flush();
      blocks.push({ kind: "answer", key: segment.key, segment });
      return;
    }
    run.push(segment);
  });
  flush();
  segments.slice(answerStart).forEach((segment) => {
    blocks.push({ kind: "answer", key: segment.key, segment });
  });
  return blocks;
}

/**
 * How many steps a run of working-out took, for the line that names it.
 *
 * Steps only. Counting the paragraphs of commentary alongside them read as a
 * measure of how much was said rather than how much was done, which is the
 * thing a reader is deciding whether to open.
 */
function countProcessToolCalls(segments: MessageSegment[]): number {
  let toolCalls = 0;
  for (const segment of segments) {
    if (segment.kind !== "trace") continue;
    for (const event of segment.events) {
      if (event.type === "tool_call") toolCalls += 1;
    }
  }
  return toolCalls;
}

export function getModeBadgeLabel(capability?: string | null): string {
  if (!capability) return MODE_BADGE_LABELS.chat;
  const known = MODE_BADGE_LABELS[capability];
  if (known) return known;
  return capability
    .split("_")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function imageSrcForAttachment(attachment: MessageAttachment): string | null {
  if (attachment.url) {
    if (
      attachment.url.startsWith("http") ||
      attachment.url.startsWith("blob:") ||
      attachment.url.startsWith("data:")
    ) {
      return attachment.url;
    }
    return apiUrl(attachment.url);
  }

  const base64 = attachment.base64?.trim();
  if (!base64) return null;
  if (base64.startsWith("data:")) return base64;
  return `data:${attachment.mime_type || "image/png"};base64,${base64}`;
}

/** Format a byte count for a file card subtitle (e.g. "14 KB"). */
function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

/** "DeepTutor_Introduction.pdf" → "DeepTutor Introduction" — the card title
 * reads like a document name; the extension already shows in the subtitle. */
function humanizeFilename(filename: string): string {
  const stem = filename.replace(/\.[A-Za-z0-9]{1,8}$/, "");
  return (
    stem
      .replace(/[_-]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim() || filename
  );
}

/**
 * Files the assistant produced this turn (exec/code/media artifacts),
 * rendered as openable cards under the message — click to open in the Viewer
 * side panel, same path as user uploads. Sources: persisted ``generated``
 * attachments on the message (durable) merged with artifacts from streamed
 * tool_result events (live, while the turn is still running), deduped by URL.
 */
export function GeneratedFileCards({
  attachments,
  events,
  onOpen,
}: {
  attachments: MessageAttachment[];
  events?: StreamEvent[];
  onOpen?: (attachment: MessageAttachment) => void;
}) {
  const { t } = useTranslation();
  const files = useMemo(
    () => mergeGeneratedFiles(attachments, events),
    [attachments, events],
  );
  if (!files.length) return null;
  return (
    <div className="mt-3 flex flex-col gap-2">
      {files.map((a, i) => {
        const filename = a.filename || t("File");
        const key = a.workspace_item_id || a.id || a.url || `gen-${i}`;
        const mime = a.mime_type || "";
        const mediaSrc = imageSrcForAttachment(a);
        const caption = a.caption?.trim() || "";

        // Generated media renders inline; other MIME types use a file card.
        if (mime.startsWith("image/") && mediaSrc) {
          return (
            <button
              key={key}
              type="button"
              onClick={onOpen ? () => onOpen(a) : undefined}
              className="group block w-full max-w-[min(520px,90%)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] text-left shadow-sm transition hover:border-[var(--border)]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={mediaSrc}
                alt={filename}
                loading="lazy"
                className="block max-h-[360px] w-full bg-[var(--background)] object-contain"
              />
              <span className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-medium text-[var(--foreground)]">
                    {a.title || humanizeFilename(filename)}
                  </span>
                  {caption ? (
                    <span className="block truncate text-[11px] text-[var(--muted-foreground)]">
                      {caption}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[11px] text-[var(--muted-foreground)] transition group-hover:text-[var(--foreground)]">
                  {t("Open")}
                </span>
              </span>
            </button>
          );
        }

        if (mime.startsWith("video/") && mediaSrc) {
          return (
            <div
              key={key}
              className="w-full max-w-[min(520px,90%)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-sm"
            >
              <video
                src={mediaSrc}
                controls
                preload="metadata"
                className="block max-h-[360px] w-full bg-black"
              />
              <button
                type="button"
                onClick={onOpen ? () => onOpen(a) : undefined}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition hover:bg-[var(--muted)]/30"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-medium text-[var(--foreground)]">
                    {a.title || humanizeFilename(filename)}
                  </span>
                  {caption ? (
                    <span className="block truncate text-[11px] text-[var(--muted-foreground)]">
                      {caption}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[11px] text-[var(--muted-foreground)]">
                  {t("Open")}
                </span>
              </button>
            </div>
          );
        }

        // [local patch 2026-09-02] TTS 语音横幅：audio 附件内嵌播放条（语音块场景）。
        if (mime.startsWith("audio/") && mediaSrc) {
          return (
            <div key={key} className="w-full max-w-[min(520px,90%)]">
              {/* transcript = AI 自己写的口语稿（后端合成时存进附件的），
                  必须传进来横幅才会显示这段文字 + 复制按钮 */}
              <VoiceBanner
                src={mediaSrc}
                label="语音回复"
                transcript={a.transcript}
              />
            </div>
          );
        }

        const spec = docIconFor(filename);
        const Icon = spec.Icon;
        const size = formatFileSize(a.size_bytes);
        return (
          <button
            key={key}
            type="button"
            onClick={onOpen ? () => onOpen(a) : undefined}
            className="group flex w-full max-w-[min(520px,90%)] items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-left shadow-sm transition hover:border-[var(--border)] hover:bg-[var(--muted)]/30"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--background)]">
              <Icon className={`h-[18px] w-[18px] ${spec.tint}`} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-[var(--foreground)]">
                {a.title || humanizeFilename(filename)}
              </span>
              <span className="block text-[11px] text-[var(--muted-foreground)]">
                {caption || spec.label}
                {size ? ` · ${size}` : ""}
              </span>
            </span>
            <span className="shrink-0 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--foreground)] transition group-hover:bg-[var(--muted)]/40">
              {t("Open")}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export const AssistantMessage = memo(function AssistantMessage({
  msg,
  isStreaming,
  outlineStatus,
  sessionId,
  language,
  onConfirmOutline,
  onSubmitUserReply,
  onAnswerMasteryQuestion,
  onSkipMasteryQuestion,
  researchRequestSnapshot,
  onTraceToggle,
  masteryGrades,
  masterySkips,
}: {
  msg: {
    id?: number;
    content: string;
    capability?: string;
    events?: StreamEvent[];
    trace?: MessageTraceMetadata;
  };
  isStreaming?: boolean;
  /**
   * Every mastery verdict in the conversation, by question id. Collected once
   * for the whole list because a question answered in the composer is graded a
   * turn later than it was posed, and its card should still show the answer.
   */
  masteryGrades?: Map<string, MasteryGradeResult>;
  /** Every question the learner dropped, by id — collected the same way and
   *  for the same reason: the skip lands on a later turn than the card. */
  masterySkips?: Set<string>;
  outlineStatus?: "editing" | "researching" | "done" | "failed";
  sessionId?: string | null;
  language?: string;
  researchRequestSnapshot?: MessageRequestSnapshot | null;
  /** Notified when a persisted trace is opened or collapsed. Takes the id so
   *  the list can hand one callback to every row — see ``handleTraceToggle``. */
  onTraceToggle?: (messageId: number, open: boolean) => void;
  onConfirmOutline?: (
    outline: Array<{ title: string; overview: string }>,
    topic: string,
    researchConfig?: Record<string, unknown> | null,
    requestSnapshot?: MessageRequestSnapshot | null,
  ) => void;
  /**
   * Submit a reply for a turn that is paused on ``ask_user``. Wired
   * through from the page so the card's option-buttons / free-text
   * input can deliver the user's selection back to the backend over
   * the unified WebSocket. Triggers a same-turn resume (no new user
   * bubble). Accepts either a flat string (legacy single-question) or
   * a structured object with per-question ``answers`` (v2 path).
   */
  onSubmitUserReply?: (
    reply:
      | string
      | {
          text?: string;
          answers?: Array<{ questionId: string; text: string }>;
        },
  ) => void | boolean | Promise<void | boolean>;
  /**
   * Answer a mastery question card. Unlike ``onSubmitUserReply`` this does
   * NOT resume a paused turn — posing a mastery question ends its turn, so
   * the answer starts the next one, exactly as typing it would. That is what
   * keeps the learner free to answer, ask something else, or come back later.
   */
  onAnswerMasteryQuestion?: (answer: {
    questionId: string;
    text: string;
  }) => void | boolean | Promise<void | boolean>;
  /** Drop a question the learner does not want to answer. Same turn-starting
   *  shape as answering it, because the engine holds one open question per
   *  path: without this the tutor's next question is this same one again. */
  onSkipMasteryQuestion?: (
    questionId: string,
  ) => void | boolean | Promise<void | boolean>;
}) {
  const { t } = useTranslation();
  const events = useMemo(() => msg.events ?? [], [msg.events]);
  const readingMaterialId = researchRequestSnapshot?.readingMaterialId;
  const readingMaterialRevision =
    researchRequestSnapshot?.readingMaterialRevision;
  const resultEvent = useMemo(
    () => msg.events?.find((event) => event.type === "result") ?? null,
    [msg.events],
  );

  const outlinePreview = useMemo(() => {
    if (msg.capability !== "deep_research" || !resultEvent) return null;
    const meta = resultEvent.metadata as Record<string, unknown> | undefined;
    if (!meta?.outline_preview) return null;
    return {
      sub_topics: (meta.sub_topics ?? []) as Array<{
        title: string;
        overview: string;
      }>,
      topic: String(meta.topic ?? ""),
      research_config: (meta.research_config ?? null) as Record<
        string,
        unknown
      > | null,
    };
  }, [msg.capability, resultEvent]);

  const quizQuestions = useMemo(() => {
    if (msg.capability !== "deep_question") return null;
    // Once the final result event lands, it's authoritative — it carries
    // the canonical summary.results[]. Until then, accumulate questions
    // from the live ``quiz_question_emitted`` content events so the
    // QuizViewer can render each card the moment it's generated.
    if (resultEvent) return extractQuizQuestions(resultEvent.metadata);
    return extractStreamingQuizQuestions(msg.events ?? []);
  }, [msg.capability, msg.events, resultEvent]);

  // Turn identity for the quiz card. Derived from the streamed events, not
  // just the final result event — during generation the result hasn't landed
  // yet, and a null turn id would let the QuizViewer fall back to
  // session-wide notebook state from a previous quiz (issue #677).
  const quizTurnId = useMemo(() => {
    if (msg.capability !== "deep_question") return null;
    return extractQuizTurnId(msg.events);
  }, [msg.capability, msg.events]);

  const mathAnimatorResult = useMemo(() => {
    if (msg.capability !== "math_animator" || !resultEvent) return null;
    return extractMathAnimatorResult(resultEvent.metadata);
  }, [msg.capability, resultEvent]);

  const visualizeResult = useMemo(() => {
    if (msg.capability !== "visualize" || !resultEvent) return null;
    return extractVisualizeResult(resultEvent.metadata);
  }, [msg.capability, resultEvent]);

  // Detect the ``ask_user`` terminator payload: when the assistant turn
  // ended via the ``ask_user`` tool, this is the question the user is
  // expected to answer next. Render option chips below the message.
  const askUserPayload = useMemo(
    () => extractAskUserPayload(msg.events, { streaming: isStreaming }),
    [msg.events, isStreaming],
  );
  // A graded mastery question travels on the same pause channel as a
  // clarifying one: the study card that renders it shows the objective, the
  // attempt and the verdict, none of which the generic card has anywhere to
  // put.
  //
  // Only the last one is read here, for the surfaces that pin a single card
  // below the body. The default surface renders a card per segment instead —
  // a turn resumes on this same message after every answer, so working one
  // objective leaves a run of questions, and each card must show the question
  // it actually asked.
  const latestMasteryQuestion = useMemo(
    () => extractMasteryQuestion(msg.events),
    [msg.events],
  );
  // ``false`` — never a silent no-op — so a card with nowhere to send its
  // answer reopens instead of spinning forever. See ``submitUserReply``.
  const submitReply = useCallback(
    (reply: {
      text?: string;
      answers?: Array<{ questionId: string; text: string }>;
    }) => (onSubmitUserReply ? onSubmitUserReply(reply) : false),
    [onSubmitUserReply],
  );
  // The card is answered by sending the next message, so "already answered"
  // cannot come from a resolved pause any more — the turn that posed it is
  // long over. The verdict is the durable signal, and it survives a reload.
  const renderMasteryCard = useCallback(
    (question: MasteryQuestion) => {
      const grade = masteryGrades?.get(question.questionId) ?? null;
      return (
        <MasteryQuestionCard
          question={question}
          grade={grade}
          answered={Boolean(grade)}
          skipped={masterySkips?.has(question.questionId) ?? false}
          submittedAnswer={grade?.learnerAnswer ?? ""}
          onSubmit={({ text }) =>
            onAnswerMasteryQuestion
              ? onAnswerMasteryQuestion({
                  questionId: question.questionId,
                  text: String(text ?? ""),
                })
              : false
          }
          onSkip={onSkipMasteryQuestion}
        />
      );
    },
    [
      masteryGrades,
      masterySkips,
      onAnswerMasteryQuestion,
      onSkipMasteryQuestion,
    ],
  );
  // Set by ``request_credential`` when a configuration step needs a secret the
  // assistant must not handle itself.
  const setupCredential = useMemo(
    () => extractSetupCredential(msg.events),
    [msg.events],
  );

  const partnerDraft = useMemo(
    () => extractPartnerDraft(msg.events),
    [msg.events],
  );

  // Set by ``course_handoff`` when Course Study has decided what is worth doing
  // next. A turn may propose more than one, so this is a list.
  const courseHandoffs = useMemo(
    () => extractCourseHandoffs(msg.events),
    [msg.events],
  );

  // Set by the mastery navigation tools when the learner asked to be taken
  // back to something they are studying. Same shape of offer as above — a
  // destination, a reason, an editable opening line — for the surface that
  // actually teaches it.
  const masteryHandoffs = useMemo(
    () => extractMasteryHandoffs(msg.events),
    [msg.events],
  );

  // Some models write the hand-off out as literal JSON *and* call the tool, so
  // the card's own contents appear above it as raw arguments. Only stripped
  // once the turn is finished — mid-stream the text is still arriving and a
  // partial object would not match anyway — and only from a message that really
  // produced a card.
  const body = useMemo(() => {
    const raw =
      courseHandoffs.length && !isStreaming
        ? stripLeakedHandoffJson(msg.content)
        : msg.content;
    // [local patch 2026-09-02] 语音契约：正文不显示 [[voice]] 块（口语文本已
    // 由系统转成语音横幅）。流式/落库统一在显示层剥离。
    return raw.replace(/\[\[voice\]\][\s\S]*?\[\[\/voice\]\]/g, "").trim();
  }, [courseHandoffs.length, isStreaming, msg.content]);

  // Interleaved segments for the default chat surface: the message is laid
  // out in the order it was written — what DeepTutor said it was about to do,
  // the work it then did, what it found, and so on down to the closing answer.
  // Only walked when this message will actually render through the default
  // branch (the research / quiz / animator / visualize branches have their own
  // layout and pin their cards elsewhere).
  const useInlineSegments =
    !outlinePreview &&
    !mathAnimatorResult &&
    !visualizeResult &&
    !(quizQuestions && quizQuestions.length > 0);
  const messageSegments = useMemo(
    () =>
      useInlineSegments
        ? extractMessageSegments(msg.events, msg.content, {
            streaming: isStreaming,
          })
        : [],
    [useInlineSegments, msg.events, msg.content, isStreaming],
  );
  // Either card kind: a clarifying ask_user, or a posed mastery question.
  const hasInlineCards =
    useInlineSegments &&
    messageSegments.some(
      (seg) => seg.kind === "ask_user" || seg.kind === "mastery_question",
    );
  // Lay the body out from the segments whenever there is more to place than
  // one run of prose. A message with nothing but text gets the plain body
  // branch below, which is the same thing with less machinery.
  const useSegmentLayout =
    useInlineSegments && messageSegments.some((seg) => seg.kind !== "text");
  // Every trace row now renders inline, where the work happened. The header
  // block keeps its status line and nothing else — leaving rows up there too
  // would show each step twice.
  const headerTraceEvents = useMemo(
    () =>
      useSegmentLayout ? leadingTraceEvents(events, messageSegments) : undefined,
    [useSegmentLayout, messageSegments, events],
  );

  // Where the working-out stops and the answer starts.
  //
  // Everything a turn writes is worth watching while it works, and almost
  // none of it is worth re-reading afterwards. So the two are separate
  // layers: the process stays open and streams live, then folds itself into
  // one line the moment the turn settles into its closing answer.
  //
  // The boundary is the trailing run of prose — the text after the last step —
  // and it is structural, not timed: whatever is being written right now is
  // always placed as the answer, from its first character.
  // Teaching before a mastery question is also answer prose; the block
  // builder preserves it separately because that card ends the turn.
  //
  // Waiting for the terminal round before promoting it is what an earlier cut
  // did, and it meant the closing answer streamed INSIDE the collapsible
  // process and jumped out of it once finished. That leaks a question the
  // reader should never have been asked to hold — "is this the answer yet?" —
  // and it is a question we cannot answer at that point anyway: a round only
  // reveals whether it called tools after its prose is complete.
  //
  // Placing it optimistically inverts which case pays. Commentary is demoted
  // into the process when its round turns out to have called a tool, and that
  // costs one 14px slide at the exact moment the tool row appears below it —
  // motion that reads as the two being grouped. The answer, which is the text
  // the reader actually came for, never moves at all.
  const answerStart = useMemo(() => {
    let idx = messageSegments.length;
    while (idx > 0 && messageSegments[idx - 1].kind === "text") idx -= 1;
    return idx;
  }, [messageSegments]);
  // A turn that has started writing its answer is no longer changing the
  // working-out above it, which is what lets that whole subtree stop
  // re-deriving itself on every delta. Structural, like the boundary: if a new
  // round starts, the answer goes back into the process and this goes false.
  const processSettled = answerStart < messageSegments.length;
  // Separately again: whether the working-out folds itself away. This is the
  // one thing that does need the terminal-round signal, since it is the claim
  // that there is no more work coming at all.
  const settledIntoAnswer = !isStreaming || hasSettledFinalRound(events);
  // Pending questions stay outside the disclosure so they remain answerable.
  // Once answered, a clarification joins the surrounding process so resumed
  // work continues under the original activity header.
  const messageBlocks = useMemo(
    () => buildMessageBlocks(messageSegments, answerStart),
    [messageSegments, answerStart],
  );
  // The leading run rides in the activity header, which is already pinned at
  // the top and already is a disclosure — giving it the process keeps the
  // message to ONE line of chrome instead of a status line plus a fold.
  // Only the segment layout hands its process to the header; a message with
  // nothing but prose renders through the plain body branch below, which would
  // otherwise draw the same opening sentence a second time.
  const headerProcess =
    useSegmentLayout && messageBlocks[0]?.kind === "process"
      ? messageBlocks[0]
      : null;
  const bodyBlocks = headerProcess ? messageBlocks.slice(1) : messageBlocks;

  const renderSegments = useCallback(
    (segments: MessageSegment[]) => (
      <ProcessBody
        segments={segments}
        events={events}
        settled={processSettled}
        language={language}
        isStreaming={isStreaming}
        readingMaterialId={readingMaterialId}
        readingMaterialRevision={readingMaterialRevision}
      />
    ),
    [
      language,
      isStreaming,
      readingMaterialId,
      readingMaterialRevision,
      events,
      processSettled,
    ],
  );
  const headerProcessSummary = useMemo(() => {
    if (!headerProcess) return undefined;
    const toolCalls = countProcessToolCalls(headerProcess.segments);
    return toolCalls > 0
      ? t("{{count}} tool calls", { count: toolCalls })
      : undefined;
  }, [headerProcess, t]);

  const researchInProgress =
    outlineStatus === "researching" ||
    outlineStatus === "done" ||
    outlineStatus === "failed";
  const showResearchBody =
    Boolean(outlinePreview) && researchInProgress && Boolean(msg.content);

  return (
    <>
      {/* Activity block pinned to the TOP: the status header
          ("DeepTutor Exploring… · 8s" → "DeepTutor responded. · 10s") with
          the exploring trace nested beneath it — expanded while DeepTutor is
          still working, collapsed once it settles into the final answer. */}
      <AssistantActivity
        events={events}
        traceEvents={headerTraceEvents}
        isStreaming={isStreaming}
        content={msg.content}
        // ``events`` is a preview of a persisted turn — the events marking
        // where it began are not in it — so the header times the turn from
        // this span instead of from what survived the preview.
        traceBounds={msg.trace}
        // The settled preview drops ``thinking``, which for a round that
        // called no tools is the whole trace. Say that the server still holds
        // it, so the header stays openable and the click can fetch it.
        hasStoredTrace={Boolean(
          msg.trace?.turn_id &&
            (msg.trace?.truncated ||
              (msg.trace?.total ?? 0) > (msg.events?.length ?? 0)),
        )}
        className="mb-3"
        onTraceToggle={
          msg.id != null && msg.trace?.turn_id
            ? (open) => onTraceToggle?.(msg.id as number, open)
            : undefined
        }
        // The turn's working-out, folded behind this same header. One line of
        // chrome does both jobs: it says what is happening while the turn runs
        // and, once it settles, what it did on the way to the answer.
        processContent={
          headerProcess ? renderSegments(headerProcess.segments) : undefined
        }
        processSummary={headerProcessSummary}
      />
      {outlinePreview && outlinePreview.sub_topics.length > 0 ? (
        <>
          {/* Layout for the merged research bubble:
                1. trace rows (above, via TraceFlow)
                2. ask_user Q&A summary (collapsible once research starts)
                3. Outline editor (auto-collapses once locked)
                4. Final report body (only after research is underway)
              The Q&A intentionally sits ABOVE the outline so the user
              sees the path that produced the outline before the outline
              itself. */}
          {askUserPayload ? (
            <AskUserOptions
              data={askUserPayload}
              onSubmit={submitReply}
              collapsible={researchInProgress}
              defaultCollapsed={researchInProgress}
            />
          ) : null}
          <ResearchOutlineEditor
            outline={outlinePreview.sub_topics}
            topic={outlinePreview.topic}
            onConfirm={(items) =>
              onConfirmOutline?.(
                items,
                outlinePreview.topic,
                outlinePreview.research_config,
                researchRequestSnapshot,
              )
            }
            status={outlineStatus}
          />
          {showResearchBody ? (
            <AssistantResponse
              content={msg.content}
              language={language}
              isStreaming={isStreaming}
              readingMaterialId={readingMaterialId}
              readingMaterialRevision={readingMaterialRevision}
              events={events}
            />
          ) : null}
        </>
      ) : mathAnimatorResult ? (
        <MathAnimatorViewer result={mathAnimatorResult} />
      ) : visualizeResult ? (
        <VisualizationViewer result={visualizeResult} />
      ) : quizQuestions && quizQuestions.length > 0 ? (
        <>
          {/* The quiz preface (the "I researched X, now let me quiz you on Y"
              sentence the user watched stream in) rides along ABOVE the quiz
              card. Without this, the streamed text
              vanishes from the bubble the moment the first card appears
              because the branch above is mutually exclusive with
              <AssistantResponse>. The body is already free of the
              per-question markdown — the pipeline trims that out of
              ``msg.content`` since the QuizViewer renders the cards
              themselves. */}
          {msg.content ? (
            <AssistantResponse
              content={msg.content}
              language={language}
              isStreaming={isStreaming}
              readingMaterialId={readingMaterialId}
              readingMaterialRevision={readingMaterialRevision}
              events={events}
            />
          ) : null}
          <QuizViewer
            questions={quizQuestions}
            sessionId={sessionId}
            turnId={quizTurnId}
            language={language}
          />
        </>
      ) : useSegmentLayout ? (
        // Default chat surface. The working-out (prose interleaved with the
        // steps it introduced) is one layer, folded once the turn settles; the
        // closing answer is the other and always stands plain. Pending cards
        // stay outside the process until the user answers them.
        bodyBlocks.map((block) =>
          block.kind === "process" ? (
            <ProcessFold
              key={block.key}
              segments={block.segments}
              settled={settledIntoAnswer}
            >
              {renderSegments(block.segments)}
            </ProcessFold>
          ) : block.kind === "card" ? (
            block.segment.kind === "mastery_question" ? (
              <div key={block.key}>
                {renderMasteryCard(block.segment.question)}
              </div>
            ) : block.segment.kind === "ask_user" ? (
              <AskUserOptions
                key={block.key}
                data={block.segment.data}
                onSubmit={submitReply}
              />
            ) : null
          ) : block.segment.kind === "text" ? (
            <AssistantResponse
              key={block.key}
              content={block.segment.text}
              language={language}
              isStreaming={isStreaming}
              readingMaterialId={readingMaterialId}
              readingMaterialRevision={readingMaterialRevision}
              events={events}
            />
          ) : null,
        )
      ) : (
        <AssistantResponse
          content={body}
          language={language}
          isStreaming={isStreaming}
          readingMaterialId={readingMaterialId}
          readingMaterialRevision={readingMaterialRevision}
          events={events}
        />
      )}
      {/* Non-default branches (quiz, math animator, visualize) keep the
          card below the body. The default branch inlines it via
          ``messageSegments``; the research branch renders its own card
          above the outline editor — both skip this fallback. */}
      {!outlinePreview && !hasInlineCards && latestMasteryQuestion
        ? renderMasteryCard(latestMasteryQuestion)
        : null}
      {!outlinePreview &&
      !hasInlineCards &&
      !latestMasteryQuestion &&
      askUserPayload ? (
        <AskUserOptions data={askUserPayload} onSubmit={submitReply} />
      ) : null}
      {/* Credential hand-off sits below whichever body branch rendered: it
          supplements the answer ("here's where to paste the key") rather than
          replacing it, and applies to every branch. */}
      {setupCredential ? <SetupCredentialCard data={setupCredential} /> : null}
      {partnerDraft ? <PartnerDraftCard data={partnerDraft} /> : null}
      {/* Course Study's hand-offs sit last: they are what to do *after* reading
          the answer, so they belong below it rather than competing with it. */}
      <CourseHandoffCards handoffs={courseHandoffs} />
      <MasteryHandoffCards handoffs={masteryHandoffs} />
    </>
  );
});

AssistantMessage.displayName = "AssistantMessage";

/**
 * [local patch 2026-09-03] 消息发送时间。聊天里原来只显示
 * cost / tokens / calls 这类统计（老大：没用），换成时间戳：
 * 今天显示 HH:MM，跨天显示 MM-DD HH:MM，悬停看完整时间。
 */
function MessageTime({ value }: { value: number }) {
  const date = new Date(value * 1000);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const label = sameDay
    ? date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : date.toLocaleString([], {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
  return (
    <span
      className="text-[11px] tabular-nums text-[var(--muted-foreground)]/70"
      title={date.toLocaleString()}
    >
      {label}
    </span>
  );
}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
});

ChatMessageList.displayName = "ChatMessageList";
