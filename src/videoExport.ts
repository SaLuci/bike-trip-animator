// Instagram Stories don't accept GIF uploads, so the app records the live canvas animation
// straight into a real video file using the browser's built-in MediaRecorder — no extra
// encoder library, no big WASM download, and it plays back with proper hardware-accelerated
// codecs on the phone.

export interface VideoFormat {
  mimeType: string;
  extension: string;
}

const CANDIDATE_FORMATS: VideoFormat[] = [
  { mimeType: 'video/mp4;codecs=avc1.42E01E', extension: 'mp4' },
  { mimeType: 'video/mp4', extension: 'mp4' },
  { mimeType: 'video/webm;codecs=vp9', extension: 'webm' },
  { mimeType: 'video/webm;codecs=vp8', extension: 'webm' },
  { mimeType: 'video/webm', extension: 'webm' }
];

function pickSupportedFormat(): VideoFormat {
  for (const candidate of CANDIDATE_FORMATS) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate.mimeType)) {
      return candidate;
    }
  }
  return { mimeType: '', extension: 'webm' };
}

export interface RecordedVideo {
  blob: Blob;
  extension: string;
}

/** Records whatever is drawn to `canvas` in real time, at `fps`, until `stop()` is called. */
export class CanvasVideoRecorder {
  private readonly recorder: MediaRecorder;
  private readonly chunks: Blob[] = [];
  private readonly format: VideoFormat;
  private readonly finished: Promise<Blob>;
  private resolveFinished!: (blob: Blob) => void;

  constructor(canvas: HTMLCanvasElement, fps: number) {
    if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') {
      throw new Error('This browser does not support recording video from the canvas.');
    }
    this.format = pickSupportedFormat();
    const stream = canvas.captureStream(fps);
    this.recorder = this.format.mimeType
      ? new MediaRecorder(stream, { mimeType: this.format.mimeType })
      : new MediaRecorder(stream);

    this.finished = new Promise<Blob>((resolve) => {
      this.resolveFinished = resolve;
    });
    this.recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.onstop = () => {
      const type = this.recorder.mimeType || this.format.mimeType || 'video/webm';
      this.resolveFinished(new Blob(this.chunks, { type }));
    };
  }

  get extension(): string {
    return this.format.extension;
  }

  start() {
    this.recorder.start();
  }

  async stop(): Promise<RecordedVideo> {
    if (this.recorder.state !== 'inactive') this.recorder.stop();
    const blob = await this.finished;
    return { blob, extension: this.extension };
  }
}
