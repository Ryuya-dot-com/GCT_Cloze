(function () {
  "use strict";

  const externalConfig = window.CLOZE_CONFIG || {};
  const defaultAutoDownloadWorkbook = externalConfig.autoDownloadWorkbook ?? externalConfig.autoDownloadCsv ?? true;
  const defaultAllowWorkbookDownload = externalConfig.allowWorkbookDownload ?? externalConfig.allowCsvDownload ?? true;
  const config = Object.assign({
    studyId: "gct-cloze",
    itemsCsv: "data/cloze_items.csv",
    submissionEmail: "",
    emailSubject: "GCT Context Reading Activity Workbook Submission",
    autoDownloadWorkbook: defaultAutoDownloadWorkbook,
    enablePractice: true,
    practiceItems: [
      {
        itemId: "practice_weather",
        stem: "practice_weather",
        itemVersion: "practice_v2_context",
        blankLabel: "XXXX",
        prompt: "The rain stopped just before the picnic. The grass was still XXXX, so everyone put a blanket on the ground before sitting down."
      },
      {
        itemId: "practice_past_action",
        stem: "practice_past_action",
        itemVersion: "practice_v2_form_ed",
        blankLabel: "XXXXed",
        prompt: "The baby was sleeping in the next room, so Mika XXXXed the door slowly and walked away without making a sound."
      },
      {
        itemId: "practice_adverb",
        stem: "practice_adverb",
        itemVersion: "practice_v2_form_ly",
        blankLabel: "XXXXly",
        prompt: "The classroom was large, and some students were sitting far from the front. The teacher spoke XXXXly so that everyone could hear each word."
      },
      {
        itemId: "practice_thirst",
        stem: "practice_thirst",
        itemVersion: "practice_v2_noun",
        blankLabel: "XXXX",
        prompt: "Ken forgot to bring a bottle of water. After running for thirty minutes under the sun, his XXXX became very strong."
      }
    ],
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
    allowWorkbookDownload: defaultAllowWorkbookDownload
  }, externalConfig);

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
    downloadedFilename: "",
    pendingDraft: null
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
  const draftBanner = document.getElementById("draft-banner");
  const resumeDraftButton = document.getElementById("resume-draft-button");
  const clearDraftButton = document.getElementById("clear-draft-button");
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

      clearPendingDraft(false);
      state.current = 0;
      state.mode = config.enablePractice && getPracticeItems().length ? "practice" : "task";
      showView("task");
      renderItem();
      saveDraft();
    });

    responseForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!validateCurrentResponse()) return;
      saveCurrentResponse();

      if (state.mode === "practice") {
        const practiceItems = getPracticeItems();
        if (state.current < practiceItems.length - 1) {
          state.current += 1;
        } else {
          state.practiceCompleted = true;
          state.mode = "task";
          state.current = 0;
        }
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
      state.downloadedFilename = downloadWorkbook(buildWorkbookSheets());
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

    resumeDraftButton.addEventListener("click", () => {
      if (!state.pendingDraft) return;
      applyDraft(state.pendingDraft);
      state.pendingDraft = null;
      draftBanner.classList.add("is-hidden");
      showView("task");
      renderItem();
    });

    clearDraftButton.addEventListener("click", () => {
      clearPendingDraft(true);
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
    const saved = recordItemVisit(item);

    passage.innerHTML = blankPlaceholder(item.prompt);
    answerEnglish.value = saved.answerEnglish || "";
    answerJapanese.value = saved.answerJapanese || "";
    unknown.checked = Boolean(saved.unknown);
    answerEnglish.disabled = unknown.checked;
    answerJapanese.disabled = unknown.checked;
    confidence.value = saved.confidence || "50";
    confidenceOutput.value = confidence.value;

    if (state.mode === "practice") {
      const practiceItems = getPracticeItems();
      const progress = practiceItems.length ? ((state.current + 1) / practiceItems.length) * 100 : 0;
      const isLastPractice = state.current >= practiceItems.length - 1;
      document.getElementById("task-title").textContent = "練習";
      progressLabel.textContent = `練習 ${state.current + 1} / ${practiceItems.length}`;
      progressBar.style.width = `${progress}%`;
      backButton.disabled = true;
      nextButton.textContent = isLastPractice ? "本番へ" : "次の練習";
    } else {
      document.getElementById("task-title").textContent = "文脈から推測";
      progressLabel.textContent = `${state.current + 1} / ${state.order.length}`;
      progressBar.style.width = `${((state.current + 1) / state.order.length) * 100}%`;
      backButton.disabled = state.current === 0;
      nextButton.textContent = state.current === state.order.length - 1 ? "完了" : "次へ";
    }
    state.itemStartedAt = performance.now();
    state.itemStartedAtIso = new Date().toISOString();
    answerEnglish.focus();
  }

  function recordItemVisit(item) {
    const previous = state.responses[item.itemId] || {};
    const now = new Date().toISOString();
    const visitCount = (previous.visitCount || 0) + 1;

    state.responses[item.itemId] = Object.assign({}, previous, {
      itemId: item.itemId,
      stem: item.stem,
      itemVersion: item.itemVersion,
      prompt: item.prompt,
      phase: state.mode,
      order: state.current + 1,
      visitCount,
      firstShownAt: previous.firstShownAt || now,
      lastShownAt: now
    });

    return state.responses[item.itemId];
  }

  function validateCurrentResponse() {
    if (unknown.checked) return true;

    const hasEnglish = answerEnglish.value.trim().length > 0;
    const hasJapanese = answerJapanese.value.trim().length > 0;
    if (hasEnglish || hasJapanese) return true;

    answerEnglish.setCustomValidity("英語または日本語の候補を入力するか、「手がかりだけでは判断できない」を選んでください。");
    answerEnglish.reportValidity();
    answerEnglish.setCustomValidity("");
    return false;
  }

  function saveCurrentResponse() {
    const item = getCurrentItem();
    if (!item) return;

    const previous = state.responses[item.itemId] || {};
    const elapsed = Math.max(0, Math.round(performance.now() - state.itemStartedAt));
    const currentAnswerEnglish = answerEnglish.value.trim();
    const currentAnswerJapanese = answerJapanese.value.trim();
    const hasSavedResponse = Boolean(previous.updatedAt);
    const revised = hasSavedResponse && (
      previous.answerEnglish !== currentAnswerEnglish ||
      previous.answerJapanese !== currentAnswerJapanese ||
      Boolean(previous.unknown) !== unknown.checked
    );

    state.responses[item.itemId] = Object.assign({}, previous, {
      itemId: item.itemId,
      stem: item.stem,
      itemVersion: item.itemVersion,
      prompt: item.prompt,
      phase: state.mode,
      answerEnglish: currentAnswerEnglish,
      answerJapanese: currentAnswerJapanese,
      unknown: unknown.checked,
      confidence: Number(confidence.value),
      firstResponseTimeMs: previous.firstResponseTimeMs ?? elapsed,
      responseTimeMs: (previous.responseTimeMs || 0) + elapsed,
      shownAt: previous.shownAt || state.itemStartedAtIso || new Date().toISOString(),
      firstShownAt: previous.firstShownAt || state.itemStartedAtIso || new Date().toISOString(),
      lastShownAt: previous.lastShownAt || state.itemStartedAtIso || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      visitCount: previous.visitCount ?? 1,
      revised: Boolean(previous.revised || revised),
      order: state.current + 1
    });
  }

  async function finishSurvey() {
    state.completedAt = new Date().toISOString();
    showView("done");
    submitStatus.textContent = "回答データをExcelファイルとしてダウンロードしています。";
    saveDraft();

    if (config.autoDownloadWorkbook) {
      state.downloadedFilename = downloadWorkbook(buildWorkbookSheets());
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
        first_response_time_ms: response.firstResponseTimeMs ?? "",
        response_time_ms: response.responseTimeMs ?? "",
        visit_count: response.visitCount ?? "",
        revised: response.revised ? "1" : "0",
        item_started_at: response.shownAt || "",
        first_shown_at: response.firstShownAt || response.shownAt || "",
        last_shown_at: response.lastShownAt || "",
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

  function buildWorkbookSheets() {
    const rows = buildRows();
    const answeredRows = rows.filter((row) => (
      row.response_english || row.response_japanese || row.unknown === "1"
    ));
    const confidenceValues = rows
      .map((row) => Number(row.confidence))
      .filter((value) => Number.isFinite(value));
    const responseTimes = rows
      .map((row) => Number(row.response_time_ms))
      .filter((value) => Number.isFinite(value));
    const totalResponseTimeMs = responseTimes.reduce((sum, value) => sum + value, 0);
    const averageConfidence = confidenceValues.length
      ? roundTo(confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length, 1)
      : "";

    return [
      {
        name: "Summary",
        rows: [
          ["Field", "Value"],
          ["workbook_schema_version", "2"],
          ["generated_at", new Date().toISOString()],
          ["study_id", config.studyId],
          ["session_id", state.sessionId],
          ["participant_id", state.participant.participantId || ""],
          ["group_code", state.participant.groupCode || ""],
          ["english_level", state.participant.englishLevel || ""],
          ["eiken_level", state.participant.eikenLevel || ""],
          ["other_qualification", state.participant.otherQualification || ""],
          ["started_at", state.startedAt],
          ["completed_at", state.completedAt || ""],
          ["main_items", rows.length],
          ["answered_items", answeredRows.length],
          ["practice_items", getPracticeItems().length],
          ["practice_completed", state.practiceCompleted ? "1" : "0"],
          ["randomize_items", config.randomizeItems ? "1" : "0"],
          ["max_items", config.maxItems],
          ["items_csv", config.itemsCsv],
          ["unknown_count", rows.filter((row) => row.unknown === "1").length],
          ["average_confidence", averageConfidence],
          ["total_response_time_sec", roundTo(totalResponseTimeMs / 1000, 2)],
          ["browser_language", navigator.language || ""],
          ["viewport", `${window.innerWidth}x${window.innerHeight}`],
          ["screen", window.screen ? `${window.screen.width}x${window.screen.height}` : ""]
        ]
      },
      {
        name: "Main Responses",
        rows: objectRowsToSheet(rows, [
          "item_order",
          "item_id",
          "stem",
          "blank_label",
          "response_english",
          "response_japanese",
          "n_english_candidates",
          "n_japanese_candidates",
          "unknown",
          "confidence"
        ])
      },
      {
        name: "Item Order",
        rows: objectRowsToSheet(rows, [
          "item_order",
          "item_id",
          "stem",
          "item_version",
          "blank_label",
          "prompt"
        ])
      },
      {
        name: "解答時間",
        rows: objectRowsToSheet(rows.map((row) => Object.assign({}, row, {
          first_response_time_sec: row.first_response_time_ms === "" ? "" : roundTo(Number(row.first_response_time_ms) / 1000, 2),
          response_time_sec: row.response_time_ms === "" ? "" : roundTo(Number(row.response_time_ms) / 1000, 2)
        })), [
          "item_order",
          "item_id",
          "first_response_time_ms",
          "first_response_time_sec",
          "response_time_ms",
          "response_time_sec",
          "visit_count",
          "revised",
          "first_shown_at",
          "last_shown_at",
          "item_started_at",
          "item_completed_at"
        ])
      }
    ];
  }

  function getCurrentItem() {
    if (state.mode === "practice") {
      return getPracticeItems()[state.current];
    }
    return state.items[state.order[state.current]];
  }

  function getPracticeItems() {
    let source;
    if (Array.isArray(externalConfig.practiceItems) && externalConfig.practiceItems.length) {
      source = externalConfig.practiceItems;
    } else if (externalConfig.practiceItem) {
      source = [externalConfig.practiceItem];
    } else if (Array.isArray(config.practiceItems) && config.practiceItems.length) {
      source = config.practiceItems;
    } else {
      source = [config.practiceItem];
    }

    return source
      .map(normalizeItem)
      .filter((item) => item.itemId && item.prompt && item.prompt.includes("XXXX"));
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

  function objectRowsToSheet(rows, columns) {
    return [
      columns,
      ...rows.map((row) => columns.map((column) => row[column] ?? ""))
    ];
  }

  function roundTo(value, digits) {
    if (!Number.isFinite(value)) return "";
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  function downloadWorkbook(sheets) {
    const filename = buildWorkbookFilename();
    const blob = buildXlsxBlob(sheets);
    downloadBlob(blob, filename);
    return filename;
  }

  function buildXlsxBlob(sheets) {
    const files = buildXlsxFiles(sheets);
    return new Blob([createZip(files)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
  }

  function buildXlsxFiles(rawSheets) {
    const sheets = rawSheets.map((sheet, index) => ({
      name: sanitizeSheetName(sheet.name, index + 1),
      rows: sheet.rows
    }));
    const worksheetFiles = sheets.map((sheet, index) => ({
      path: `xl/worksheets/sheet${index + 1}.xml`,
      data: buildWorksheetXml(sheet.rows)
    }));

    return [
      { path: "[Content_Types].xml", data: buildContentTypesXml(sheets.length) },
      { path: "_rels/.rels", data: buildRootRelsXml() },
      { path: "docProps/core.xml", data: buildCorePropertiesXml() },
      { path: "docProps/app.xml", data: buildAppPropertiesXml(sheets) },
      { path: "xl/workbook.xml", data: buildWorkbookXml(sheets) },
      { path: "xl/_rels/workbook.xml.rels", data: buildWorkbookRelsXml(sheets.length) },
      { path: "xl/styles.xml", data: buildStylesXml() },
      ...worksheetFiles
    ];
  }

  function buildContentTypesXml(sheetCount) {
    const sheetOverrides = Array.from({ length: sheetCount }, (_, index) => (
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )).join("");

    return xmlDeclaration() +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
      `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      sheetOverrides +
      `</Types>`;
  }

  function buildRootRelsXml() {
    return xmlDeclaration() +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
      `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>` +
      `</Relationships>`;
  }

  function buildCorePropertiesXml() {
    const now = new Date().toISOString();
    return xmlDeclaration() +
      `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
      `xmlns:dc="http://purl.org/dc/elements/1.1/" ` +
      `xmlns:dcterms="http://purl.org/dc/terms/" ` +
      `xmlns:dcmitype="http://purl.org/dc/dcmitype/" ` +
      `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `<dc:title>GCT Context Reading Activity</dc:title>` +
      `<dc:creator>GCT Cloze</dc:creator>` +
      `<cp:lastModifiedBy>GCT Cloze</cp:lastModifiedBy>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${escapeXml(now)}</dcterms:created>` +
      `<dcterms:modified xsi:type="dcterms:W3CDTF">${escapeXml(now)}</dcterms:modified>` +
      `</cp:coreProperties>`;
  }

  function buildAppPropertiesXml(sheets) {
    const titles = sheets.map((sheet) => `<vt:lpstr>${escapeXml(sheet.name)}</vt:lpstr>`).join("");
    return xmlDeclaration() +
      `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ` +
      `xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
      `<Application>GCT Cloze</Application>` +
      `<HeadingPairs><vt:vector size="2" baseType="variant">` +
      `<vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant>` +
      `<vt:variant><vt:i4>${sheets.length}</vt:i4></vt:variant>` +
      `</vt:vector></HeadingPairs>` +
      `<TitlesOfParts><vt:vector size="${sheets.length}" baseType="lpstr">${titles}</vt:vector></TitlesOfParts>` +
      `</Properties>`;
  }

  function buildWorkbookXml(sheets) {
    const sheetXml = sheets.map((sheet, index) => (
      `<sheet name="${escapeXmlAttribute(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
    )).join("");

    return xmlDeclaration() +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<workbookViews><workbookView/></workbookViews>` +
      `<sheets>${sheetXml}</sheets>` +
      `</workbook>`;
  }

  function buildWorkbookRelsXml(sheetCount) {
    const sheetRels = Array.from({ length: sheetCount }, (_, index) => (
      `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
    )).join("");
    const styleRelId = sheetCount + 1;

    return xmlDeclaration() +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      sheetRels +
      `<Relationship Id="rId${styleRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`;
  }

  function buildStylesXml() {
    return xmlDeclaration() +
      `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<fonts count="2">` +
      `<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>` +
      `<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>` +
      `</fonts>` +
      `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
      `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="2">` +
      `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
      `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
      `</cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
      `</styleSheet>`;
  }

  function buildWorksheetXml(rows) {
    const rowCount = Math.max(rows.length, 1);
    const colCount = Math.max(...rows.map((row) => row.length), 1);
    const dimension = `A1:${columnName(colCount - 1)}${rowCount}`;
    const autoFilter = rows.length > 1 ? `<autoFilter ref="${dimension}"/>` : "";

    return xmlDeclaration() +
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<dimension ref="${dimension}"/>` +
      `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
      `<sheetFormatPr defaultRowHeight="15"/>` +
      buildColumnWidthsXml(rows, colCount) +
      `<sheetData>${rows.map((row, rowIndex) => buildRowXml(row, rowIndex)).join("")}</sheetData>` +
      autoFilter +
      `</worksheet>`;
  }

  function buildColumnWidthsXml(rows, colCount) {
    const cols = Array.from({ length: colCount }, (_, colIndex) => {
      const maxLength = rows.reduce((max, row) => {
        const value = row[colIndex];
        const text = value === null || value === undefined ? "" : String(value);
        return Math.max(max, ...text.split(/\r?\n/).map((part) => part.length));
      }, 0);
      const width = Math.min(Math.max(maxLength + 2, 10), 60);
      return `<col min="${colIndex + 1}" max="${colIndex + 1}" width="${width}" customWidth="1"/>`;
    }).join("");

    return `<cols>${cols}</cols>`;
  }

  function buildRowXml(row, rowIndex) {
    const cells = row.map((value, colIndex) => buildCellXml(value, rowIndex, colIndex)).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }

  function buildCellXml(value, rowIndex, colIndex) {
    if (value === null || value === undefined || value === "") return "";

    const ref = `${columnName(colIndex)}${rowIndex + 1}`;
    const style = rowIndex === 0 ? ` s="1"` : "";
    if (typeof value === "number" && Number.isFinite(value)) {
      return `<c r="${ref}"${style}><v>${value}</v></c>`;
    }

    const text = cleanXmlText(value);
    const preserve = /^\s|\s$|\r|\n/.test(text) ? ` xml:space="preserve"` : "";
    return `<c r="${ref}" t="inlineStr"${style}><is><t${preserve}>${escapeXml(text)}</t></is></c>`;
  }

  function sanitizeSheetName(name, index) {
    return String(name || `Sheet${index}`)
      .replace(/[\\/?*[\]:]/g, "_")
      .slice(0, 31) || `Sheet${index}`;
  }

  function columnName(index) {
    let name = "";
    let current = index + 1;
    while (current > 0) {
      const remainder = (current - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      current = Math.floor((current - 1) / 26);
    }
    return name;
  }

  function buildWorkbookFilename() {
    const participant = sanitizeFilenamePart(state.participant.participantId || "anonymous");
    const session = sanitizeFilenamePart(state.sessionId);
    return `${sanitizeFilenamePart(config.studyId)}_${participant}_${session}.xlsx`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function createZip(files) {
    const encoder = new TextEncoder();
    const now = toDosDateTime(new Date());
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    files.forEach((file) => {
      const nameBytes = encoder.encode(file.path);
      const dataBytes = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
      const checksum = crc32(dataBytes);
      const localHeader = new Uint8Array(30 + nameBytes.length);
      const localView = new DataView(localHeader.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, now.time, true);
      localView.setUint16(12, now.date, true);
      localView.setUint32(14, checksum, true);
      localView.setUint32(18, dataBytes.length, true);
      localView.setUint32(22, dataBytes.length, true);
      localView.setUint16(26, nameBytes.length, true);
      localHeader.set(nameBytes, 30);

      const centralHeader = new Uint8Array(46 + nameBytes.length);
      const centralView = new DataView(centralHeader.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, now.time, true);
      centralView.setUint16(14, now.date, true);
      centralView.setUint32(16, checksum, true);
      centralView.setUint32(20, dataBytes.length, true);
      centralView.setUint32(24, dataBytes.length, true);
      centralView.setUint16(28, nameBytes.length, true);
      centralView.setUint32(42, offset, true);
      centralHeader.set(nameBytes, 46);

      localParts.push(localHeader, dataBytes);
      centralParts.push(centralHeader);
      offset += localHeader.length + dataBytes.length;
    });

    const centralDirectory = concatBytes(centralParts);
    const localFiles = concatBytes(localParts);
    const endRecord = new Uint8Array(22);
    const endView = new DataView(endRecord.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, files.length, true);
    endView.setUint16(10, files.length, true);
    endView.setUint32(12, centralDirectory.length, true);
    endView.setUint32(16, localFiles.length, true);

    return concatBytes([localFiles, centralDirectory, endRecord]);
  }

  function concatBytes(parts) {
    const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
    const bytes = new Uint8Array(totalLength);
    let offset = 0;
    parts.forEach((part) => {
      bytes.set(part, offset);
      offset += part.length;
    });
    return bytes;
  }

  function crc32(bytes) {
    const table = crc32.table || (crc32.table = buildCrc32Table());
    let crc = 0xffffffff;
    bytes.forEach((byte) => {
      crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
    });
    return (crc ^ 0xffffffff) >>> 0;
  }

  function buildCrc32Table() {
    return Array.from({ length: 256 }, (_, index) => {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      return value >>> 0;
    });
  }

  function toDosDateTime(date) {
    const year = Math.max(date.getFullYear(), 1980);
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
  }

  function xmlDeclaration() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;
  }

  function cleanXmlText(value) {
    return String(value).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  }

  function escapeXml(value) {
    return cleanXmlText(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&apos;"
    })[char]);
  }

  function escapeXmlAttribute(value) {
    return escapeXml(value);
  }

  function sanitizeFilenamePart(value) {
    return String(value || "")
      .trim()
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "na";
  }

  function updateCompletionMessage() {
    const filename = state.downloadedFilename || buildWorkbookFilename();
    submitStatus.innerHTML = config.autoDownloadWorkbook
      ? `回答Excelファイル <code>${escapeHtml(filename)}</code> をダウンロードしました。`
      : `回答Excelファイル <code>${escapeHtml(filename)}</code> をダウンロードしてください。`;

    if (config.submissionEmail) {
      emailInstruction.innerHTML =
        `実施者の指示に従い、ダウンロードした回答Excelファイルを <strong>${escapeHtml(config.submissionEmail)}</strong> 宛のメールに添付して提出してください。`;
      emailButton.classList.remove("is-hidden");
      emailButton.href = buildMailtoLink();
    } else {
      emailInstruction.textContent = "実施者から指示がある場合は、ダウンロードした回答Excelファイルを提出してください。";
      emailButton.classList.add("is-hidden");
    }
  }

  function buildMailtoLink() {
    const filename = state.downloadedFilename || buildWorkbookFilename();
    const subject = config.emailSubject || "GCT Context Reading Activity Workbook Submission";
    const body = [
      "ダウンロードした回答Excelファイルを添付して提出します。",
      "",
      `Study ID: ${config.studyId}`,
      `Participant ID: ${state.participant.participantId || ""}`,
      `Session ID: ${state.sessionId}`,
      `Workbook filename: ${filename}`,
      "",
      "このメールにダウンロードしたExcelファイルを添付して送信してください。"
    ].join("\n");
    return `mailto:${encodeURIComponent(config.submissionEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
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
      if (!draft || !draft.responses || !["practice", "task"].includes(draft.mode)) {
        localStorage.removeItem(storageKey);
        return;
      }

      state.pendingDraft = draft;
      populateParticipantFields(draft.participant || {});
      draftBanner.classList.remove("is-hidden");
    } catch {
      localStorage.removeItem(storageKey);
    }
  }

  function applyDraft(draft) {
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
    normalizeCurrentPosition();
    populateParticipantFields(state.participant);
  }

  function clearPendingDraft(clearFields) {
    localStorage.removeItem(storageKey);
    state.pendingDraft = null;
    draftBanner.classList.add("is-hidden");
    if (clearFields) {
      populateParticipantFields({});
      consent.checked = false;
    }
  }

  function populateParticipantFields(participant) {
    participantId.value = participant.participantId || "";
    groupCode.value = participant.groupCode || "";
    englishLevel.value = participant.englishLevel || "";
    eikenLevel.value = participant.eikenLevel || "";
    otherQualification.value = participant.otherQualification || "";
  }

  function normalizeCurrentPosition() {
    if (state.mode === "practice") {
      const practiceCount = getPracticeItems().length;
      if (!practiceCount) {
        state.mode = "task";
        state.current = 0;
        return;
      }
      state.current = clampIndex(state.current, practiceCount);
      return;
    }

    state.current = clampIndex(state.current, state.order.length);
  }

  function updateDownloadVisibility() {
    if (!config.allowWorkbookDownload) {
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

  function clampIndex(value, length) {
    const index = Number.isInteger(value) ? value : 0;
    return Math.min(Math.max(index, 0), Math.max(length - 1, 0));
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
