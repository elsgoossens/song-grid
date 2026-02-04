// src/App.jsx
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { formatRhythm } from "./utils/formatRhythm.js";

/**
 * Split text into rows; each line -> row; each row -> words (whitespace split)
 */
function normalizeTextToRows(text) {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => l.split(/\s+/).filter(Boolean));
}

function measureTextPx(text, font) {
  const canvas =
    measureTextPx._c || (measureTextPx._c = document.createElement("canvas"));
  const ctx = canvas.getContext("2d");
  ctx.font = font;
  const s = String(text ?? "");
  return Math.ceil(ctx.measureText(s).width) + 4;
}

/**
 * Packs column indices into multiple lines so that each "row line"
 * fits into maxRowPx (no horizontal scrollbars).
 */
function packColumns(widths, maxRowPx) {
  const lines = [];
  let current = [];
  let currentW = 0;

  for (let i = 0; i < widths.length; i++) {
    const w = widths[i];

    if (current.length === 0) {
      current.push(i);
      currentW = w;
      continue;
    }

    if (currentW + w <= maxRowPx) {
      current.push(i);
      currentW += w;
      continue;
    }

    lines.push(current);
    current = [i];
    currentW = w;
  }

  if (current.length) lines.push(current);
  return lines;
}

export default function App() {
  const [rawText, setRawText] = useState("");

  // inputValues key: `${row}:${col}:${type}` where type: chord|rhythm|note
  const [inputValues, setInputValues] = useState({});

  // borders key: `${row}:${col}` -> {left,right}
  const [borders, setBorders] = useState({});

  const [isDragging, setIsDragging] = useState(false);

  // toggles (defaults: chords ON, rest OFF)
  const [showChords, setShowChords] = useState(true);
  const [showRhythm, setShowRhythm] = useState(false);
  const [showNotes, setShowNotes] = useState(false);

  // editing state (only used for rhythm “pretty view”)
  const [editingKey, setEditingKey] = useState(null); // e.g. "3:5:rhythm"
  const makeEditKey = (rowIndex, colIndex, type) =>
    `${rowIndex}:${colIndex}:${type}`;
  const isEditing = (rowIndex, colIndex, type) =>
    editingKey === makeEditKey(rowIndex, colIndex, type);

  const printableRef = useRef(null);
  const previewRef = useRef(null);

  const rows = useMemo(() => normalizeTextToRows(rawText), [rawText]);

  // width of preview container to avoid scrollbars (recompute on resize)
  const [previewWidth, setPreviewWidth] = useState(900);

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        setPreviewWidth(w);
      }
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const getBorderState = (rowIndex, colIndex) => {
    const key = `${rowIndex}:${colIndex}`;
    return borders[key] || { left: false, right: false };
  };

  const toggleBorder = (rowIndex, colIndex, side) => {
    const key = `${rowIndex}:${colIndex}`;
    setBorders((prev) => {
      const cur = prev[key] || { left: false, right: false };
      return { ...prev, [key]: { ...cur, [side]: !cur[side] } };
    });
  };

  const onWordCellClick = (e, rowIndex, colIndex) => {
    if (e.shiftKey) toggleBorder(rowIndex, colIndex, "left");
    else toggleBorder(rowIndex, colIndex, "right");
  };

  const getInputKey = (rowIndex, colIndex, type) =>
    `${rowIndex}:${colIndex}:${type}`;

  const getInputValue = (rowIndex, colIndex, type) => {
    const key = getInputKey(rowIndex, colIndex, type);
    return inputValues[key] || "";
  };

  const setInputValue = (rowIndex, colIndex, type, value) => {
    const key = getInputKey(rowIndex, colIndex, type);
    setInputValues((prev) => ({ ...prev, [key]: value }));
  };

  const onDropToTextarea = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const text = e.dataTransfer.getData("text/plain");
    if (text) setRawText((prev) => (prev ? `${prev}\n${text}` : text));
  };

  const onDragOverTextarea = (e) => {
    e.preventDefault();
    if (!isDragging) setIsDragging(true);
  };

  const onDragLeaveTextarea = () => setIsDragging(false);

  // PDF export: paginate by .lineGroup so spacing matches UI
  const exportPdf = async () => {
    const src = printableRef.current;
    if (!src) return;

    const SCALE = 2;

    // PDF page + margins (mm)
    const marginTopMm = 12;
    const marginBottomMm = 12;
    const marginLeftMm = 10;
    const marginRightMm = 10;

    // --- 1) Clone offscreen ---
    const clone = src.cloneNode(true);
    clone.classList.add("pdf-export");

    const holder = document.createElement("div");
    holder.style.position = "fixed";
    holder.style.left = "-10000px";
    holder.style.top = "0";
    holder.style.width = `${Math.ceil(src.getBoundingClientRect().width)}px`;
    holder.style.background = "#fff";
    holder.style.zIndex = "-1";
    holder.style.pointerEvents = "none";

    holder.appendChild(clone);
    document.body.appendChild(holder);

    try {
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));

      // --- 2) Replace inputs/textareas with plain divs (no placeholders in PDF) ---
      const formEls = clone.querySelectorAll("input, textarea");
      formEls.forEach((el) => {
        const raw = (el.value ?? "").toString();
        const type = el.getAttribute("data-type") || "";

        // show formatted rhythm in PDF
        const value = type === "rhythm" ? formatRhythm(raw) : raw;

        const fake = document.createElement("div");
        fake.className = "pdf-field";
        fake.textContent = value;

        el.replaceWith(fake);
      });

      clone.getBoundingClientRect();

      // --- 3) Setup PDF + compute max page height in PX (based on clone width) ---
      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidthMm = pdf.internal.pageSize.getWidth();
      const pageHeightMm = pdf.internal.pageSize.getHeight();

      const printableWidthMm = pageWidthMm - marginLeftMm - marginRightMm;
      const printableHeightMm = pageHeightMm - marginTopMm - marginBottomMm;

      const pageWidthPx = clone.getBoundingClientRect().width;
      const maxPageHeightPx = Math.floor(
        printableHeightMm * (pageWidthPx / printableWidthMm),
      );

      // --- 4) Build DOM pages based on .lineGroup ---
      const lineGroups = Array.from(clone.querySelectorAll(".lineGroup"));

      clone.innerHTML = "";

      const pages = [];
      const makePage = () => {
        const page = document.createElement("div");
        page.className = "pdf-page";
        clone.appendChild(page);
        pages.push(page);
        return page;
      };

      let page = makePage();

      for (const group of lineGroups) {
        page.appendChild(group);

        const h = page.scrollHeight;
        if (h > maxPageHeightPx && page.childElementCount > 1) {
          page.removeChild(group);
          page = makePage();
          page.appendChild(group);
        }
      }

      // --- 5) Render each page separately ---
      for (let i = 0; i < pages.length; i++) {
        const pageEl = pages[i];

        // breathing room to avoid bottom clipping
        pageEl.style.paddingBottom = "12px";

        const canvas = await html2canvas(pageEl, {
          scale: SCALE,
          useCORS: true,
          backgroundColor: "#ffffff",
          scrollX: 0,
          scrollY: 0,
          windowWidth: Math.ceil(pageWidthPx),
          windowHeight: Math.ceil(pageEl.getBoundingClientRect().height),
        });

        const imgData = canvas.toDataURL("image/png");

        if (i > 0) pdf.addPage();

        const imgWidthMm = printableWidthMm;
        const imgHeightMm = (canvas.height * imgWidthMm) / canvas.width;

        pdf.addImage(
          imgData,
          "PNG",
          marginLeftMm,
          marginTopMm,
          imgWidthMm,
          imgHeightMm,
        );
      }

      pdf.save("word-grid.pdf");
    } finally {
      holder.remove();
    }
  };

  // layout per row:
  // column width = max(minCol, word width, chord/rhythm/note content width)
  // NOTE: for rhythm we also account for the formatted display so it never clips in view mode.
  const getRowLayout = (words, rowIndex) => {
    const minCol = 10;
    const paddingPx = 16; // must match CSS padding L+R in cells/inputs

    const wordFont =
      '600 14px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial';
    const inputFont =
      '400 14px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial';

    const chordPH = showChords ? "Chord" : "";
    const rhythmPH = showRhythm ? "Rhythm" : "";
    const notePH = showNotes ? "Note" : "";

    const widths = words.map((word, colIndex) => {
      const chord = getInputValue(rowIndex, colIndex, "chord");
      const rhythmRaw = getInputValue(rowIndex, colIndex, "rhythm");
      const rhythmPretty = formatRhythm(rhythmRaw);
      const note = getInputValue(rowIndex, colIndex, "note");

      const wWord = measureTextPx(word || "", wordFont) + paddingPx;

      const wChord = showChords
        ? measureTextPx(chord || chordPH, inputFont) + paddingPx
        : 0;

      const wRhythm = showRhythm
        ? Math.max(
            measureTextPx(rhythmRaw || rhythmPH, inputFont) + paddingPx,
            measureTextPx(rhythmPretty || rhythmPH, inputFont) + paddingPx,
          )
        : 0;

      const wNote = showNotes
        ? measureTextPx(note || notePH, inputFont) + paddingPx
        : 0;

      return Math.max(minCol, wWord, wChord, wRhythm, wNote);
    });

    const maxRowPx = Math.max(320, previewWidth - 24);
    const lines = packColumns(widths, maxRowPx);

    return { widths, lines };
  };

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Song Grid</h1>
          <p className="sub">
            Songtekst wordt altijd getoond. <b>Click</b> toggelt <b>RECHTSE</b>{" "}
            border, <b>Shift+Click</b> toggelt <b>LINKSE</b> border.
          </p>
        </div>

        <button
          className="btn"
          onClick={exportPdf}
          disabled={rows.length === 0}
        >
          Print → PDF
        </button>
      </header>

      <section className="panel">
        <label className="label">Tekst (drag & drop toegestaan)</label>
        <textarea
          className={`textarea ${isDragging ? "dragging" : ""}`}
          placeholder={
            "Drop hier tekst of plak/typ...\n\nNieuwe lijn = nieuwe rij in de tabel."
          }
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          onDrop={onDropToTextarea}
          onDragOver={onDragOverTextarea}
          onDragLeave={onDragLeaveTextarea}
        />
        <div className="hint">
          Tip: sleep tekst van eender waar hier binnen. Tekst aanpassen past
          automatisch de grids aan.
        </div>
        <div className="hint">
          Typing rhythms (EXPERIMENTAL) (type number it is replaced when you
          leave the typing field): 1 = 𝅝 = whole note 2 = 𝅗𝅥 = half note 4 = ♩ =
          quarter note 8 = ♪ = eighth note 16 = 𝅘𝅥𝅯 = sixteenth note 32 = 𝅘𝅥𝅰 =
          thirty-second note 1 = 𝄻 = whole rest 2 = 𝄼 = half rest 4 = 𝄽 =
          quarter rest 8 = 𝄾 = eighth rest 16 = 𝄿 = sixteenth rest Type multiple
          notes with spaces between or with | between
        </div>
      </section>

      <section className="panel" ref={previewRef}>
        <div className="panelHeader">
          <h2>Preview</h2>

          <div className="legend">
            <span className="pill">Click = RIGHT border</span>
            <span className="pill">Shift+Click = LEFT border</span>
          </div>

          <div className="toggles">
            <label className="toggle">
              <input
                type="checkbox"
                checked={showChords}
                onChange={(e) => setShowChords(e.target.checked)}
              />
              Chords
            </label>

            <label className="toggle">
              <input
                type="checkbox"
                checked={showRhythm}
                onChange={(e) => setShowRhythm(e.target.checked)}
              />
              Rhythm
            </label>

            <label className="toggle">
              <input
                type="checkbox"
                checked={showNotes}
                onChange={(e) => setShowNotes(e.target.checked)}
              />
              Notes
            </label>
          </div>
        </div>

        <div className="printableWrap" ref={printableRef}>
          {rows.length === 0 ? (
            <div className="empty">
              Nog geen tekst. Drop of typ iets hierboven.
            </div>
          ) : (
            <div className="grid">
              {rows.map((words, rowIndex) => {
                const { widths, lines } = getRowLayout(words, rowIndex);

                return (
                  <div className="rowBlock" key={`row-${rowIndex}`}>
                    {lines.map((colIdxs, lineIndex) => (
                      <div
                        className="lineGroup"
                        key={`line-${rowIndex}-${lineIndex}`}
                      >
                        {/* INPUT LINE: CHORDS */}
                        {showChords && (
                          <div className="rowNoScroll">
                            {colIdxs.map((colIndex) => {
                              const b = getBorderState(rowIndex, colIndex);
                              const cls = [
                                "cell",
                                "inputCell",
                                "inputCellTop",
                                b.left ? "bL" : "",
                                b.right ? "bR" : "",
                              ]
                                .filter(Boolean)
                                .join(" ");

                              const val = getInputValue(
                                rowIndex,
                                colIndex,
                                "chord",
                              );

                              return (
                                <div
                                  key={`c-${rowIndex}-${colIndex}`}
                                  className={cls}
                                  style={{ width: `${widths[colIndex]}px` }}
                                >
                                  <input
                                    data-type="chord"
                                    title="Chord"
                                    className="input"
                                    value={val}
                                    onChange={(e) =>
                                      setInputValue(
                                        rowIndex,
                                        colIndex,
                                        "chord",
                                        e.target.value,
                                      )
                                    }
                                    placeholder="..."
                                  />
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* INPUT LINE: RHYTHM (pretty when not editing) */}
                        {showRhythm && (
                          <div className="rowNoScroll">
                            {colIdxs.map((colIndex) => {
                              const b = getBorderState(rowIndex, colIndex);
                              const cls = [
                                "cell",
                                "inputCell",
                                b.left ? "bL" : "",
                                b.right ? "bR" : "",
                              ]
                                .filter(Boolean)
                                .join(" ");

                              const raw = getInputValue(
                                rowIndex,
                                colIndex,
                                "rhythm",
                              );
                              const editing = isEditing(
                                rowIndex,
                                colIndex,
                                "rhythm",
                              );
                              const displayValue = editing
                                ? raw
                                : formatRhythm(raw);

                              return (
                                <div
                                  key={`r-${rowIndex}-${colIndex}`}
                                  className={cls}
                                  style={{ width: `${widths[colIndex]}px` }}
                                >
                                  <input
                                    data-type="rhythm"
                                    className="input"
                                    value={displayValue}
                                    onFocus={(e) => {
                                      setEditingKey(
                                        makeEditKey(
                                          rowIndex,
                                          colIndex,
                                          "rhythm",
                                        ),
                                      );

                                      requestAnimationFrame(() => {
                                        try {
                                          const el = e.target;
                                          const len = el.value.length;
                                          el.setSelectionRange(len, len);
                                        } catch {
                                          console.log("error");
                                        }
                                      });
                                    }}
                                    onBlur={() => setEditingKey(null)}
                                    onChange={(e) => {
                                      // only store raw while editing
                                      if (
                                        !isEditing(rowIndex, colIndex, "rhythm")
                                      )
                                        return;
                                      setInputValue(
                                        rowIndex,
                                        colIndex,
                                        "rhythm",
                                        e.target.value,
                                      );
                                    }}
                                    title="Rhythm"
                                    placeholder="..."
                                  />
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* INPUT LINE: NOTES */}
                        {showNotes && (
                          <div className="rowNoScroll">
                            {colIdxs.map((colIndex) => {
                              const b = getBorderState(rowIndex, colIndex);
                              const cls = [
                                "cell",
                                "inputCell",
                                b.left ? "bL" : "",
                                b.right ? "bR" : "",
                              ]
                                .filter(Boolean)
                                .join(" ");

                              const val = getInputValue(
                                rowIndex,
                                colIndex,
                                "note",
                              );

                              return (
                                <div
                                  key={`n-${rowIndex}-${colIndex}`}
                                  className={cls}
                                  style={{ width: `${widths[colIndex]}px` }}
                                >
                                  <input
                                    data-type="note"
                                    className="input"
                                    value={val}
                                    onChange={(e) =>
                                      setInputValue(
                                        rowIndex,
                                        colIndex,
                                        "note",
                                        e.target.value,
                                      )
                                    }
                                    title="Notes"
                                    placeholder="..."
                                  />
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* WORD LINE (always shown) */}
                        <div className="rowNoScroll">
                          {colIdxs.map((colIndex) => {
                            const word = words[colIndex];
                            const b = getBorderState(rowIndex, colIndex);
                            const cls = [
                              "cell",
                              "wordCell",
                              b.left ? "bL" : "",
                              b.right ? "bR" : "",
                            ]
                              .filter(Boolean)
                              .join(" ");

                            return (
                              <button
                                type="button"
                                key={`w-${rowIndex}-${colIndex}`}
                                className={cls}
                                style={{ width: `${widths[colIndex]}px` }}
                                onClick={(e) =>
                                  onWordCellClick(e, rowIndex, colIndex)
                                }
                                title="Click = RIGHT, Shift+Click = LEFT"
                              >
                                {word}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
