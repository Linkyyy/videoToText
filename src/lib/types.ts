export interface Segment {
  start: number | null;
  end: number | null;
  text: string;
}
export interface Transcript {
  title: string;
  text: string;
  segments: Segment[];
  source: "caption" | "asr" | "import";
  platform?: string;
  url?: string;
  duration?: number;
}
export interface Job {
  id: string;
  status: "queued" | "downloading" | "transcribing" | "completed" | "failed";
  progress: number;
  message: string;
  result?: Transcript;
  error?: string;
  ticket?: string;
}
export interface Health {
  deepseek: boolean;
  worker: boolean;
}
export type SummaryStyle = "analysis" | "study" | "meeting";
export type SummaryLength = "short" | "normal" | "long";
