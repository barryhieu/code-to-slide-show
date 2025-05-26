const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Cấu hình
const MEDIA_DIR = './media';
const TMP_DIR = './tmp';
const OUTPUT_DIR = './output';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'slideshow.mp4');
const MUSIC_FILE = './music.mp3';

const IMAGE_DURATION = 4;           // duration of image
const CUT_VIDEO_DURATION = 5;       // duration of video
const TRANSITION_DURATION = 1;      // duration of transition effect

// create directories if not exist
[MEDIA_DIR, TMP_DIR, OUTPUT_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// check if music file exists
if (!fs.existsSync(MUSIC_FILE)) {
  console.error('❗ No music file', MUSIC_FILE);
  process.exit(1);
}

// read media files
const mediaFiles = fs.readdirSync(MEDIA_DIR)
  .filter(f => /\.(jpg|jpeg|png|mp4|mov|avi|mkv)$/i.test(f))
  .sort((a, b) => a.localeCompare(b));

if (mediaFiles.length < 1) {
  console.error('❗ No media files found');
  process.exit(1);
}

// get video duration using ffprobe
function getVideoDuration(filePath) {
  try {
    const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
    return parseFloat(execSync(cmd).toString());
  } catch {
    console.warn(`⚠️ Cannot read duration: ${filePath}, ${CUT_VIDEO_DURATION}s`);
    return CUT_VIDEO_DURATION;
  }
}

// start processing
console.log(`📸 Total ${mediaFiles.length} media.`);
console.log('🔧 Progressing...');

const processedFiles = [];

mediaFiles.forEach((file, index) => {
  const inputPath = path.join(MEDIA_DIR, file);
  const outputPath = path.join(TMP_DIR, `clip_${index}.mp4`);
  const isImage = /\.(jpg|jpeg|png)$/i.test(file);

  console.log(`📂 [${index + 1}/${mediaFiles.length}] Processing: ${file}`);

  let cmd;
  if (isImage) {
    cmd = `ffmpeg -y -loop 1 -t ${IMAGE_DURATION + TRANSITION_DURATION} -i "${inputPath}" ` +
      `-vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p" ` +
      `-r 30 -pix_fmt yuv420p -c:v libx264 -preset veryfast "${outputPath}"`;
  } else {
    const duration = Math.min(getVideoDuration(inputPath), CUT_VIDEO_DURATION);
    cmd = `ffmpeg -y -ss 0 -i "${inputPath}" -t ${duration} ` +
      `-vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p" ` +
      `-r 30 -pix_fmt yuv420p -c:v libx264 -preset veryfast -an "${outputPath}"`;
  }

  try {
    execSync(cmd, { stdio: 'ignore' });
    processedFiles.push(outputPath);
    console.log(`✅ Done: ${file}`);
  } catch (err) {
    console.error(`❌ Error when processing ${file}:`, err.message);
  }
});

if (processedFiles.length === 0) {
  console.error('❗ No media files were processed successfully.');
  process.exit(1);
}

// Create filter xfade
console.log('🎬 Creating filter xfade...');
const inputList = processedFiles.map((file, i) => `-i "${file}"`).join(' ');

let filterSteps = [];
let offset = 0;
let lastOutput = `[0:v]`;

for (let i = 1; i < processedFiles.length; i++) {
  const isImage = /\.(jpg|jpeg|png)$/i.test(mediaFiles[i - 1]);
  const duration = isImage ? IMAGE_DURATION : CUT_VIDEO_DURATION;

  const nextInput = `[${i}:v]`;
  const outputName = `[v${i}]`;

  filterSteps.push(`${lastOutput}${nextInput}xfade=transition=fade:duration=${TRANSITION_DURATION}:offset=${offset}${outputName}`);
  lastOutput = outputName;
  offset += duration - TRANSITION_DURATION;
}

const filterComplex = filterSteps.join(';') + `;${lastOutput}format=yuv420p[video_out]`;

// Create final ffmpeg command
const ffmpegCmd = `ffmpeg ${inputList} -stream_loop -1 -i "${MUSIC_FILE}" ` +
  `-filter_complex "${filterComplex}" ` +
  `-map "[video_out]" -map ${processedFiles.length}:a -shortest ` +
  `-c:v libx264 -preset veryfast -c:a aac -b:a 192k ` +
  `-movflags +faststart -y "${OUTPUT_FILE}"`;

try {
  execSync(ffmpegCmd, { stdio: 'inherit' });
  console.log(`✅ Done: ${OUTPUT_FILE}`);
} catch (err) {
  console.error('❌ Error render video:', err.message);
  process.exit(1);
}
