const $ = (id) => document.getElementById(id);
let listening = false;
let manualStop = false;
let commandBuffer = "";
let silenceTimer;
let mediaRecorder;
let micStream;
let micContext;
let micAnalyser;
let micSource;
let audioChunks = [];
let recordingTimer;
let hasSpeech = false;
let noiseFloor = 1;
let speechQueue = Promise.resolve();
let speechUrl;
let audioContext;
let audioSource;

// chrome.runtime.sendMessage JSON-serialises its payload: an ArrayBuffer arrives as {}
// and a big number[] is slow. Binary data must travel as base64.
function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
// Gnani STT accepts WAV/MP3/OGG/FLAC/AAC/M4A, not WebM. Decode the recording and re-encode as 16 kHz mono WAV.
async function blobToWav16k(blob) {
  const decoded = await new (window.AudioContext || window.webkitAudioContext)().decodeAudioData(await blob.arrayBuffer());
  const rate = 16000;
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const samples = (await offline.startRendering()).getChannelData(0);
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset, text) => { for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i)); };
  write(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); write(8, "WAVE"); write(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}
function setState(text) { $("state").textContent = text; }
function setTranscript(text) { $("transcript").textContent = text; }
$("close").onclick = () => window.parent.postMessage({ source: "paroksh-panel", type: "close" }, "*");
async function unlockAudio() {
  audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === "suspended") await audioContext.resume();
}
function speak(text, language) {
  const phrase = String(text || "").trim();
  if (!phrase) return;
  speechQueue = speechQueue.then(async () => {
    const response = await chrome.runtime.sendMessage({
      type: "PAROKSH_SYNTHESIZE",
      text: phrase,
      language,
    });
    if (!response?.ok || !response.audioBase64) {
      throw new Error(response?.error || "Voice reply was unavailable.");
    }
    await unlockAudio();
    if (audioSource) {
      try { audioSource.stop(); } catch {}
      audioSource = null;
    }
    const bytes = base64ToBytes(response.audioBase64);
    let audioBuffer;
    try {
      audioBuffer = await audioContext.decodeAudioData(bytes.buffer.slice(0));
    } catch (error) {
      const audio = $("audio");
      if (speechUrl) URL.revokeObjectURL(speechUrl);
      speechUrl = URL.createObjectURL(new Blob([bytes], { type: response.contentType || "audio/wav" }));
      audio.src = speechUrl;
      audio.hidden = false;
      audio.controls = true;
      await audio.play();
      return;
    }
    audioSource = audioContext.createBufferSource();
    audioSource.buffer = audioBuffer;
    audioSource.connect(audioContext.destination);
    $("state").textContent = "Speaking";
    await new Promise((resolve) => {
      audioSource.onended = resolve;
      audioSource.start();
    });
  }).catch((error) => {
    console.warn("PAROKSH voice reply failed:", error.message);
    setState(`Voice reply unavailable: ${error.message}`);
  });
}
function setListeningPreference(value) {
  chrome.storage?.session?.set({ paroksh_voice_listening: value });
}
function stopCurrentTask() {
  chrome.runtime.sendMessage({ type: "PAROKSH_CANCEL" });
  setState("Stopping");
}
function handleCommand(text) {
  const command = text.trim();
  if (!command) return;
  $("transcript").textContent = `You: ${command}`;
  if (/^(please\s+)?(stop|cancel|abort)(\s+(the\s+)?(task|command|action))?[.!]?$/i.test(command)) {
    stopCurrentTask();
    return;
  }
  setState("Understanding command");
  chrome.runtime.sendMessage({ type: "PAROKSH_START", instruction: command, language: handleCommand.language });
}
async function transcribeRecording() {
  const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });
  audioChunks = [];
  if (!blob.size) {
    setTranscript("No microphone audio was recorded.");
    throw new Error("No microphone audio was recorded.");
  }
  setState("Transcribing");
  setTranscript("Sending audio for transcription...");
  let wav;
  try {
    wav = await blobToWav16k(blob);
  } catch (error) {
    setTranscript(`Could not decode recording: ${error.message}`);
    throw error;
  }
  let response;
  try {
    response = await chrome.runtime.sendMessage({
      type: "PAROKSH_TRANSCRIBE",
      audioBase64: bytesToBase64(wav),
      contentType: "audio/wav",
      filename: "orbit-command.wav",
      languageCode: "indic-auto",
    });
  } catch (error) {
    setTranscript(`Transcription connection failed: ${error.message}`);
    throw error;
  }
  if (!response?.ok || !response.body?.transcript) {
    const message = response?.body?.error || "No speech was transcribed.";
    setTranscript(response?.body?.error ? `Transcription failed: ${message}` : "I couldn't catch that. Please try again.");
    throw new Error(message);
  }
  handleCommand.language = response.body.languageCode || "en-IN";
  setTranscript(`You: ${response.body.transcript}`);
  handleCommand(response.body.transcript);
}
function monitorMicrophone() {
  if (!listening || !micAnalyser) return;
  const data = new Uint8Array(micAnalyser.fftSize);
  micAnalyser.getByteTimeDomainData(data);
  const volume = Math.sqrt(data.reduce((sum, value) => sum + ((value - 128) ** 2), 0) / data.length);
  // Track the room's noise floor so quiet microphones still trigger.
  if (!hasSpeech) noiseFloor = noiseFloor * 0.95 + volume * 0.05;
  if (volume > Math.max(2.5, noiseFloor * 2.5)) {
    hasSpeech = true;
    setState("Hearing");
    clearTimeout(silenceTimer);
  } else if (hasSpeech && !silenceTimer) {
    silenceTimer = setTimeout(() => {
      silenceTimer = null;
      if (mediaRecorder?.state === "recording") mediaRecorder.stop();
    }, 700);
  }
  requestAnimationFrame(monitorMicrophone);
}
$("record").onclick = async () => {
  try {
    setState("Requesting microphone");
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone capture is unavailable in this extension frame.");
    }
    await unlockAudio();
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micContext = new (window.AudioContext || window.webkitAudioContext)();
    if (micContext.state === "suspended") await micContext.resume();
    micAnalyser = micContext.createAnalyser();
    micSource = micContext.createMediaStreamSource(micStream);
    micSource.connect(micAnalyser);
    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
      .find((type) => MediaRecorder.isTypeSupported(type));
    mediaRecorder = new MediaRecorder(micStream, mimeType ? { mimeType } : undefined);
    mediaRecorder.ondataavailable = (event) => { if (event.data.size) audioChunks.push(event.data); };
    mediaRecorder.onerror = (event) => {
      setState(`Recording failed: ${event.error?.message || "MediaRecorder error."}`);
    };
    mediaRecorder.onstop = async () => {
      clearTimeout(recordingTimer);
      clearTimeout(silenceTimer);
      silenceTimer = null;
      const heardSpeech = hasSpeech;
      if (!manualStop && !heardSpeech) {
        audioChunks = [];
      } else if (!manualStop && audioChunks.length) {
        try { await transcribeRecording(); } catch (error) {
          setState(`Transcription failed: ${error.message}`);
          setTranscript(`Transcription failed: ${error.message}`);
        }
      }
      hasSpeech = false;
      if (listening && !manualStop) {
        audioChunks = [];
        mediaRecorder.start(250);
        recordingTimer = setTimeout(() => {
          if (mediaRecorder?.state === "recording") mediaRecorder.stop();
        }, 8000);
        setState("Listening");
      }
    };
    listening = true;
    manualStop = false;
    setListeningPreference(true);
    $("record").disabled = true;
    $("stop").disabled = false;
    setState("Listening");
    setTranscript("Listening... speak now.");
    mediaRecorder.start(250);
    recordingTimer = setTimeout(() => {
      if (mediaRecorder?.state === "recording") mediaRecorder.stop();
    }, 8000);
    monitorMicrophone();
  } catch (error) {
    setState(`Microphone unavailable: ${error.message}`);
    setTranscript(`Microphone unavailable: ${error.message}`);
  }
};
$("stop").onclick = () => {
  manualStop = true;
  setListeningPreference(false);
  listening = false;
  clearTimeout(silenceTimer);
  clearTimeout(recordingTimer);
  if (mediaRecorder?.state === "recording") mediaRecorder.stop();
  micStream?.getTracks().forEach((track) => track.stop());
  micContext?.close().catch(() => {});
  micContext = null;
  micAnalyser = null;
  micSource = null;
  $("record").disabled = false;
  $("stop").disabled = true;
};
chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "PAROKSH_STATUS") return;
  setState(message.state);
  if (message.speech) speak(message.speech, message.language);
});

chrome.runtime.sendMessage({ type: "PAROKSH_PANEL_READY" }).catch(() => {});
chrome.storage?.session?.get(["paroksh_voice_listening"], (state) => {
  if (state?.paroksh_voice_listening) setTimeout(() => $("record").click(), 350);
});
