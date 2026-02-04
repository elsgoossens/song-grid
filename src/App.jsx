// src/App.jsx
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

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
  return Math.ceil(ctx.measureText(text).width);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
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

    // start new line
    lines.push(current);
    current = [i];
    currentW = w;
  }

  if (current.length) lines.push(current);
  return lines;
}

export default function App() {
  const [rawText, setRawText] = useState("");
  const [inputValues, setInputValues] = useState({}); // `${row}:${col}` -> string
  const [borders, setBorders] = useState({}); // `${row}:${col}` -> {left,right}
  const [isDragging, setIsDragging] = useState(false);

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

  const setInputValue = (rowIndex, colIndex, value) => {
    const key = `${rowIndex}:${colIndex}`;
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

  // Fix: op ELKE PDF-pagina een vaste top/bottom margin (witruimte),
  // zodat de content nooit “tegen de rand plakt”.

  const exportPdf = async () => {
    const el = printableRef.current;
    if (!el) return;

    el.classList.add("pdf-export");

    try {
      const SCALE = 2;

      const fullCanvas = await html2canvas(el, {
        scale: SCALE,
        useCORS: true,
        backgroundColor: "#ffffff",
      });

      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidthMm = pdf.internal.pageSize.getWidth();
      const pageHeightMm = pdf.internal.pageSize.getHeight();

      // --- Margins (in mm) ---
      const marginTopMm = 12;
      const marginBottomMm = 12;
      const marginLeftMm = 10;
      const marginRightMm = 10;

      const printableWidthMm = pageWidthMm - marginLeftMm - marginRightMm;
      const printableHeightMm = pageHeightMm - marginTopMm - marginBottomMm;

      const pxPerMm = fullCanvas.width / printableWidthMm; // map canvas width to printable width
      const pageHeightPx = Math.floor(printableHeightMm * pxPerMm);

      // Measure rowBlocks in px (scaled)
      const containerRect = el.getBoundingClientRect();
      const blocks = Array.from(el.querySelectorAll(".rowBlock"));

      const blockRangesPx = blocks
        .map((b) => {
          const r = b.getBoundingClientRect();
          const top = Math.floor((r.top - containerRect.top) * SCALE);
          const bottom = Math.floor((r.bottom - containerRect.top) * SCALE);
          return { top, bottom, h: bottom - top };
        })
        .filter((x) => x.bottom > x.top)
        .sort((a, b) => a.top - b.top);

      // Build pages: if cut would happen, break BEFORE that block
      const pages = [];
      let pageStart = 0;

      while (pageStart < fullCanvas.height) {
        const pageEndIdeal = Math.min(
          pageStart + pageHeightPx,
          fullCanvas.height,
        );
        let breakAt = pageEndIdeal;

        const cutting = blockRangesPx.find(
          (br) => br.top < pageEndIdeal && br.bottom > pageEndIdeal,
        );

        if (cutting) {
          if (cutting.h <= pageHeightPx) {
            breakAt = cutting.top;
            if (breakAt === pageStart) breakAt = pageEndIdeal; // safety
          } else {
            breakAt = pageEndIdeal; // unavoidable
          }
        } else {
          const candidates = blockRangesPx
            .map((br) => br.top)
            .filter((t) => t > pageStart && t < pageEndIdeal);

          if (candidates.length) breakAt = candidates[candidates.length - 1];
        }

        if (breakAt <= pageStart) breakAt = pageEndIdeal;

        pages.push({ y: pageStart, h: Math.max(1, breakAt - pageStart) });
        pageStart = breakAt;
      }

      // Render slices with margins
      pages.forEach((p, idx) => {
        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = fullCanvas.width;
        pageCanvas.height = p.h;

        const ctx = pageCanvas.getContext("2d");
        ctx.drawImage(
          fullCanvas,
          0,
          p.y,
          fullCanvas.width,
          p.h,
          0,
          0,
          fullCanvas.width,
          p.h,
        );

        const imgData = pageCanvas.toDataURL("image/png");

        if (idx > 0) pdf.addPage();

        const imgWidthMm = printableWidthMm;
        const imgHeightMm = (p.h * imgWidthMm) / fullCanvas.width;

        pdf.addImage(
          imgData,
          "PNG",
          marginLeftMm,
          marginTopMm,
          imgWidthMm,
          imgHeightMm,
        );
      });

      pdf.save("word-grid.pdf");
    } finally {
      el.classList.remove("pdf-export");
    }
  };

  // --- Layout computation per row (no horizontal scroll) ---
  // Rule: column width = max(150px, wordWidthPx + padding)
  // Input cells MUST be exactly same width as corresponding word cell.
  const getRowLayout = (words) => {
    const minCol = 150;
    const paddingPx = 16; // approx left+right padding in cells (keep in sync with CSS)
    const font =
      '600 14px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial';

    const widths = words.map((w) =>
      Math.max(minCol, measureTextPx(w, font) + paddingPx),
    );
    const maxRowPx = Math.max(320, previewWidth - 24); // inside padding
    const lines = packColumns(widths, maxRowPx);

    return { widths, lines };
  };

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Song Grid</h1>
          <p className="sub">
            Drop tekst in de textarea → 1 woord per cel. <b>Click</b> toggelt{" "}
            <b>RIGHT</b>, <b>Shift+Click</b> toggelt <b>LEFT</b>.
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
          Tip: sleep tekst van eender waar hier binnen. Tekst hier aanpassen
          past automatisch de grids aan.
        </div>
      </section>

      <section className="panel" ref={previewRef}>
        <div className="panelHeader">
          <h2>Preview</h2>
          <div className="legend">
            <span className="pill">Click = RIGHT border</span>
            <span className="pill">Shift+Click = LEFT border</span>
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
                const { widths, lines } = getRowLayout(words);

                return (
                  <div className="rowBlock" key={`row-${rowIndex}`}>
                    {lines.map((colIdxs, lineIndex) => (
                      <React.Fragment key={`line-${rowIndex}-${lineIndex}`}>
                        {/* WORD LINE */}
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

                        {/* INPUT LINE (same widths as above) */}
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

                            const key = `${rowIndex}:${colIndex}`;
                            const val = inputValues[key] || "";

                            return (
                              <div
                                key={`i-${rowIndex}-${colIndex}`}
                                className={cls}
                                style={{ width: `${widths[colIndex]}px` }}
                              >
                                <input
                                  className="input"
                                  value={val}
                                  onChange={(e) =>
                                    setInputValue(
                                      rowIndex,
                                      colIndex,
                                      e.target.value,
                                    )
                                  }
                                  placeholder="..."
                                />
                              </div>
                            );
                          })}
                        </div>
                      </React.Fragment>
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
