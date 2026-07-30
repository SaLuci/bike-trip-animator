import { parseGpxFile, sortFilesByName, GpxParseError } from './gpx';
import { generateVideo } from './animation';
import { saveVideoBlob } from './save';
import type { TrackPoint } from './types';

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

const previousDaysInput = byId('previousDays') as HTMLInputElement;
const currentDayInput = byId('currentDay') as HTMLInputElement;
const allDaysInput = byId('allDays') as HTMLInputElement;
const previousDaysSummary = byId('previousDaysSummary');
const currentDaySummary = byId('currentDaySummary');
const allDaysSummary = byId('allDaysSummary');
const dayTitleInput = byId('dayTitle') as HTMLInputElement;
const startCityInput = byId('startCity') as HTMLInputElement;
const endCityInput = byId('endCity') as HTMLInputElement;
const riderEmojiInput = byId('riderEmoji') as HTMLInputElement;
const speedInput = byId('animSpeed') as HTMLInputElement;
const speedValueLabel = byId('animSpeedValue');
const animateBtn = byId('animateBtn') as HTMLButtonElement;
const statusBox = byId('status');
const statusText = byId('statusText');
const progressFill = byId('progressFill');
const previewCanvas = byId('previewCanvas') as HTMLCanvasElement;
const resultSection = byId('resultSection');
const resultVideo = byId('resultVideo') as HTMLVideoElement;
const saveBtn = byId('saveBtn') as HTMLButtonElement;
const errorBox = byId('errorBox');

let lastBlob: Blob | null = null;
let lastExtension = 'webm';

function summarize(input: HTMLInputElement, target: HTMLElement) {
  const files = input.files ? Array.from(input.files) : [];
  if (files.length === 0) {
    target.textContent = 'No files selected';
  } else if (files.length === 1) {
    target.textContent = files[0].name;
  } else {
    target.textContent = `${files.length} files selected`;
  }
}

previousDaysInput.addEventListener('change', () => summarize(previousDaysInput, previousDaysSummary));
currentDayInput.addEventListener('change', () => summarize(currentDayInput, currentDaySummary));
allDaysInput.addEventListener('change', () => summarize(allDaysInput, allDaysSummary));

// Emoji preset buttons
riderEmojiInput.value = '🚴';
document.querySelectorAll<HTMLElement>('.emoji-preset').forEach((btn) => {
  btn.addEventListener('click', () => {
    const emoji = btn.dataset.emoji ?? '🚴';
    riderEmojiInput.value = emoji;
    document.querySelectorAll('.emoji-preset').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
  });
});
riderEmojiInput.addEventListener('input', () => {
  const val = riderEmojiInput.value;
  document.querySelectorAll<HTMLElement>('.emoji-preset').forEach((b) => {
    b.classList.toggle('selected', b.dataset.emoji === val);
  });
});

function updateSpeedLabel() {
  speedValueLabel.textContent = `${Number(speedInput.value).toFixed(1)}x`;
}
speedInput.addEventListener('input', updateSpeedLabel);
updateSpeedLabel();

function showError(message: string) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function clearError() {
  errorBox.hidden = true;
  errorBox.textContent = '';
}

function setStatus(message: string, fraction: number) {
  statusBox.hidden = false;
  statusText.textContent = message;
  progressFill.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
}

async function parseFilesToTracks(input: HTMLInputElement): Promise<TrackPoint[][]> {
  const files = sortFilesByName(input.files ? Array.from(input.files) : []);
  const tracks: TrackPoint[][] = [];
  for (const file of files) {
    tracks.push(await parseGpxFile(file));
  }
  return tracks;
}

animateBtn.addEventListener('click', async () => {
  clearError();
  resultSection.hidden = true;
  animateBtn.disabled = true;
  try {
    setStatus('Reading GPX files…', 0);
    const previousDaysTracks = await parseFilesToTracks(previousDaysInput);
    const currentDayTracksSeparate = await parseFilesToTracks(currentDayInput);
    const allDaysTracks = await parseFilesToTracks(allDaysInput);
    const currentDayPoints: TrackPoint[] = currentDayTracksSeparate.flat();

    const { blob, extension } = await generateVideo(
      {
        previousDaysTracks,
        currentDayPoints,
        allDaysTracks,
        startCity: startCityInput.value,
        endCity: endCityInput.value,
        dayTitle: dayTitleInput.value        riderEmoji: riderEmojiInput.value.trim() || '🚴',      },
      {
        canvas: previewCanvas,
        speedMultiplier: Number(speedInput.value) || 1,
        onStatus: (msg) => setStatus(msg, 0),
        onProgress: (f) => setStatus('Recording animation…', f)
      }
    );

    lastBlob = blob;
    lastExtension = extension;
    const url = URL.createObjectURL(blob);
    resultVideo.src = url;
    resultSection.hidden = false;
    setStatus('Done!', 1);
    setTimeout(() => {
      statusBox.hidden = true;
    }, 1500);
  } catch (err) {
    console.error(err);
    const message =
      err instanceof GpxParseError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Something went wrong generating the video.';
    showError(message);
    statusBox.hidden = true;
  } finally {
    animateBtn.disabled = false;
  }
});

saveBtn.addEventListener('click', async () => {
  if (!lastBlob) return;
  try {
    const dateStr = new Date().toISOString().slice(0, 10);
    await saveVideoBlob(lastBlob, `bike-trip-${dateStr}.${lastExtension}`, lastExtension);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return; // user cancelled, not an error
    console.error(err);
    showError('Could not save the file.');
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* offline support is a bonus, not required */
    });
  });
}

