import {
  BarChart3,
  BookOpen,
  BrainCircuit,
  CircleHelp,
  Clapperboard,
  Code2,
  Compass,
  FileSearch,
  Globe,
  GraduationCap,
  Image as ImageIcon,
  Lightbulb,
  MessageSquare,
  Microscope,
  PenLine,
  Signpost,
  Sparkles,
  Youtube,
  type LucideIcon,
} from "lucide-react";

import type { CapabilityDescriptor } from "./model";

export type ToolName =
  | "brainstorm"
  | "geogebra_analysis"
  | "web_search"
  | "code_execution"
  | "reason"
  | "paper_search"
  | "imagegen"
  | "videogen"
  | "tts_speak";

export interface ToolDef {
  name: ToolName;
  label: string;
  icon: LucideIcon;
}

export const ALL_TOOLS: ToolDef[] = [
  { name: "brainstorm", label: "Brainstorm", icon: Lightbulb },
  { name: "geogebra_analysis", label: "GeoGebra", icon: Compass },
  { name: "web_search", label: "Web Search", icon: Globe },
  { name: "code_execution", label: "Code", icon: Code2 },
  { name: "reason", label: "Reason", icon: Sparkles },
  { name: "paper_search", label: "Arxiv Search", icon: FileSearch },
  { name: "imagegen", label: "Image Gen", icon: ImageIcon },
  { name: "videogen", label: "Video Gen", icon: Clapperboard },
  // [local patch 2026-09-03] 语音回复工具（见 CHAT_CAPABILITIES 里 chat 的 allow-list）
  { name: "tts_speak", label: "Voice Reply", icon: Sparkles },
];

export interface CapabilityDef {
  value: string;
  label: string;
  description: string;
  icon: LucideIcon;
  allowedTools: string[];
  secondary?: boolean;
  legacy?: boolean;
}

export interface ChatCapabilityDef extends CapabilityDef {
  allowedTools: ToolName[];
  defaultTools: ToolName[];
  /** Direct CLI/SDK capability retained for existing callers, not a browser action. */
  legacy?: boolean;
}

/** Authoritative capability catalog shared by Home and learning workspaces. */
export const CHAT_CAPABILITIES: ChatCapabilityDef[] = [
  {
    value: "",
    label: "Chat",
    description: "Flexible conversation with any tool",
    icon: MessageSquare,
    allowedTools: [
      "brainstorm",
      "geogebra_analysis",
      "web_search",
      "code_execution",
      "reason",
      "paper_search",
      "imagegen",
      "videogen",
      // [local patch 2026-09-03] tts_speak 必须在 allow-list 里：composer 的
      // enabledTools = 用户开关集 ∩ 这里，缺了它文字请求发语音时模型根本没有
      // 这个工具 → 嘴上说"语音发你了"实际什么都没发。
      "tts_speak",
    ],
    defaultTools: [],
  },
  {
    value: "deep_solve",
    label: "Solve",
    description: "Multi-step reasoning & problem solving",
    icon: BrainCircuit,
    allowedTools: ["web_search", "code_execution", "reason"],
    defaultTools: ["web_search", "code_execution", "reason"],
    secondary: true,
  },
  {
    value: "ask_questions",
    label: "Ask Questions",
    description: "Let the model ask you questions to fill in missing context",
    icon: CircleHelp,
    allowedTools: [
      "brainstorm",
      "geogebra_analysis",
      "web_search",
      "code_execution",
      "reason",
      "paper_search",
      "imagegen",
      "videogen",
    ],
    defaultTools: [],
  },
  {
    value: "deep_question",
    label: "Quiz",
    description: "Auto-validated question generation",
    icon: PenLine,
    allowedTools: ["web_search", "code_execution"],
    defaultTools: ["web_search", "code_execution"],
  },
  {
    value: "deep_research",
    label: "Research",
    description: "Comprehensive multi-agent research",
    icon: Microscope,
    allowedTools: ["web_search", "paper_search", "code_execution"],
    defaultTools: ["web_search", "paper_search", "code_execution"],
    secondary: true,
  },
  {
    value: "visualize",
    label: "Visualize",
    description:
      "Generate charts, diagrams, interactive pages, or math animations",
    icon: BarChart3,
    allowedTools: [],
    defaultTools: [],
  },
  {
    value: "immersive_watching",
    label: "Immersive Watching",
    description: "Learn from YouTube with timestamp-grounded tutoring",
    icon: Youtube,
    allowedTools: ["web_search", "code_execution", "reason"],
    defaultTools: [],
    secondary: true,
  },
  {
    value: "course_study",
    label: "Course Study",
    description: "See where a course stands and what to do next",
    icon: Signpost,
    allowedTools: ["web_search", "code_execution", "reason"],
    defaultTools: [],
  },
  {
    value: "mastery_path",
    label: "Mastery Path",
    description: "Mastery-based tutoring with a hard gate",
    icon: GraduationCap,
    allowedTools: ["web_search", "code_execution"],
    defaultTools: [],
    legacy: true,
  },
  {
    // [local patch 2026-09-03] 静态展示条目：这两个能力此前只从后端 manifest
    // 动态合并，露出英文 id + 英文描述（未走 i18n）。补静态条目走 t() 翻译。
    value: "immersive_reading",
    label: "Immersive Reading",
    description: "Read a document alongside the assistant with cited pages",
    icon: BookOpen,
    allowedTools: [],
    defaultTools: [],
    secondary: true,
  },
  {
    value: "math_animator",
    label: "Math Animator",
    description: "Generate math animations or storyboard images with Manim",
    icon: Clapperboard,
    allowedTools: [],
    defaultTools: [],
    secondary: true,
  },
];

