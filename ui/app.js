const form = document.querySelector("#config");
const fields = {
  podcast: document.querySelector("#podcast"),
  download: document.querySelector("#download"),
  yes: document.querySelector("#yes"),
  output: document.querySelector("#output-dir"),
  retries: document.querySelector("#retries"),
  minDelay: document.querySelector("#min-delay"),
  maxDelay: document.querySelector("#max-delay"),
  start: document.querySelector("#start"),
  limit: document.querySelector("#limit"),
};

const commandOutput = document.querySelector("#command-output");
const copyButton = document.querySelector("#copy-command");
const copyFeedback = document.querySelector("#copy-feedback");
const delayReadout = document.querySelector("#delay-readout");
const retryReadout = document.querySelector("#retry-readout");
const rangeReadout = document.querySelector("#range-readout");
const taskMode = document.querySelector("#task-mode");

function shellQuote(value) {
  const text = String(value || "").trim();
  if (!text) return '""';
  return `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function seconds(ms) {
  const value = Number(ms) || 0;
  return `${Math.round(value / 1000)}s`;
}

function buildCommand() {
  const parts = [
    "node",
    "xiaoyuzhou-podcast-transcripts.mjs",
    "--podcast",
    shellQuote(fields.podcast.value),
  ];

  if (fields.download.checked) parts.push("--download");
  if (fields.yes.checked) parts.push("--yes");

  parts.push("--output", shellQuote(fields.output.value));
  parts.push("--min-delay-ms", String(fields.minDelay.value || 0));
  parts.push("--max-delay-ms", String(fields.maxDelay.value || 0));
  parts.push("--retries", String(fields.retries.value || 0));

  if (Number(fields.start.value) > 0) {
    parts.push("--start", String(fields.start.value));
  }

  if (Number(fields.limit.value) > 0) {
    parts.push("--limit", String(fields.limit.value));
  }

  return parts.join(" ");
}

function updateUi() {
  commandOutput.textContent = buildCommand();
  delayReadout.textContent = `${seconds(fields.minDelay.value)}-${seconds(fields.maxDelay.value)}`;
  retryReadout.textContent = `${Number(fields.retries.value) || 0} 次`;
  taskMode.textContent = fields.download.checked ? "清单 + transcript" : "仅节目清单";

  const start = Number(fields.start.value) || 0;
  const limit = Number(fields.limit.value) || 0;
  rangeReadout.textContent = limit > 0 ? `从 ${start} 起取 ${limit}` : "全部";
}

form.addEventListener("input", updateUi);
form.addEventListener("change", updateUi);

copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(commandOutput.textContent);
    copyFeedback.textContent = "命令已复制。";
  } catch {
    copyFeedback.textContent = "复制失败，请手动选中命令。";
  }
});

updateUi();
