(function () {
  "use strict";

  const config = Object.assign({
    studyId: "gct-cloze",
    itemsCsv: "data/cloze_items.csv",
    submissionEmail: "",
    emailSubject: "GCT Cloze Survey CSV Submission",
    autoDownloadCsv: true,
    enablePractice: true,
    practiceItem: {
      itemId: "practice",
      stem: "practice",
      itemVersion: "practice_v1",
      blankLabel: "XXXX",
      prompt: "The rain stopped just before the picnic. The grass was still XXXX, so everyone put a blanket on the ground before sitting down."
    },
    randomizeItems: true,
    maxItems: 20,
    requireParticipantId: false,
    allowCsvDownload: true
  }, window.CLOZE_CONFIG || {});

  const storageKey = `cloze-survey:${config.studyId}`;

  const state = {
    sessionId: window.crypto && crypto.randomUUID ? crypto.randomUUID() : makeId(),
    startedAt: new Date().toISOString(),
    participant: {},
    items: [],
    order: [],
    current: 0,
    mode: "task",
    practiceCompleted: false,
    responses: {},
    itemStartedAt: 0,
    itemStartedAtIso: "",
    completedAt: null,
    downloadedFilename: ""
  };

  const views = {
    intro: document.getElementById("intro-view"),
    task: document.getElementById("task-view"),
    done: document.getElementById("done-view")
  };

  const participantForm = document.getElementById("participant-form");
  const responseForm = document.getElementById("response-form");
  const participantId = document.getElementById("participant-id");
  const groupCode = document.getElementById("group-code");
  const englishLevel = document.getElementById("english-level");
  const eikenLevel = document.getElementById("eiken-level");
  const otherQualification = document.getElementById("other-qualification");
  const consent = document.getElementById("consent");
  const passage = document.getElementById("passage");
  const answerEnglish = document.getElementById("answer-english");
  const answerJapanese = document.getElementById("answer-japanese");
  const unknown = document.getElementById("unknown");
  const confidence = document.getElementById("confidence");
  const confidenceOutput = document.getElementById("confidence-output");
  const progressLabel = document.getElementById("progress-label");
  const progressBar = document.getElementById("progress-bar");
  const backButton = document.getElementById("back-button");
  const nextButton = document.getElementById("next-button");
  const downloadButton = document.getElementById("download-button");
  const emailButton = document.getElementById("email-button");
  const restartButton = document.getElementById("restart-button");
  const submitStatus = document.getElementById("submit-status");
  const emailInstruction = document.getElementById("email-instruction");

  init();

  async function init() {
    try {
      const csv = await fetch(config.itemsCsv, { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error(`Items CSV could not be loaded: ${response.status}`);
        return response.text();
      });

      state.items = parseCsv(csv)
        .filter((row) => !row.section || row.section === "meaning_derivation")
        .map(normalizeItem)
        .filter((item) => item.itemId && item.prompt && item.prompt.includes("XXXX"));

      if (state.items.length === 0) {
        throw new Error("No meaning_derivation items were found.");
      }

      state.order = [...Array(state.items.length).keys()];
      if (config.randomizeItems) shuffle(state.order);
      state.order = state.order.slice(0, Math.min(config.maxItems, state.order.length));

      participantId.required = Boolean(config.requireParticipantId);
      wireEvents();
      restoreDraft();
      updateDownloadVisibility();
    } catch (error) {
      document.querySelector(".intro-copy p:not(.eyebrow)").innerHTML =
        `<span class="error-text">${escapeHtml(error.message)}</span>`;
      participantForm.classList.add("is-hidden");
    }
  }

  function wireEvents() {
    participantForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (config.requireParticipantId && !participantId.value.trim()) {
        participantId.focus();
        return;
      }
      if (!consent.checked) {
        consent.focus();
        return;
      }

      state.participant = {
        participantId: participantId.value.trim(),
        groupCode: groupCode.value.trim(),
        englishLevel: englishLevel.value,
        eikenLevel: eikenLevel.value,
        otherQualification: otherQualification.value.trim()
      };

      state.mode = config.enablePractice ? "practice" : "task";
      showView("task");
      renderItem();
      saveDraft();
    });

    responseForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!validateCurrentResponse()) return;
      saveCurrentResponse();

      if (state.mode === "practice") {
        state.practiceCompleted = true;
        state.mode = "task";
        state.current = 0;
        renderItem();
        saveDraft();
        return;
      }

      if (state.current >= state.order.length - 1) {
        finishSurvey();
        return;
      }

      state.current += 1;
      renderItem();
      saveDraft();
    });

    backButton.addEventListener("click", () => {
      if (state.mode === "practice") return;
      saveCurrentResponse();
      if (state.current > 0) {
        state.current -= 1;
        renderItem();
        saveDraft();
      }
    });

    confidence.addEventListener("input", () => {
      confidenceOutput.value = confidence.value;
    });

    unknown.addEventListener("change", () => {
      answerEnglish.disabled = unknown.checked;
      answerJapanese.disabled = unknown.checked;
      if (unknown.checked) {
        answerEnglish.value = "";
        answerJapanese.value = "";
      }
    });

    downloadButton.addEventListener("click", () => {
      state.downloadedFilename = downloadCsv(buildRows());
      updateCompletionMessage();
    });

    emailButton.addEventListener("click", (event) => {
      if (!config.submissionEmail) {
        event.preventDefault();
        return;
      }
      emailButton.href = buildMailtoLink();
    });

    restartButton.addEventListener("click", () => {
      localStorage.removeItem(storageKey);
      window.location.reload();
    });

    window.addEventListener("beforeunload", () => {
      if (views.task.classList.contains("is-active")) {
        saveCurrentResponse();
        saveDraft();
      }
    });
  }

  function renderItem() {
    const item = getCurrentItem();
    const saved = state.responses[item.itemId] || {};

    passage.innerHTML = blankPlaceholder(item.prompt);
    answerEnglish.value = saved.answerEnglish || "";
    answerJapanese.value = saved.answerJapanese || "";
    unknown.checked = Boolean(saved.unknown);
    answerEnglish.disabled = unknown.checked;
    answerJapanese.disabled = unknown.checked;
    confidence.value = saved.confidence || "50";
    confidenceOutput.value = confidence.value;

    if (state.mode === "practice") {
      document.getElementById("task-title").textContent = "練習";
      progressLabel.textContent = "練習";
      progressBar.style.width = "0%";
      backButton.disabled = true;
      nextButton.textContent = "本番へ";
    } else {
      document.getElementById("task-title").textContent = "空欄補充";
      progressLabel.textContent = `${state.current + 1} / ${state.order.length}`;
      progressBar.style.width = `${((state.current + 1) / state.order.length) * 100}%`;
      backButton.disabled = state.current === 0;
      nextButton.textContent = state.current === state.order.length - 1 ? "完了" : "次へ";
    }
    state.itemStartedAt = performance.now();
    state.itemStartedAtIso = new Date().toISOString();
    answerEnglish.focus();
  }

  function validateCurrentResponse() {
    if (unknown.checked) return true;

    const hasEnglish = answerEnglish.value.trim().length > 0;
    const hasJapanese = answerJapanese.value.trim().length > 0;
    if (hasEnglish || hasJapanese) return true;

    answerEnglish.setCustomValidity("英語または日本語の候補を入力するか、「文脈だけでは判断できない」を選んでください。");
    answerEnglish.reportValidity();
    answerEnglish.setCustomValidity("");
    return false;
  }

  function saveCurrentResponse() {
    const item = getCurrentItem();
    if (!item) return;

    const previous = state.responses[item.itemId] || {};
    const elapsed = Math.max(0, Math.round(performance.now() - state.itemStartedAt));

    state.responses[item.itemId] = {
      itemId: item.itemId,
      stem: item.stem,
      itemVersion: item.itemVersion,
      prompt: item.prompt,
      phase: state.mode,
      answerEnglish: answerEnglish.value.trim(),
      answerJapanese: answerJapanese.value.trim(),
      unknown: unknown.checked,
      confidence: Number(confidence.value),
      responseTimeMs: (previous.responseTimeMs || 0) + elapsed,
      shownAt: previous.shownAt || state.itemStartedAtIso || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      order: state.current + 1
    };
  }

  async function finishSurvey() {
    state.completedAt = new Date().toISOString();
    showView("done");
    submitStatus.textContent = "回答データをCSVとして保存しています。";
    saveDraft();

    if (config.autoDownloadCsv) {
      state.downloadedFilename = downloadCsv(buildRows());
    }

    updateCompletionMessage();
    localStorage.removeItem(storageKey);
  }

  function buildRows() {
    return state.order.map((index, position) => {
      const item = state.items[index];
      const response = state.responses[item.itemId] || {};
      return {
        study_id: config.studyId,
        session_id: state.sessionId,
        participant_id: state.participant.participantId || "",
        group_code: state.participant.groupCode || "",
        english_level: state.participant.englishLevel || "",
        eiken_level: state.participant.eikenLevel || "",
        other_qualification: state.participant.otherQualification || "",
        started_at: state.startedAt,
        completed_at: state.completedAt || "",
        item_order: position + 1,
        item_id: item.itemId,
        stem: item.stem,
        item_version: item.itemVersion,
        blank_label: item.blankLabel,
        response: response.answerEnglish || "",
        response_english: response.answerEnglish || "",
        response_japanese: response.answerJapanese || "",
        n_english_candidates: countCandidates(response.answerEnglish || ""),
        n_japanese_candidates: countCandidates(response.answerJapanese || ""),
        unknown: response.unknown ? "1" : "0",
        confidence: response.confidence ?? "",
        response_time_ms: response.responseTimeMs ?? "",
        item_started_at: response.shownAt || "",
        item_completed_at: response.updatedAt || "",
        viewport_width: window.innerWidth,
        viewport_height: window.innerHeight,
        screen_width: window.screen ? window.screen.width : "",
        screen_height: window.screen ? window.screen.height : "",
        browser_language: navigator.language || "",
        updated_at: response.updatedAt || ""
      };
    });
  }

  function getCurrentItem() {
    if (state.mode === "practice") {
      return normalizeItem(config.practiceItem);
    }
    return state.items[state.order[state.current]];
  }

  function normalizeItem(row) {
    return {
      itemId: row.itemId || row.item_id,
      stem: row.stem,
      itemVersion: row.itemVersion || row.item_version || "",
      blankLabel: row.blankLabel || row.blank_label || "XXXX",
      prompt: row.prompt || row.item_prompt
    };
  }

  function blankPlaceholder(text) {
    const escaped = escapeHtml(text);
    return escaped.replace(/\bXXXX[A-Za-z]*\b/g, (match) => (
      `<span class="blank" aria-label="${escapeHtml(match)}">${escapeHtml(match)}</span>`
    ));
  }

  function showView(name) {
    Object.values(views).forEach((view) => view.classList.remove("is-active"));
    views[name].classList.add("is-active");
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let value = "";
    let quoted = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];

      if (char === '"' && quoted && next === '"') {
        value += '"';
        i += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === "," && !quoted) {
        row.push(value);
        value = "";
      } else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && next === "\n") i += 1;
        row.push(value);
        rows.push(row);
        row = [];
        value = "";
      } else {
        value += char;
      }
    }

    if (value.length || row.length) {
      row.push(value);
      rows.push(row);
    }

    const header = rows.shift().map((name) => name.trim().replace(/^\uFEFF/, ""));
    return rows
      .filter((cells) => cells.some((cell) => cell.trim().length))
      .map((cells) => Object.fromEntries(header.map((name, index) => [name, cells[index] || ""])));
  }

  function downloadCsv(rows) {
    const header = Object.keys(rows[0]);
    const csv = [
      header.join(","),
      ...rows.map((row) => header.map((key) => csvCell(row[key])).join(","))
    ].join("\n");
    const filename = buildCsvFilename();

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return filename;
  }

  function buildCsvFilename() {
    const participant = sanitizeFilenamePart(state.participant.participantId || "anonymous");
    const session = sanitizeFilenamePart(state.sessionId);
    return `${sanitizeFilenamePart(config.studyId)}_${participant}_${session}.csv`;
  }

  function sanitizeFilenamePart(value) {
    return String(value || "")
      .trim()
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "na";
  }

  function updateCompletionMessage() {
    const filename = state.downloadedFilename || buildCsvFilename();
    submitStatus.innerHTML = config.autoDownloadCsv
      ? `CSVファイル <code>${escapeHtml(filename)}</code> を保存しました。`
      : `CSVファイル <code>${escapeHtml(filename)}</code> を保存してください。`;

    if (config.submissionEmail) {
      emailInstruction.innerHTML =
        `保存されたCSVファイルを <strong>${escapeHtml(config.submissionEmail)}</strong> 宛のメールに添付して提出してください。`;
      emailButton.classList.remove("is-hidden");
      emailButton.href = buildMailtoLink();
    } else {
      emailInstruction.textContent = "保存されたCSVファイルを指定された提出先メールアドレスへ添付して提出してください。";
      emailButton.classList.add("is-hidden");
    }
  }

  function buildMailtoLink() {
    const filename = state.downloadedFilename || buildCsvFilename();
    const subject = config.emailSubject || "GCT Cloze Survey CSV Submission";
    const body = [
      "回答CSVを添付して提出します。",
      "",
      `Study ID: ${config.studyId}`,
      `Participant ID: ${state.participant.participantId || ""}`,
      `Session ID: ${state.sessionId}`,
      `CSV filename: ${filename}`,
      "",
      "このメールにCSVファイルを添付して送信してください。"
    ].join("\n");
    return `mailto:${encodeURIComponent(config.submissionEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  function csvCell(value) {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function saveDraft() {
    localStorage.setItem(storageKey, JSON.stringify({
      sessionId: state.sessionId,
      startedAt: state.startedAt,
      participant: state.participant,
      order: state.order,
      current: state.current,
      mode: state.mode,
      practiceCompleted: state.practiceCompleted,
      responses: state.responses
    }));
  }

  function restoreDraft() {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return;

    try {
      const draft = JSON.parse(raw);
      Object.assign(state, {
        sessionId: draft.sessionId || state.sessionId,
        startedAt: draft.startedAt || state.startedAt,
        participant: draft.participant || {},
        order: Array.isArray(draft.order) && draft.order.length ? draft.order : state.order,
        current: Number.isInteger(draft.current) ? draft.current : 0,
        mode: draft.mode || state.mode,
        practiceCompleted: Boolean(draft.practiceCompleted),
        responses: draft.responses || {}
      });

      participantId.value = state.participant.participantId || "";
      groupCode.value = state.participant.groupCode || "";
      englishLevel.value = state.participant.englishLevel || "";
      eikenLevel.value = state.participant.eikenLevel || "";
      otherQualification.value = state.participant.otherQualification || "";

      if (state.mode === "practice" || state.mode === "task") {
        showView("task");
        renderItem();
      }
    } catch {
      localStorage.removeItem(storageKey);
    }
  }

  function updateDownloadVisibility() {
    if (!config.allowCsvDownload) {
      downloadButton.classList.add("is-hidden");
    }
  }

  function countCandidates(value) {
    return splitCandidates(value).length;
  }

  function splitCandidates(value) {
    return String(value || "")
      .split(/[\n,，、;；/]+/)
      .map((candidate) => candidate.trim())
      .filter(Boolean);
  }

  function shuffle(array) {
    for (let i = array.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[char]);
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function makeId() {
    return "session-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
})();
