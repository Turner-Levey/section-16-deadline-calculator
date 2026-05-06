(function () {
  "use strict";

  const today = new Date();
  const form = document.querySelector("#deadline-form");
  const results = document.querySelector("#results");
  const output = document.querySelector("#memo-output");
  const fields = {
    reportingPerson: document.querySelector("#reporting-person"),
    issuer: document.querySelector("#issuer"),
    scenario: document.querySelector("#scenario"),
    triggerDate: document.querySelector("#trigger-date"),
    triggerMode: document.querySelector("#trigger-mode"),
    actualFilingDate: document.querySelector("#actual-filing-date"),
    edgarStatus: document.querySelector("#edgar-status"),
    fpiStatus: document.querySelector("#fpi-status"),
    closureDates: document.querySelector("#closure-dates"),
    ownershipNote: document.querySelector("#ownership-note"),
    nextStep: document.querySelector("#next-step")
  };

  const scenarioDetails = {
    form3: {
      form: "Form 3",
      label: "Initial beneficial ownership statement",
      rule: "within 10 days after the person becomes an insider",
      horizon: "10 calendar days",
      csvKey: "form_3"
    },
    form4: {
      form: "Form 4",
      label: "Change in beneficial ownership",
      rule: "within two business days following the transaction date, unless a specific deemed execution date applies",
      horizon: "2 business days",
      csvKey: "form_4"
    },
    form5: {
      form: "Form 5",
      label: "Annual catch-up report",
      rule: "generally no later than 45 days after the issuer fiscal year ends",
      horizon: "45 calendar days",
      csvKey: "form_5"
    }
  };

  const toIsoDate = (date) => date.toISOString().slice(0, 10);
  fields.triggerDate.value = toIsoDate(today);

  function getValue(key) {
    return fields[key].value.trim();
  }

  function parseIsoDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function addCalendarDays(date, days) {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
  }

  function observedDate(year, monthIndex, day) {
    const date = new Date(Date.UTC(year, monthIndex, day, 12));
    const weekday = date.getUTCDay();
    if (weekday === 0) return addCalendarDays(date, 1);
    if (weekday === 6) return addCalendarDays(date, -1);
    return date;
  }

  function nthWeekday(year, monthIndex, weekday, occurrence) {
    const first = new Date(Date.UTC(year, monthIndex, 1, 12));
    const offset = (weekday - first.getUTCDay() + 7) % 7;
    return new Date(Date.UTC(year, monthIndex, 1 + offset + (occurrence - 1) * 7, 12));
  }

  function lastWeekday(year, monthIndex, weekday) {
    const last = new Date(Date.UTC(year, monthIndex + 1, 0, 12));
    const offset = (last.getUTCDay() - weekday + 7) % 7;
    return addCalendarDays(last, -offset);
  }

  function standardFederalHolidaySet(year) {
    return new Set([
      observedDate(year, 0, 1),
      nthWeekday(year, 0, 1, 3),
      nthWeekday(year, 1, 1, 3),
      lastWeekday(year, 4, 1),
      observedDate(year, 5, 19),
      observedDate(year, 6, 4),
      nthWeekday(year, 8, 1, 1),
      nthWeekday(year, 9, 1, 2),
      observedDate(year, 10, 11),
      nthWeekday(year, 10, 4, 4),
      observedDate(year, 11, 25)
    ].map(toIsoDate));
  }

  function closureSetFor(anchorDate) {
    const years = [
      anchorDate.getUTCFullYear() - 1,
      anchorDate.getUTCFullYear(),
      anchorDate.getUTCFullYear() + 1
    ];
    const closures = new Set();
    years.forEach((year) => standardFederalHolidaySet(year).forEach((date) => closures.add(date)));
    getValue("closureDates")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item))
      .forEach((date) => closures.add(date));
    return closures;
  }

  function isBusinessDay(date, closures) {
    const day = date.getUTCDay();
    return day !== 0 && day !== 6 && !closures.has(toIsoDate(date));
  }

  function nextBusinessDay(date, closures) {
    let next = new Date(date);
    while (!isBusinessDay(next, closures)) {
      next = addCalendarDays(next, 1);
    }
    return next;
  }

  function addBusinessDays(date, days, closures) {
    let next = new Date(date);
    let remaining = days;
    while (remaining > 0) {
      next = addCalendarDays(next, 1);
      if (isBusinessDay(next, closures)) {
        remaining -= 1;
      }
    }
    return next;
  }

  function daysBetween(from, to) {
    const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
    const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
    return Math.round((end - start) / 86400000);
  }

  function formatDate(date) {
    return date ? toIsoDate(date) : "not entered";
  }

  function csvEscape(value) {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function edgarAction(statusValue, dueDate) {
    if (statusValue === "EDGAR access and codes confirmed") {
      return `EDGAR access is marked confirmed; plan direct transmission by 10 p.m. Eastern on ${formatDate(dueDate)}.`;
    }
    if (statusValue === "Filing agent confirmed") {
      return `Filing agent is marked confirmed; verify source data, signatures, and transmission responsibility before ${formatDate(dueDate)}.`;
    }
    if (statusValue === "CIK exists, codes not confirmed") {
      return `Confirm EDGAR access codes, role authorization, and signature authority before ${formatDate(dueDate)}.`;
    }
    if (statusValue === "No EDGAR access confirmed yet") {
      return `Start EDGAR access and filer-code verification immediately; the planning target is ${formatDate(dueDate)}.`;
    }
    return "Confirm EDGAR access, filing agent coverage, and same-day filing capability.";
  }

  function computeDueDate(scenario, triggerDate, closures) {
    if (scenario === "form4") {
      const dueDate = addBusinessDays(triggerDate, 2, closures);
      return {
        rawDueDate: dueDate,
        adjustedDueDate: dueDate,
        moveNote: "Form 4 uses a business-day count from the entered trigger date."
      };
    }

    const rawDueDate = addCalendarDays(triggerDate, scenario === "form3" ? 10 : 45);
    const adjustedDueDate = nextBusinessDay(rawDueDate, closures);
    return {
      rawDueDate,
      adjustedDueDate,
      moveNote: formatDate(rawDueDate) === formatDate(adjustedDueDate)
        ? "No weekend or closure move was applied."
        : "The raw calendar target moved to the next business day."
    };
  }

  function scenarioWarning(scenario, mode) {
    if (scenario === "form3" && mode !== "Insider status date") {
      return "For Form 3, the trigger date should generally be the date the person became a reporting insider.";
    }
    if (scenario === "form4" && mode === "Fiscal year end date") {
      return "For Form 4, use the transaction date or a verified deemed execution date, not fiscal year end.";
    }
    if (scenario === "form5" && mode !== "Fiscal year end date") {
      return "For Form 5, the trigger date should generally be the issuer fiscal year end.";
    }
    return "";
  }

  function calculate() {
    const triggerDate = parseIsoDate(getValue("triggerDate"));
    if (!triggerDate) {
      throw new Error("Enter a valid trigger date.");
    }
    const scenario = getValue("scenario");
    const details = scenarioDetails[scenario];
    const closures = closureSetFor(triggerDate);
    const { rawDueDate, adjustedDueDate, moveNote } = computeDueDate(scenario, triggerDate, closures);
    const actualFilingDate = parseIsoDate(getValue("actualFilingDate"));
    const todayDate = parseIsoDate(toIsoDate(today));
    const daysUntilDue = daysBetween(todayDate, adjustedDueDate);

    let statusLabel = "Open";
    if (actualFilingDate) {
      statusLabel = actualFilingDate <= adjustedDueDate ? "Filed by calculated target" : "Filed after calculated target";
    } else if (daysUntilDue < 0) {
      statusLabel = "Past calculated target";
    } else if (daysUntilDue <= 2) {
      statusLabel = "Urgent";
    } else if (daysUntilDue <= 7) {
      statusLabel = "Soon";
    }

    const warnings = [
      "This worksheet does not determine Section 16 filer status, beneficial ownership, transaction code, exemption availability, issuer status, or whether a Form 4 versus Form 5 report is required."
    ];
    if (moveNote.includes("moved")) {
      warnings.push("The raw calendar target moved because of weekend or closure handling.");
    }
    const scenarioMismatch = scenarioWarning(scenario, getValue("triggerMode"));
    if (scenarioMismatch) {
      warnings.push(scenarioMismatch);
    }
    if (getValue("edgarStatus") !== "EDGAR access and codes confirmed" && getValue("edgarStatus") !== "Filing agent confirmed") {
      warnings.push("EDGAR filing access is not marked ready.");
    }
    if (getValue("fpiStatus") !== "Not applicable / domestic issuer") {
      warnings.push("Foreign private issuer status is flagged; verify the 2026 HFIA amendments and any transition filing facts.");
    }
    if (statusLabel.includes("Past") || statusLabel.includes("after")) {
      warnings.push("Review late-filing disclosure, corrective filing, and internal escalation steps with counsel.");
    }

    return {
      reportingPerson: getValue("reportingPerson") || "Unnamed reporting person",
      issuer: getValue("issuer") || "Unnamed issuer",
      scenario,
      form: details.form,
      scenarioLabel: details.label,
      rule: details.rule,
      horizon: details.horizon,
      csvKey: details.csvKey,
      triggerDate,
      triggerMode: getValue("triggerMode"),
      rawDueDate,
      adjustedDueDate,
      actualFilingDate,
      statusLabel,
      daysUntilDue,
      moveNote,
      edgarNote: edgarAction(getValue("edgarStatus"), adjustedDueDate),
      fpiStatus: getValue("fpiStatus"),
      ownershipNote: getValue("ownershipNote") || "Verify source facts.",
      nextStep: getValue("nextStep") || "Verify source facts with counsel.",
      warnings
    };
  }

  function renderResult(data) {
    const daysText = data.actualFilingDate
      ? `filed ${daysBetween(data.adjustedDueDate, data.actualFilingDate)} day(s) from target`
      : `${data.daysUntilDue} day(s) from today`;
    results.innerHTML = [
      `<div><span class="label">Status</span><strong>${data.statusLabel}</strong></div>`,
      `<div><span class="label">${data.form} target</span><strong>${formatDate(data.adjustedDueDate)}</strong><small>${daysText}</small></div>`,
      `<div><span class="label">Trigger date</span><strong>${formatDate(data.triggerDate)}</strong><small>${data.horizon}</small></div>`,
      `<div><span class="label">Raw date</span><strong>${formatDate(data.rawDueDate)}</strong><small>${data.moveNote}</small></div>`
    ].join("");
  }

  function buildMemo(data) {
    return [
      "# Section 16 Deadline Planning Memo",
      "",
      `Reporting person: ${data.reportingPerson}`,
      `Issuer: ${data.issuer}`,
      `Scenario: ${data.form} - ${data.scenarioLabel}`,
      `Trigger date entered: ${formatDate(data.triggerDate)}`,
      `Trigger date meaning: ${data.triggerMode}`,
      `Deadline rule used: ${data.rule}`,
      `Raw target date: ${formatDate(data.rawDueDate)}`,
      `Calculated planning target: ${formatDate(data.adjustedDueDate)}`,
      `Actual filing date: ${formatDate(data.actualFilingDate)}`,
      `Current status: ${data.statusLabel}`,
      `EDGAR readiness note: ${data.edgarNote}`,
      `FPI / HFIA note: ${data.fpiStatus}`,
      `Transaction or ownership note: ${data.ownershipNote}`,
      `Next verification step: ${data.nextStep}`,
      "",
      "Warnings:",
      ...data.warnings.map((warning) => `- ${warning}`),
      "",
      "Source notes: Investor.gov describes Form 3 as due within 10 days after a person becomes an insider, Form 4 as due within two business days following the transaction date, and Form 5 as generally due no later than 45 days after the issuer fiscal year ends. SEC EDGAR materials say EDGAR accepts filings from 6 a.m. to 10 p.m. Eastern on weekdays except federal holidays and that filings outside those hours are processed the next business day. SEC rule materials also describe limited deemed execution date handling for some Form 4 transactions and 2026 HFIA amendments for directors and officers of certain foreign private issuers.",
      "",
      "Official sources:",
      "- https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins-69",
      "- https://www.sec.gov/submit-filings",
      "- https://www.sec.gov/rules-regulations/2002/08/ownership-reports-trading-officers-directors-principal-security-holders",
      "- https://www.sec.gov/rules-regulations/2003/05/mandated-electronic-filing-web-site-posting-forms-3-4-5",
      "- https://www.sec.gov/files/rules/final/2026/34-104903.pdf",
      "",
      "Disclosure: informational planning worksheet only; not legal advice, securities advice, beneficial ownership analysis, late-filing cure advice, an EDGAR filing service, or an official SEC tool."
    ].join("\n");
  }

  function buildCsv(data) {
    const headers = [
      "reporting_person",
      "issuer",
      "form",
      "scenario",
      "trigger_date",
      "trigger_mode",
      "raw_target_date",
      "calculated_planning_target",
      "actual_filing_date",
      "status",
      "edgar_note",
      "fpi_hfia_note",
      "ownership_note",
      "next_step"
    ];
    const row = [
      data.reportingPerson,
      data.issuer,
      data.csvKey,
      data.scenarioLabel,
      formatDate(data.triggerDate),
      data.triggerMode,
      formatDate(data.rawDueDate),
      formatDate(data.adjustedDueDate),
      formatDate(data.actualFilingDate),
      data.statusLabel,
      data.edgarNote,
      data.fpiStatus,
      data.ownershipNote,
      data.nextStep
    ];
    return `${headers.join(",")}\n${row.map(csvEscape).join(",")}\n`;
  }

  function setButtonCopied(button) {
    const original = button.textContent;
    button.textContent = "Copied";
    window.setTimeout(() => {
      button.textContent = original;
    }, 1200);
  }

  async function copyText(text, button) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      output.focus();
      output.select();
      document.execCommand("copy");
    }
    setButtonCopied(button);
  }

  function runCalculation() {
    try {
      const data = calculate();
      renderResult(data);
      output.value = buildMemo(data);
      return data;
    } catch (error) {
      results.innerHTML = `<div><span class="label">Input needed</span><strong>${error.message}</strong></div>`;
      output.value = "";
      throw error;
    }
  }

  function safeRunCalculation() {
    try {
      runCalculation();
    } catch {
      // The result band already shows the input issue.
    }
  }

  fields.scenario.addEventListener("change", () => {
    if (fields.scenario.value === "form3") fields.triggerMode.value = "Insider status date";
    if (fields.scenario.value === "form4") fields.triggerMode.value = "Transaction date or execution date";
    if (fields.scenario.value === "form5") fields.triggerMode.value = "Fiscal year end date";
  });

  form.addEventListener("input", safeRunCalculation);
  form.addEventListener("change", safeRunCalculation);
  document.querySelector("#calculate").addEventListener("click", safeRunCalculation);
  document.querySelector("#copy-memo").addEventListener("click", (event) => {
    const data = output.value.trim() ? calculate() : runCalculation();
    copyText(output.value || buildMemo(data), event.currentTarget).catch(() => {});
  });
  document.querySelector("#copy-csv").addEventListener("click", (event) => {
    copyText(buildCsv(calculate()), event.currentTarget).catch(() => {});
  });
  document.querySelector("#download-csv").addEventListener("click", () => {
    const blob = new Blob([buildCsv(calculate())], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "section-16-deadline.csv";
    link.click();
    URL.revokeObjectURL(url);
  });

  runCalculation();
}());
