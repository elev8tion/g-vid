/**
 * Represents the full context available to all interceptors for a single generation job.
 * Designed to be rich and stable for long-term sustainability and correctness.
 */
export interface GenerationContext {
  jobId: string;
  sessionId?: string;

  /** The original prompt built by the frontend before any interceptor processing. */
  originalPrompt: string;

  /** Raw reference images (usually base64 data URIs after compression in the backend). */
  referenceImages: string[];

  /** Local filesystem path to the user's exact 8-second smart-trimmed audio clip (if provided). */
  audioPath?: string;

  /** The selected shot/scene (contains name, description, promptHint, etc.). */
  shot: {
    id: string;
    name: string;
    description: string;
    promptHint: string;
  };

  /** Optional free-text face description provided by the user. */
  faceDescription?: string;

  /** The exact trim window the user chose for their audio. */
  trimWindow: { start: number; duration: number };

  /** 
   * Future extension point.
   * Will contain results from pre-interceptors (e.g. audio analysis features, detected faces, etc.)
   */
  preProcessingResults?: Record<string, any>;
}

/** The shape we send to xAI (kept close to what the backend actually constructs today). */
export interface XaiVideoRequest {
  model: string;
  prompt: string;
  reference_images?: Array<{ url: string }>;
  duration: number;
  aspect_ratio: string;
  resolution: string;
  // Additional fields (face_description, shot_name, etc.) can be added here as needed.
}

/** Standard step names used across the system for observability and UI progress. */
export type PipelineStep =
  | 'prepare_references'
  | 'enhance_prompt'
  | 'audio_analysis'
  | 'xai_video_gen'
  | 'audio_merge'
  | 'post_process'
  | 'done';

/** Represents the execution state of one step in the pipeline. */
export interface PipelineStepExecution {
  name: PipelineStep;
  status: 'pending' | 'running' | 'completed' | 'skipped' | 'failed';
  durationMs?: number;
  startedAt?: number;
  details?: string; // e.g. "2 reference images analyzed", "Extracted 4 rhythmic accents"
}

export interface PreXAIInterceptor {
  name: string;
  run(request: XaiVideoRequest, context: GenerationContext): Promise<XaiVideoRequest>;
}

export interface PostXAIInterceptor {
  name: string;
  run(videoUrl: string, context: GenerationContext): Promise<string>; // returns final video url/path
}