export const VISIBLE_CHAT_CAPABILITIES = CHAT_CAPABILITIES.filter(
  (capability) =>
    capability.value !== "course_study" &&
    capability.value !== "immersive_reading" &&
    !capability.legacy,
);

/** Actions offered inside Reading and Mastery; workspace identity is separate. */
export const WORKSPACE_CHAT_CAPABILITIES = CHAT_CAPABILITIES.filter(
  (capability) =>
    capability.value !== "course_study" &&
    capability.value !== "mastery_path" &&
    capability.value !== "immersive_watching",
);

export function getChatCapability(value: string | null): ChatCapabilityDef {
  return (
    CHAT_CAPABILITIES.find(
      (capability) => capability.value === (value || ""),
    ) ?? CHAT_CAPABILITIES[0]
  );
}

const UNKNOWN_PRESENTATION: Omit<
  ChatCapabilityDef,
  "value" | "label" | "description"
> = {
  icon: BrainCircuit,
  allowedTools: [],
  defaultTools: [],
  secondary: true,
};

function humanizeCapabilityId(id: string): string {
  return id
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function mergeCapabilityPresentations(
  capabilities: readonly CapabilityDescriptor[],
): ChatCapabilityDef[] {
  const byId = new Map(
    CHAT_CAPABILITIES.map((entry) => [entry.value || "chat", entry] as const),
  );

  return capabilities
    .filter((capability) => capability.available)
    .map((capability) => {
      const known = byId.get(capability.id);
      if (known) {
        return {
          ...known,
          allowedTools: [...known.allowedTools],
          defaultTools: [...known.defaultTools],
        };
      }
      const label =
        typeof capability.manifest?.name === "string" &&
        capability.manifest.name.trim()
          ? capability.manifest.name.trim()
          : humanizeCapabilityId(capability.id);
      return {
        ...UNKNOWN_PRESENTATION,
        value: capability.id,
        label,
        description:
          typeof capability.manifest?.description === "string"
            ? capability.manifest.description
            : "Extension capability",
        allowedTools: [],
        defaultTools: [],
      };
    });
}

export function visibleCapabilityPresentations(
  capabilities: readonly ChatCapabilityDef[],
): ChatCapabilityDef[] {
  const catalogOrder = new Map(
    CHAT_CAPABILITIES.map((capability, index) => [capability.value, index]),
  );

  return capabilities
    .filter(
      (capability) =>
        capability.value !== "course_study" &&
        capability.value !== "immersive_reading" &&
        !capability.legacy,
    )
    .map((capability, sourceIndex) => ({ capability, sourceIndex }))
    .sort((left, right) => {
      const leftOrder = catalogOrder.get(left.capability.value);
      const rightOrder = catalogOrder.get(right.capability.value);
      if (leftOrder === undefined && rightOrder === undefined) {
        return left.sourceIndex - right.sourceIndex;
      }
      if (leftOrder === undefined) return 1;
      if (rightOrder === undefined) return -1;
      return leftOrder - rightOrder;
    })
    .map(({ capability }) => capability);
}
