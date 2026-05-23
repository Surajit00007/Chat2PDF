
import React, { useState } from "react";
import { 
  FileText, 
  Download, 
  Link, 
  Clipboard, 
  Sparkles, 
  Check, 
  X, 
  Edit2, 
  Trash2, 
  RefreshCw, 
  AlertCircle,
  FileCheck2,
  Bookmark,
  Eye,
  Settings,
  HelpCircle,
  Share2,
  Mail,
  Copy,
  ExternalLink,
  Sun,
  Moon,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { jsPDF } from "jspdf";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx";

// --- TYPES ---
interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  avatar?: string;
  enabled: boolean;
}

interface ParsedChat {
  title: string;
  platform: string;
  messages: ChatMessage[];
}

// --- MAIN COMPONENT ---
export default function App() {
  // Input UI States
  const [activeTab, setActiveTab] = useState<"link" | "paste">("link");
  const [shareLink, setShareLink] = useState("");
  const [copiedText, setCopiedText] = useState("");
  const [platformOverride, setPlatformOverride] = useState("");
  
  // API Core States
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [errorStatus, setErrorStatus] = useState<string | null>(null);
  
  // Parsed Conversation States
  const [parsedData, setParsedData] = useState<ParsedChat | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPlatform, setEditPlatform] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageText, setEditingMessageText] = useState("");

  // Share Modal States
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareFormat, setShareFormat] = useState<"pdf" | "docx">("pdf");
  const [copiedShareDetails, setCopiedShareDetails] = useState(false);
  const [nativeShareStatus, setNativeShareStatus] = useState<"idle" | "sharing" | "success" | "error">("idle");
  const [nativeShareError, setNativeShareError] = useState("");

  // Theme States
  const [themeMode, setThemeMode] = useState<"light" | "dark">("light");

  // --- PARSE TRIGGERS ---
  const handleParse = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorStatus(null);
    setLoadingStep("Connecting to conversion server...");

    try {
      // Validate inputs
      if (activeTab === "link" && !shareLink.trim()) {
        throw new Error("Please enter a valid chat share URL (ChatGPT, Claude, Gemini, DeepSeek, etc).");
      }
      if (activeTab === "paste" && !copiedText.trim()) {
        throw new Error("Please paste copied text transcript from your conversation tab.");
      }

      setLoadingStep("Sending payload to Gemini parser...");
      
      const payload = activeTab === "link" 
        ? { url: shareLink } 
        : { rawText: copiedText };

      const res = await fetch("/api/parse-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorJson = await res.json().catch(() => ({}));
        throw new Error(errorJson.error || `Server responded with error status ${res.status}`);
      }

      const responseData = await res.json();
      
      if (!responseData.success) {
        if (responseData.blockedByCloudflare) {
          // Special friendly failure warning for Cloudflare intercept
          throw new Error(responseData.error);
        }
        throw new Error(responseData.error || "Gemini was unable to recognize chat structures in this input.");
      }

      setLoadingStep("Polishing layout transcripts...");

      // Transform messages into local interactive layout states (giving unique sequential IDs and enabling them)
      const mappedMessages: ChatMessage[] = (responseData.data.messages || []).map((msg: any, i: number) => ({
        id: `msg-${i}-${Date.now()}`,
        role: msg.role === "assistant" ? "assistant" : "user",
        content: msg.content || "",
        avatar: msg.avatar || (msg.role === "assistant" ? "AI" : "U"),
        enabled: true,
      })).filter((msg: ChatMessage) => msg.content.trim().length > 0);

      if (mappedMessages.length === 0) {
        throw new Error("Only a title/headline was detected. No full chat message blocks were found to export. Paste the visible conversation text into the Copy-Paste tab and try again.");
      }

      // Fallback platform if empty
      const detectedPlatform = responseData.data.platform || platformOverride || "AI Assistant";

      setParsedData({
        title: responseData.data.title || "Shared Chat Transcript",
        platform: detectedPlatform,
        messages: mappedMessages,
      });

      setEditTitle(responseData.data.title || "Shared Chat Transcript");
      setEditPlatform(detectedPlatform);

    } catch (err: any) {
      console.error("Conversion issue:", err);
      setErrorStatus(err.message || "An unexpected error occurred during import. Please try manual copy-pasting.");
    } finally {
      setLoading(false);
      setLoadingStep("");
    }
  };

  // --- ACTIONS & UTILS ---
  const resetHandler = () => {
    setParsedData(null);
    setShareLink("");
    setCopiedText("");
    setErrorStatus(null);
  };

  const toggleMessage = (id: string) => {
    if (!parsedData) return;
    setParsedData({
      ...parsedData,
      messages: parsedData.messages.map((m) => 
        m.id === id ? { ...m, enabled: !m.enabled } : m
      ),
    });
  };

  const deleteMessage = (id: string) => {
    if (!parsedData) return;
    setParsedData({
      ...parsedData,
      messages: parsedData.messages.filter((m) => m.id !== id),
    });
  };

  const startEditingMessage = (id: string, text: string) => {
    setEditingMessageId(id);
    setEditingMessageText(text);
  };

  const saveEditingMessage = () => {
    if (!parsedData || !editingMessageId) return;
    setParsedData({
      ...parsedData,
      messages: parsedData.messages.map((m) => 
        m.id === editingMessageId ? { ...m, content: editingMessageText } : m
      ),
    });
    setEditingMessageId(null);
    setEditingMessageText("");
  };

  // --- STATS CALCULATIONS ---
  const getSelectedWordCount = () => {
    if (!parsedData) return 0;
    return parsedData.messages
      .filter((m) => m.enabled)
      .reduce((sum, m) => sum + m.content.split(/\s+/).filter(Boolean).length, 0);
  };

  const getSelectedMessageCount = () => {
    if (!parsedData) return 0;
    return parsedData.messages.filter((m) => m.enabled).length;
  };

  // --- EXPORT ENGINES ---
  const buildPDFInstance = (): { doc: any; filename: string } | null => {
    if (!parsedData) return null;
    
    const rawTitle = editTitle.trim() || parsedData.title;
    const rawPlatform = (editPlatform.trim() || parsedData.platform || "Platform").toUpperCase();
    const activeMessages = parsedData.messages.filter((m) => m.enabled);

    if (activeMessages.length === 0) {
      return null;
    }

    // Helper to sanitize text for standard PDF fonts (iso-8859-1)
    const sanitizeForPDF = (textStr: string): string => {
      if (!textStr) return "";
      return String(textStr)
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2013\u2014]/g, "-")
        .replace(/…/g, "...")
        .replace(/[•\u2022]/g, "*")
        .replace(/[^\x00-\xFF]/g, " "); // Replace standard multi-byte/unicode chars with space so jsPDF doesn't fail to measure/render them
    };

    const title = sanitizeForPDF(rawTitle);
    const platform = sanitizeForPDF(rawPlatform);

    // Initialize A4 canvas
    const doc = new jsPDF({
      orientation: "p",
      unit: "mm",
      format: "a4"
    });

    const pageWidth = 210;
    const pageHeight = 297;
    const marginX = 20;
    const marginYTop = 25;
    const marginYBottom = 25;
    const contentWidth = pageWidth - (marginX * 2); // 170mm
    const maxY = pageHeight - marginYBottom;

    let currentY = marginYTop;

    // Helper text renderer with page overflow wrap detection
    function addTextLine(
      text: string,
      size = 10,
      style = "normal",
      font = "helvetica",
      indent = 0,
      color = [50, 50, 50],
      align: "left" | "right" = "left",
      blockWidth = contentWidth
    ) {
      const sanitizedText = sanitizeForPDF(text);

      // Robust standard font setter using strictly lowercase names
      try {
        const family = font.toLowerCase() === "courier" ? "courier" : "helvetica";
        let fontStyle = "normal";
        if (style === "bold") fontStyle = "bold";
        else if (style === "italic") fontStyle = "italic";
        else if (style === "bolditalic") fontStyle = "bolditalic";

        doc.setFont(family, fontStyle);
      } catch (e) {
        try {
          doc.setFont("helvetica", "normal");
        } catch (e2) {}
      }

      try {
        doc.setFontSize(size);
        doc.setTextColor(color[0], color[1], color[2]);
      } catch (e) {}

      const availableWidth = Math.max(20, blockWidth - indent);

      let lines: string[] = [];
      try {
        lines = doc.splitTextToSize(sanitizedText, availableWidth);
      } catch (splitErr) {
        console.error("splitTextToSize failed, using raw lines wrapping fallback", splitErr);
        const words = sanitizedText.split(/\s+/);
        let currLine = "";
        words.forEach(w => {
          if ((currLine + " " + w).length > 60) {
            lines.push(currLine);
            currLine = w;
          } else {
            currLine = currLine ? currLine + " " + w : w;
          }
        });
        if (currLine) {
          lines.push(currLine);
        }
      }

      const lineHeight = size * 0.45;
      const textX = align === "right" ? pageWidth - marginX : marginX + indent;

      lines.forEach((line: string) => {
        if (currentY + lineHeight > maxY) {
          try {
            doc.addPage();
          } catch (pageErr) {
            console.error("addPage failed", pageErr);
          }
          currentY = marginYTop;
        }
        try {
          doc.text(line, textX, currentY, { align });
        } catch (e) {
          console.error("text rendering failed for line:", line, e);
        }
        currentY += lineHeight;
      });
      currentY += 1.5;
    }

    // Cover Meta / Platform Name
    try {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(110, 110, 110);
      doc.text(`AI CONVERSATION EXPORT • PLATFORM: ${platform}`, marginX, currentY);
    } catch (e) {
      console.error("Meta section rendering issue:", e);
    }
    currentY += 8;

    // Document Main Title
    try {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.setTextColor(24, 24, 27); // zinc-900 gray
      let splitTitle: string[] = [];
      try {
        splitTitle = doc.splitTextToSize(title, contentWidth);
      } catch (err) {
        splitTitle = [title];
      }
      splitTitle.forEach((line: string) => {
        if (currentY + 10 > maxY) {
          doc.addPage();
          currentY = marginYTop;
        }
        doc.text(line, marginX, currentY);
        currentY += 9;
      });
    } catch (e) {
      console.error("Title section rendering issue:", e);
    }
    
    currentY += 5;

    // Divider bar
    if (currentY + 3 > maxY) {
      try {
        doc.addPage();
      } catch (pageErr) {}
      currentY = marginYTop;
    }
    try {
      doc.setDrawColor(228, 228, 231); // zinc-200 boundary
      doc.setLineWidth(0.4);
      doc.line(marginX, currentY, pageWidth - marginX, currentY);
    } catch (e) {
      console.error("Divider line rendering issue:", e);
    }
    currentY += 10;

    // Render message blocks sequentially
    activeMessages.forEach((msg) => {
      try {
        currentY += 3;

        if (currentY + 14 > maxY) {
          try {
            doc.addPage();
          } catch (err) {}
          currentY = marginYTop;
        }

        const isUser = msg.role === "user";
        const align = isUser ? "right" : "left";
        const labelX = isUser ? pageWidth - marginX : marginX;
        const blockWidth = isUser ? contentWidth * 0.78 : contentWidth;
        const textIndent = isUser ? 0 : 0;

        try {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(10);
          if (isUser) {
            doc.setTextColor(71, 85, 105);
            doc.text("USER PROMPT:", labelX, currentY, { align });
          } else {
            doc.setTextColor(22, 163, 74);
            doc.text(`${platform} RESPONSE:`, labelX, currentY, { align });
          }
        } catch (e) {
          console.error("Error drawing message header text", e);
        }
        currentY += 6;

        const paragraphs = String(msg.content || "").split(/\r?\n/);
        let inCodeBlock = false;

        paragraphs.forEach((pText: string) => {
          try {
            const trimmed = pText.trim();

            if (trimmed.startsWith("```")) {
              inCodeBlock = !inCodeBlock;
              currentY += 1.5;
              return;
            }

            if (inCodeBlock) {
              addTextLine(pText, 8.5, "normal", "courier", 5, [82, 82, 91], align, blockWidth);
            } else {
              if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
                const listContent = trimmed.substring(2);
                addTextLine("* " + listContent, 10, "normal", "helvetica", 4, [39, 39, 42], align, blockWidth);
              } else if (/^\d+\.\s/.test(trimmed)) {
                addTextLine(trimmed, 10, "normal", "helvetica", 4, [39, 39, 42], align, blockWidth);
              } else if (trimmed.startsWith("### ")) {
                currentY += 1;
                addTextLine(trimmed.substring(4), 11, "bold", "helvetica", 0, [24, 24, 27], align, blockWidth);
                currentY += 1;
              } else if (trimmed.startsWith("## ")) {
                currentY += 2;
                addTextLine(trimmed.substring(3), 13, "bold", "helvetica", 0, [24, 24, 27], align, blockWidth);
                currentY += 2;
              } else if (trimmed.startsWith("# ")) {
                currentY += 2.5;
                addTextLine(trimmed.substring(2), 15, "bold", "helvetica", 0, [24, 24, 27], align, blockWidth);
                currentY += 2;
              } else if (pText.length > 0) {
                addTextLine(pText, 10, "normal", "helvetica", textIndent, [39, 39, 42], align, blockWidth);
              }
            }
          } catch (paraErr) {
            console.error("Error drawing paragraph line", pText, paraErr);
          }
        });

        currentY += 5;
      } catch (msgErr) {
        console.error("Error processing message block", msg, msgErr);
      }
    });

    // Write footer counters
    try {
      const totalPages = doc.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        try {
          doc.setPage(i);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7.5);
          doc.setTextColor(161, 161, 170); // zinc-400
          doc.text(`Page ${i} of ${totalPages}`, pageWidth / 2, pageHeight - 12, { align: "center" });
          doc.text(`Exported via Chat Document Converter`, marginX, pageHeight - 12);
        } catch (pageErr) {
          console.error("Error drawing page footer for page", i, pageErr);
        }
      }
    } catch (e) {
      console.error("Footer rendering issue:", e);
    }

    const cleanName = title.replace(/[^a-z0-9]/gi, "_").toLowerCase().substring(0, 30);
    const filename = `${cleanName || "ai_chat"}_transcript.pdf`;
    return { doc, filename };
  };

  const downloadPDF = () => {
    try {
      const res = buildPDFInstance();
      if (!res) {
        alert("No messages are selected. Please select at least one message block to include in your document!");
        return;
      }

      const blob = res.doc.output("blob");
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      console.error("PDF generation or saving failed:", e);
      alert("Failed to export PDF: " + (e.message || String(e)));
    }
  };

  const generateDOCXBlobOnly = async (): Promise<{ blob: Blob; filename: string } | null> => {
    if (!parsedData) return null;

    const title = editTitle.trim() || parsedData.title;
    const platform = (editPlatform.trim() || parsedData.platform || "Platform").toUpperCase();
    const activeMessages = parsedData.messages.filter((m) => m.enabled);

    if (activeMessages.length === 0) {
      return null;
    }

    const docChildren: any[] = [
      new Paragraph({
        text: `${platform} CONVERSATION IMPORT`,
        alignment: AlignmentType.LEFT,
        heading: HeadingLevel.HEADING_6,
        spacing: { after: 120 }
      }),
      new Paragraph({
        text: title,
        alignment: AlignmentType.LEFT,
        heading: HeadingLevel.TITLE,
        spacing: { after: 360 }
      }),
      new Paragraph({
        text: `Exported on: ${new Date().toLocaleDateString()} | Total Messages Included: ${activeMessages.length}`,
        alignment: AlignmentType.LEFT,
        spacing: { after: 240 }
      })
    ];

    activeMessages.forEach((msg) => {
      const isUser = msg.role === "user";

      docChildren.push(
        new Paragraph({
          text: isUser ? "USER QUESTION" : `${platform} RESPONSE`,
          heading: HeadingLevel.HEADING_2,
          alignment: isUser ? AlignmentType.RIGHT : AlignmentType.LEFT,
          spacing: { before: 240, after: 100 }
        })
      );

      const paragraphs = String(msg.content || "").split(/\r?\n/);
      let inCodeBlock = false;

      paragraphs.forEach((pText: string) => {
        const trimmed = pText.trim();

        if (trimmed.startsWith("```")) {
          inCodeBlock = !inCodeBlock;
          return;
        }

        if (inCodeBlock) {
          docChildren.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: pText,
                  font: "Courier New",
                  size: 19,
                  color: "444444"
                })
              ],
              alignment: isUser ? AlignmentType.RIGHT : AlignmentType.LEFT,
              indent: { left: 360 },
              spacing: { after: 60 }
            })
          );
        } else {
          if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
            docChildren.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: "• " + trimmed.substring(2),
                    font: "Calibri",
                    size: 22,
                  })
                ],
                alignment: isUser ? AlignmentType.RIGHT : AlignmentType.LEFT,
                indent: { left: 240 },
                spacing: { after: 80 }
              })
            );
          } else if (trimmed.startsWith("### ")) {
            docChildren.push(
              new Paragraph({
                text: trimmed.substring(4),
                heading: HeadingLevel.HEADING_4,
                alignment: isUser ? AlignmentType.RIGHT : AlignmentType.LEFT,
                spacing: { before: 100, after: 60 }
              })
            );
          } else if (trimmed.startsWith("## ")) {
            docChildren.push(
              new Paragraph({
                text: trimmed.substring(3),
                heading: HeadingLevel.HEADING_3,
                alignment: isUser ? AlignmentType.RIGHT : AlignmentType.LEFT,
                spacing: { before: 140, after: 100 }
              })
            );
          } else if (trimmed.startsWith("# ")) {
            docChildren.push(
              new Paragraph({
                text: trimmed.substring(2),
                heading: HeadingLevel.HEADING_2,
                alignment: isUser ? AlignmentType.RIGHT : AlignmentType.LEFT,
                spacing: { before: 180, after: 120 }
              })
            );
          } else if (pText.length > 0) {
            docChildren.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: pText,
                    font: "Calibri",
                    size: 22,
                    color: "1A1A1A"
                  })
                ],
                alignment: isUser ? AlignmentType.RIGHT : AlignmentType.LEFT,
                spacing: { after: 100 }
              })
            );
          }
        }
      });
    });

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: docChildren,
        }
      ]
    });

    const blob = await Packer.toBlob(doc);
    const cleanName = title.replace(/[^a-z0-9]/gi, "_").toLowerCase().substring(0, 30);
    const filename = `${cleanName || "ai_chat"}_transcript.docx`;
    return { blob, filename };
  };

  const downloadDOCX = async () => {
    const res = await generateDOCXBlobOnly();
    if (!res) {
      alert("No messages are selected. Please select at least one message block to include in your document!");
      return;
    }
    const url = window.URL.createObjectURL(res.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const handleNativeShare = async () => {
    if (!parsedData) return;
    setNativeShareStatus("sharing");
    setNativeShareError("");

    try {
      const title = editTitle.trim() || parsedData.title;
      const cleanName = title.replace(/[^a-z0-9]/gi, "_").toLowerCase().substring(0, 30);

      let fileBlob: Blob;
      let extension: string;
      let contentType: string;

      if (shareFormat === "pdf") {
        const res = buildPDFInstance();
        if (!res) {
          setNativeShareStatus("error");
          setNativeShareError("Could not build PDF. Choose at least one message.");
          return;
        }
        fileBlob = res.doc.output("blob");
        extension = "pdf";
        contentType = "application/pdf";
      } else {
        const res = await generateDOCXBlobOnly();
        if (!res) {
          setNativeShareStatus("error");
          setNativeShareError("Could not build Word file. Choose at least one message.");
          return;
        }
        fileBlob = res.blob;
        extension = "docx";
        contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      }

      const filename = `${cleanName || "ai_chat"}_transcript.${extension}`;
      const fileObj = new File([fileBlob], filename, { type: contentType });

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [fileObj] })) {
        await navigator.share({
          files: [fileObj],
          title: title,
          text: `Check out this AI conversation transcript of "${title}" exported with Chat2PDF.`,
        });
        setNativeShareStatus("success");
      } else if (navigator.share) {
        // Can share text but not direct binary files
        await navigator.share({
          title: title,
          text: `I exported the AI conversation of "${title}" from ${editPlatform || "AI"}. Check it out!`,
          url: window.location.href,
        });
        setNativeShareStatus("success");
      } else {
        throw new Error("System sharing is not natively supported on this browser.");
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error("Local app share failure", err);
        setNativeShareStatus("error");
        setNativeShareError(err.message || "Failed to trigger system wide share menu.");
      } else {
        setNativeShareStatus("idle");
      }
    }
  };

  // --- SUB COMPONENT: CUSTOM INLINE MARKDOWN PARSER ---
  function CustomChatRenderer({ content }: { content: string }) {
    const lines = content.split("\n");
    let inCodeBlock = false;
    let codeLines: string[] = [];
    let codeLang = "code";
    const elements: React.ReactNode[] = [];

    lines.forEach((line, index) => {
      const trimmed = line.trim();

      // Code Block Toggles
      if (trimmed.startsWith("```")) {
        if (inCodeBlock) {
          inCodeBlock = false;
          elements.push(
            <div key={`code-block-${index}`} className="my-3.5 bg-zinc-950 rounded-lg border border-zinc-800 text-zinc-100 font-mono text-xs overflow-hidden shadow-inner">
              <div className="flex bg-zinc-900 px-4 py-2 border-b border-zinc-800 justify-between items-center text-zinc-500 font-sans text-[11px] select-none">
                <span className="font-medium tracking-wide uppercase">{codeLang || "syntax"}</span>
                <span>Plaintext</span>
              </div>
              <pre className="p-4 overflow-x-auto whitespace-pre leading-relaxed font-mono">
                <code>{codeLines.join("\n")}</code>
              </pre>
            </div>
          );
          codeLines = [];
          codeLang = "code";
        } else {
          inCodeBlock = true;
          codeLang = trimmed.substring(3).trim();
        }
        return;
      }

      if (inCodeBlock) {
        codeLines.push(line);
        return;
      }

      // Markdown Headers
      if (trimmed.startsWith("# ")) {
        elements.push(<h1 key={index} className="text-xl font-bold text-zinc-900 mt-5 mb-2 hover:opacity-90 transition-opacity">{trimmed.substring(2)}</h1>);
      } else if (trimmed.startsWith("## ")) {
        elements.push(<h2 key={index} className="text-lg font-bold text-zinc-850 mt-4 mb-2">{trimmed.substring(3)}</h2>);
      } else if (trimmed.startsWith("### ")) {
        elements.push(<h3 key={index} className="text-sm font-semibold text-zinc-805 mt-3 mb-1.5">{trimmed.substring(4)}</h3>);
      }
      // HTML Bullet / Numbered lists
      else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        elements.push(
          <ul key={index} className="list-disc pl-5 my-1 text-zinc-700 leading-relaxed text-sm">
            <li className="pl-1 py-0.5">{parseInlineTags(trimmed.substring(2))}</li>
          </ul>
        );
      } else if (/^\d+\.\s/.test(trimmed)) {
        const itemMatch = trimmed.match(/^(\d+)\.\s(.*)/);
        const listNum = itemMatch ? itemMatch[1] : "1";
        const listText = itemMatch ? itemMatch[2] : trimmed;
        elements.push(
          <ol key={index} className="list-decimal pl-5 my-1 text-zinc-700 leading-relaxed text-sm">
            <li value={parseInt(listNum)} className="pl-1 py-0.5">{parseInlineTags(listText)}</li>
          </ol>
        );
      }
      // Line Break Breakdowns
      else if (trimmed === "") {
        elements.push(<div key={index} className="h-2.5" />);
      }
      // Normal Sentence Paragraph
      else {
        elements.push(<p key={index} className="text-sm text-zinc-700 leading-relaxed my-1.5">{parseInlineTags(line)}</p>);
      }
    });

    return <div className="space-y-0.5">{elements}</div>;
  }

  // Parses inline tags like **bold** text and `code snippets`
  function parseInlineTags(rawText: string): React.ReactNode {
    const segments: React.ReactNode[] = [];
    let head = 0;
    
    // Regexp finding markdown patterns
    const boldCodeRegex = /(\*\*.*?\*\*|`.*?`)/g;
    const matches = [...rawText.matchAll(boldCodeRegex)];
    
    if (matches.length === 0) {
      return rawText;
    }

    matches.forEach((m, idx) => {
      const block = m[0];
      const start = m.index || 0;

      // Add leading spacer text
      if (start > head) {
        segments.push(rawText.substring(head, start));
      }

      if (block.startsWith("**") && block.endsWith("**")) {
        segments.push(
          <strong key={`bold-${idx}`} className="font-bold text-zinc-900">
            {block.slice(2, -2)}
          </strong>
        );
      } else if (block.startsWith("`") && block.endsWith("`")) {
        segments.push(
          <code key={`code-${idx}`} className="px-1.5 py-0.5 bg-zinc-100 border border-zinc-200 text-xs text-rose-600 font-mono rounded">
            {block.slice(1, -1)}
          </code>
        );
      }

      head = start + block.length;
    });

    if (head < rawText.length) {
      segments.push(rawText.substring(head));
    }

    return segments;
  }

  const isDark = themeMode === "dark";

  return (
    <div className={`min-h-screen font-sans antialiased flex flex-col selection:bg-zinc-200 selection:text-black ${isDark ? "bg-gradient-to-br from-[#090d16] via-[#0f1728] to-[#0f2a23] text-zinc-100" : "bg-gradient-to-br from-[#f8fbfa] via-white to-[#e3f6ee] text-[#1A1A1A]"}`}>
      
      {/* --- APP HEADER --- */}
      <header className={`sticky top-0 z-50 px-6 py-5 border-b backdrop-blur ${isDark ? "border-white/10 bg-[#0f1728]/80" : "border-gray-100 bg-white/90"}`}>
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3" id="app-logo-block">
            <img
              src="/Chat2PDF.png"
              alt="Chat2PDF logo"
              className="w-10 h-10 rounded-xl object-cover ring-1 ring-black/5"
              draggable={false}
            />
            <div>
              <h1 className={`text-base font-bold tracking-tight ${isDark ? "text-white" : "text-[#111111]"}`}>
                Chat2PDF
              </h1>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <button
              type="button"
              onClick={() => setThemeMode((current) => (current === "light" ? "dark" : "light"))}
              aria-label={`Switch to ${themeMode === "light" ? "dark" : "light"} mode`}
              className={`inline-flex items-center justify-center rounded-full border p-2 transition-all ${isDark ? "border-white/10 bg-white/5 text-zinc-100 hover:bg-white/10" : "border-zinc-200 bg-zinc-50 text-zinc-700 hover:border-zinc-300 hover:bg-zinc-100"}`}
            >
              {themeMode === "light" ? (
                <Sun className="w-4 h-4" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* --- MAIN PAGE CONTENT --- */}
      <main className="flex-grow py-12 px-4 sm:px-6 max-w-5xl w-full mx-auto flex flex-col">
        
        <AnimatePresence mode="wait">
          {!parsedData ? (
            /* ========================================================
               1. INITIAL CONFIGURATION & INPUT PANEL
               ======================================================== */
            <motion.div 
              key="setup-panel"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.25 }}
              className="max-w-2xl mx-auto w-full flex flex-col space-y-8"
            >
              
              {/* Visual App Promo Header */}
              <div className="text-center space-y-3 py-4">
                <span className={`text-[11px] font-bold uppercase tracking-widest px-3.5 py-1.5 rounded-full inline-block ${isDark ? "text-white bg-white/10" : "text-[#111111] bg-black/5"}`}>
                  Chat2PDF
                </span>
                <h2 className={`text-4xl sm:text-5xl font-extrabold tracking-tighter leading-none mb-1 ${isDark ? "text-white" : "text-[#111111]"}`}>
                  Turn AI chats into polished PDF documents.
                </h2>
                <p className={`text-lg sm:text-xl font-medium max-w-lg mx-auto ${isDark ? "text-zinc-300" : "text-gray-500"}`}>
                  Simple, secure document generation from any AI conversation link or pasted transcript.
                </p>
              </div>

              {/* Central Box Layout */}
              <div className={`rounded-3xl overflow-hidden p-2 sm:p-4 shadow-sm ${isDark ? "bg-gradient-to-br from-[#0f1728] via-[#111b2a] to-[#10281e] border border-white/10 shadow-black/30" : "bg-gradient-to-br from-[#ffffff] via-[#f8fffc] to-[#eaf8f1] border border-gray-200 shadow-gray-200/50"}`}>
                
                {/* Method Toggles */}
                <div className={`flex rounded-2xl p-1 mx-4 mt-4 ${isDark ? "bg-white/5 border border-white/10" : "bg-gray-50 border border-gray-200/40"}`}>
                  <button
                    type="button"
                    onClick={() => { setActiveTab("link"); setErrorStatus(null); }}
                    className={`flex-1 flex items-center justify-center space-x-2 py-3 text-[13px] font-bold rounded-xl transition-all duration-200 ${
                      activeTab === "link"
                        ? isDark
                          ? "bg-gradient-to-r from-[#46A589]/30 to-[#0F1325]/40 text-white shadow-sm border border-[#46A589]/30"
                          : "bg-white text-black shadow-sm border border-gray-100"
                        : isDark
                          ? "text-zinc-300 hover:text-white hover:bg-white/5"
                          : "text-gray-500 hover:text-black hover:bg-gray-50/50"
                    }`}
                  >
                    <Link className="w-3.5 h-3.5" />
                    <span>AI Share Link</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => { setActiveTab("paste"); setErrorStatus(null); }}
                    className={`flex-1 flex items-center justify-center space-x-2 py-3 text-[13px] font-bold rounded-xl transition-all duration-200 ${
                      activeTab === "paste"
                        ? isDark
                          ? "bg-gradient-to-r from-[#46A589]/30 to-[#0F1325]/40 text-white shadow-sm border border-[#46A589]/30"
                          : "bg-white text-black shadow-sm border border-gray-100"
                        : isDark
                          ? "text-zinc-300 hover:text-white hover:bg-white/5"
                          : "text-gray-500 hover:text-black hover:bg-gray-50/50"
                    }`}
                  >
                    <Clipboard className="w-3.5 h-3.5" />
                    <span>Paste Transcript</span>
                  </button>
                </div>

                {/* Form Input Container */}
                <form onSubmit={handleParse} className="p-6 space-y-6">
                  
                  {activeTab === "link" ? (
                    /* Link Input */
                    <div className="space-y-2">
                      <label htmlFor="url" className="block text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                        Chat Share URL
                      </label>
                      <div className="relative rounded-xl">
                        <div className="absolute inset-y-0 left-0 pl-4.5 flex items-center pointer-events-none text-gray-400">
                          <Link className="h-4 w-4" />
                        </div>
                        <input
                          type="text"
                          name="url"
                          id="url"
                          value={shareLink}
                          onChange={(e) => setShareLink(e.target.value)}
                          placeholder="https://chatgpt.com/share/unique-link-id"
                          className="w-full pl-12 pr-4 py-4.5 bg-gray-50 border border-gray-200 rounded-xl text-[14px] text-zinc-800 placeholder-gray-400 outline-none focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-black transition-all"
                        />
                      </div>
                      <span className="text-[11px] text-gray-400 font-medium block">
                        Direct conversion compatible with ChatGPT, Claude, and Gemini shared link systems.
                      </span>
                    </div>
                  ) : (
                    /* Manual Paste Input */
                    <div className="space-y-2">
                      <div className="flex justify-between items-center mb-1">
                        <label htmlFor="pasted" className="block text-[11px] font-bold uppercase tracking-widest text-gray-400">
                          Pasted Chat Transcript
                        </label>
                        <span className="text-[10px] text-gray-400 font-bold uppercase bg-gray-100 px-2 py-0.5 rounded">Manual Input</span>
                      </div>
                      <textarea
                        id="pasted"
                        value={copiedText}
                        onChange={(e) => setCopiedText(e.target.value)}
                        placeholder={`Paste any text transcript here directly. E.g.:

User: Hello! Please write a python quicksort.
AI: Sure! Here is the code...
\`\`\`python
def quicksort(arr): ...
\`\`\``}
                        className="w-full min-h-[160px] p-4 text-[13px] bg-gray-50 border border-gray-200 rounded-xl text-zinc-800 placeholder-gray-400 font-mono overflow-y-auto leading-relaxed focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-black outline-none transition-all"
                      />
                      <span className="text-[11px] text-gray-400 font-medium block">
                        Tip: Open your shared chat link, press <strong className="text-gray-600">Ctrl+A</strong> to select all, copy it (<strong className="text-gray-600">Ctrl+C</strong>), and paste it directly!
                      </span>
                    </div>
                  )}

                  {/* Manual Platform Override Drops */}
                  <div className="space-y-2">
                    <label htmlFor="platform-select" className="block text-[11px] font-bold uppercase tracking-widest text-gray-400">
                      Platform Source (Optional override)
                    </label>
                    <select
                      id="platform-select"
                      value={platformOverride}
                      onChange={(e) => setPlatformOverride(e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 py-3.5 px-4 rounded-xl text-xs font-semibold text-zinc-700 outline-none focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-black transition-all appearance-none cursor-pointer"
                    >
                      <option value="">Auto-Detect Platform</option>
                      <option value="ChatGPT">ChatGPT</option>
                      <option value="Claude">Claude (Anthropic)</option>
                      <option value="Gemini">Gemini (Google)</option>
                      <option value="DeepSeek">DeepSeek</option>
                    </select>
                  </div>

                  {/* Warning Messages */}
                  {errorStatus && (
                    <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl flex items-start space-x-2.5">
                      <AlertCircle className="w-4 h-4 text-rose-600 mt-0.5 flex-shrink-0" />
                      <div className="text-xs text-rose-800 font-medium whitespace-pre-wrap leading-relaxed">
                        {errorStatus}
                      </div>
                    </div>
                  )}

                  {/* CTA Launcher */}
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-black text-white py-5 rounded-2xl text-[15px] font-bold select-none cursor-pointer hover:opacity-90 active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none transition-all flex items-center justify-center space-x-2.5 shadow-sm shadow-black/10"
                  >
                    {loading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span className="tracking-wide">{loadingStep || "Parsing Transcript..."}</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 text-gray-200" />
                        <span className="tracking-wide">Process Link & Customize Layout</span>
                      </>
                    )}
                  </button>

                </form>

              </div>

              {/* Brand Minimalist Statistics Row */}
              <div className="flex items-center gap-6 sm:gap-12 justify-center py-6">
                <div className="text-center">
                  <div className="text-xl sm:text-2xl font-bold">15k+</div>
                  <div className="text-[11px] font-bold uppercase text-gray-400 tracking-wider">Files Exported</div>
                </div>
                <div className="h-8 w-px bg-gray-200"></div>
                <div className="text-center">
                  <div className="text-xl sm:text-2xl font-bold">0%</div>
                  <div className="text-[11px] font-bold uppercase text-gray-400 tracking-wider">Data Stored</div>
                </div>
                <div className="h-8 w-px bg-gray-200"></div>
                <div className="text-center">
                  <div className="text-xl sm:text-2xl font-bold">Instant</div>
                  <div className="text-[11px] font-bold uppercase text-gray-400 tracking-wider">Processing</div>
                </div>
              </div>
              
            </motion.div>
          ) : (
            /* ========================================================
               2. WORKSPACE REVIEW PANEL (PARSED OK)
               ======================================================== */
            <motion.div 
              key="workspace-panel"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.25 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start w-full"
            >
              
              {/* --- LEFT COL: INSPECTOR & GLOBAL SETTINGS (lg:col-span-4) --- */}
              <div className="lg:col-span-4 space-y-6 lg:sticky lg:top-24">
                
                {/* Back / Reset CTA */}
                <button
                  type="button"
                  onClick={resetHandler}
                  className="inline-flex items-center space-x-2 text-[11px] font-bold text-gray-400 hover:text-black transition-colors uppercase tracking-widest select-none cursor-pointer"
                >
                  <X className="w-4 h-4" />
                  <span>Convert New Document</span>
                </button>

                {/* Dashboard Meta Settings Wrapper */}
                <div className="bg-white border border-gray-200 rounded-3xl shadow-sm shadow-gray-200/50 p-6 space-y-6">
                  
                  <div>
                    <h3 className="text-base font-bold text-black tracking-tight">Document Settings</h3>
                    <p className="text-[11px] text-gray-400 font-medium mt-0.5">Edit metadata before download</p>
                  </div>

                  {/* Edit Custom Title Form Input */}
                  <div className="space-y-1.5">
                    <label htmlFor="doc-title" className="block text-[11px] font-bold uppercase tracking-widest text-gray-400">
                      Export Title
                    </label>
                    <input
                      type="text"
                      id="doc-title"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder="Title on document page"
                      className="w-full bg-gray-50 border border-gray-200 px-4 py-3 rounded-xl text-xs font-semibold text-zinc-800 outline-none focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-black transition-all"
                    />
                  </div>

                  {/* Override Platform Input */}
                  <div className="space-y-1.5">
                    <label htmlFor="doc-platform" className="block text-[11px] font-bold uppercase tracking-widest text-[#999999]">
                      Platform Source Label
                    </label>
                    <input
                      type="text"
                      id="doc-platform"
                      value={editPlatform}
                      onChange={(e) => setEditPlatform(e.target.value)}
                      placeholder="e.g. ChatGPT, Claude..."
                      className="w-full bg-gray-50 border border-gray-200 px-4 py-3 rounded-xl text-xs font-semibold text-zinc-800 outline-none focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-black transition-all"
                    />
                  </div>

                  {/* Statistical Badges list */}
                  <div className="bg-gray-50 border border-gray-200/50 rounded-2xl p-4.5 space-y-2.5">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block pb-1 border-b border-gray-200/50">Conversion Details</span>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-gray-500 font-semibold">Included Messages:</span>
                      <span className="font-bold text-black">{getSelectedMessageCount()} / {parsedData.messages.length}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-gray-500 font-semibold">Est. Print Pages:</span>
                      <span className="font-bold text-black">{Math.max(1, Math.ceil(getSelectedWordCount() / 420))} pages</span>
                    </div>
                  </div>

                  {/* Actions / Block buttons */}
                  <div className="space-y-3 pt-2">
                    <button
                      type="button"
                      onClick={downloadPDF}
                      className="w-full bg-black text-white hover:opacity-90 rounded-2xl py-4 px-4 text-xs font-bold cursor-pointer transition-all flex items-center justify-center space-x-2 shadow-sm shadow-black/10 animate-fade-in"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download PDF Document</span>
                    </button>

                    <button
                      type="button"
                      onClick={downloadDOCX}
                      className="w-full bg-white border border-gray-200 text-gray-800 hover:bg-gray-50 rounded-2xl py-4 px-4 text-xs font-bold cursor-pointer transition-all flex items-center justify-center space-x-2"
                    >
                      <FileCheck2 className="w-3.5 h-3.5 text-gray-400" />
                      <span>Export to Word (.docx)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setShareModalOpen(true);
                        setNativeShareStatus("idle");
                        setNativeShareError("");
                        setCopiedShareDetails(false);
                      }}
                      className="w-full bg-zinc-50 border border-zinc-200/80 text-zinc-800 hover:bg-zinc-100 rounded-2xl py-4 px-4 text-xs font-bold cursor-pointer transition-all flex items-center justify-center space-x-2 shadow-sm hover:shadow-inner"
                    >
                      <Share2 className="w-3.5 h-3.5 text-zinc-500" />
                      <span>Share Document</span>
                    </button>
                  </div>

                </div>

              </div>

              {/* --- RIGHT COL: LIVE DRAFT WORKSPACE (lg:col-span-8) --- */}
              <div className="lg:col-span-8 space-y-6">
                
                {/* Visual Draft Header Info */}
                <div className="flex justify-between items-center px-2">
                  <div className="flex items-center space-x-2 text-[10px] font-bold text-black bg-black/5 py-1.5 px-3.5 rounded-full uppercase tracking-widest select-none">
                    <Eye className="w-3.5 h-3.5 text-black" />
                    <span>Live Document Draft</span>
                  </div>
                  <span className="text-xs text-gray-400 font-medium">Click checkboxes to toggle transcript blocks</span>
                </div>

                {/* Draft Simulated Paper Space */}
                <div className="bg-white border border-gray-200 rounded-3xl shadow-sm shadow-gray-250/30 overflow-hidden">
                  
                  {/* Paper Header banner layout */}
                  <div className="p-8 sm:p-10 bg-gray-50/50 border-b border-gray-100">
                    <div className="max-w-xl mx-auto space-y-3">
                      <div className="flex items-center space-x-2">
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest bg-gray-200/40 px-3 py-1 rounded-full">
                          {editPlatform || "AI"} Transcript
                        </span>
                      </div>
                      <h2 className="text-3xl font-black text-black tracking-tight leading-tight">
                        {editTitle || "Shared Chat Transcript"}
                      </h2>
                    </div>
                  </div>

                  {/* Message stack mapping */}
                  <div className="p-6 sm:p-10 space-y-6 bg-white max-w-xl mx-auto">
                    
                    {parsedData.messages.map((msg) => {
                      const isUser = msg.role === "user";
                      const isEnabled = msg.enabled;
                      const isCurrentlyEditing = editingMessageId === msg.id;

                      return (
                        <div
                          key={msg.id}
                          className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                        >
                          <div className="w-full max-w-[88%]">
                            <div className={`flex items-center gap-2 mb-2 ${isUser ? "justify-end" : "justify-start"}`}>
                              <button
                                type="button"
                                onClick={() => toggleMessage(msg.id)}
                                className="flex items-center gap-2 text-left cursor-pointer transition-colors outline-none focus:outline-none"
                              >
                                <div className={`w-4 h-4 rounded-md flex items-center justify-center transition-all ${
                                  isEnabled
                                    ? "bg-black text-white"
                                    : "border border-gray-300 bg-white"
                                }`}>
                                  {isEnabled && <Check className="w-3 h-3 stroke-[3]" />}
                                </div>
                                <span className={`text-[11px] font-bold uppercase tracking-widest ${
                                  isEnabled
                                    ? "text-black"
                                    : "text-gray-300 line-through"
                                }`}>
                                  {isUser ? "User Prompt" : `${editPlatform || "AI"} Response`}
                                </span>
                              </button>

                              {isEnabled && (
                                <div className="flex items-center gap-2 opacity-0 hover:opacity-100 focus-within:opacity-100 transition-all duration-200">
                                  {!isCurrentlyEditing && (
                                    <button
                                      type="button"
                                      onClick={() => startEditingMessage(msg.id, msg.content)}
                                      title="Edit Content"
                                      className="p-1 text-zinc-400 hover:text-zinc-700 rounded transition-colors"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => deleteMessage(msg.id)}
                                    title="Delete Message Block"
                                    className="p-1 text-zinc-400 hover:text-rose-600 rounded transition-colors"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              )}
                            </div>

                            <div className={`rounded-[24px] border px-4 py-4 sm:px-5 sm:py-5 transition-all ${
                              isEnabled
                                ? isUser
                                  ? "bg-gradient-to-br from-[#46A589]/15 to-[#0F1325]/10 border-[#46A589]/20"
                                  : "bg-white border-gray-200"
                                : "opacity-30 border-gray-200 bg-white"
                            }`}>
                              {isCurrentlyEditing ? (
                                <div className="space-y-3">
                                  <textarea
                                    value={editingMessageText}
                                    onChange={(e) => setEditingMessageText(e.target.value)}
                                    className="w-full min-h-[105px] text-xs bg-white border border-gray-200 p-3 rounded-lg outline-none focus:ring-2 focus:ring-black/5 focus:border-black font-mono text-zinc-800"
                                  />
                                  <div className="flex justify-end gap-3">
                                    <button
                                      type="button"
                                      onClick={() => setEditingMessageId(null)}
                                      className="px-3 py-1.5 text-[10px] font-bold text-gray-400 uppercase hover:text-black rounded transition-colors tracking-wider"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      onClick={saveEditingMessage}
                                      className="px-4 py-1.5 text-[10px] bg-black text-white font-bold uppercase rounded-xl hover:opacity-90 transition-opacity tracking-wider"
                                    >
                                      Save Changes
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="transition-opacity">
                                  <CustomChatRenderer content={msg.content} />
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}

                  </div>

                </div>

              </div>

            </motion.div>
          )}
        </AnimatePresence>

      </main>

      {/* --- FOOTER REGION --- */}
      <footer className="border-t border-gray-100 bg-white py-8 mt-16 px-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between text-[12px] text-gray-400 font-medium space-y-3 sm:space-y-0">
          <div className="flex items-center gap-6">
            <span>© 2026 Chat2PDF</span>
            <span>Privacy Policy</span>
            <span>Terms</span>
          </div>
          <div className="flex items-center gap-4">
            <span>v1.2.4</span>
            <div className="flex items-center gap-1.5 font-bold text-zinc-500 uppercase tracking-widest text-[10px]">
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              <span>System Operational</span>
            </div>
          </div>
        </div>
      </footer>

      {/* --- SHARE MODAL --- */}
      <AnimatePresence>
        {shareModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShareModalOpen(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            />

            {/* Modal Body */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ type: "spring", duration: 0.4 }}
              className="relative bg-white w-full max-w-lg rounded-3xl p-6 sm:p-8 shadow-xl border border-gray-150 z-10 flex flex-col hover:border-gray-250 transition-colors"
            >
              {/* Header */}
              <div className="flex items-center justify-between pb-4 border-b border-gray-100 animate-fade-in">
                <div className="flex items-center space-x-2.5">
                  <div className="p-2 bg-black/5 rounded-xl text-black">
                    <Share2 className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-black tracking-tight">Share Document</h3>
                    <p className="text-[11px] text-gray-400 font-medium">Distribute your chat transcript instantly</p>
                  </div>
                </div>
                <button
                  onClick={() => setShareModalOpen(false)}
                  className="rounded-lg p-1.5 hover:bg-gray-100 text-gray-400 hover:text-black transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Format Toggle Options */}
              <div className="my-5">
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                  Select Format to Share
                </label>
                <div className="grid grid-cols-2 gap-2 bg-gray-50 p-1 rounded-xl border border-gray-200/50">
                  <button
                    type="button"
                    onClick={() => {
                      setShareFormat("pdf");
                      setNativeShareStatus("idle");
                    }}
                    className={`flex items-center justify-center space-x-1.5 py-2.5 text-xs font-bold rounded-lg transition-all ${
                      shareFormat === "pdf"
                        ? "bg-white text-black shadow-sm"
                        : "text-gray-400 hover:text-black"
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>PDF Format</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShareFormat("docx");
                      setNativeShareStatus("idle");
                    }}
                    className={`flex items-center justify-center space-x-1.5 py-2.5 text-xs font-bold rounded-lg transition-all ${
                      shareFormat === "docx"
                        ? "bg-white text-black shadow-sm"
                        : "text-gray-400 hover:text-black"
                    }`}
                  >
                    <FileCheck2 className="w-3.5 h-3.5" />
                    <span>Word Document</span>
                  </button>
                </div>
              </div>

              {/* Share Channels */}
              <div className="space-y-4">
                
                {/* 1. System native sharing button */}
                <div className="bg-gray-50 border border-gray-100 p-4 rounded-2xl flex flex-col space-y-3">
                  <div>
                    <h4 className="text-[12px] font-bold text-black uppercase tracking-wider">System or Device Share</h4>
                    <p className="text-[11px] text-gray-400 mt-0.5">Push directly to applications (Google Drive, Slack, Dropbox, Mail, WhatsApp or SMS)</p>
                  </div>

                  <button
                    onClick={handleNativeShare}
                    className="w-full bg-black text-white hover:opacity-95 rounded-xl py-3 px-3 text-xs font-bold flex items-center justify-center space-x-2 transition-all cursor-pointer shadow-sm shadow-black/5"
                  >
                    <Share2 className="w-3.5 h-3.5 animate-pulse" />
                    <span>
                      {nativeShareStatus === "sharing" ? "Opening System Share..." : "Open installed apps list"}
                    </span>
                  </button>

                  {/* Feedback statuses */}
                  {nativeShareStatus === "error" && (
                    <div className="text-[11px] text-rose-600 font-medium bg-rose-50 border border-rose-100 p-2.5 rounded-lg whitespace-pre-wrap leading-relaxed">
                      Note: {nativeShareError || "Your browser does not support physical file sharing. Please use manual email or copy options below."}
                    </div>
                  )}

                  {nativeShareStatus === "success" && (
                    <div className="text-[11px] text-emerald-650 bg-emerald-50 border border-emerald-100 p-2.5 rounded-lg flex items-center space-x-1.5 font-semibold">
                      <Check className="w-3.5 h-3.5" />
                      <span>Document pushed to system share menu successfully!</span>
                    </div>
                  )}
                </div>

                {/* 2. Custom Quick Email Channel */}
                <div className="bg-zinc-50/50 border border-zinc-150 p-4 rounded-2xl space-y-3.5">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="text-[12px] font-bold text-black uppercase tracking-wider">Share via Email Link</h4>
                      <p className="text-[11px] text-gray-400 mt-0.5">Pre-fills subject line & summary body text</p>
                    </div>
                    {/* Copy Template Button */}
                    <button
                      onClick={() => {
                        const emailBody = `Hi there,\n\nI exported this AI conversation transcript of "${editTitle || "Shared Chat Transcript"}" from ${editPlatform || "AI Assistant"}.\n\nDocument Summary:\n- Total message blocks: ${getSelectedMessageCount()}\n- Total word count approx: ${getSelectedWordCount()} words\n\nYou can attach the downloaded PDF/Word file to this email.\n\nGenerated via Chat2PDF.`;
                        navigator.clipboard.writeText(emailBody);
                        setCopiedShareDetails(true);
                        setTimeout(() => setCopiedShareDetails(false), 2000);
                      }}
                      className="text-[10px] font-bold uppercase tracking-wider text-black bg-black/5 px-2.5 py-1 rounded-md hover:bg-black/10 transition-colors cursor-pointer select-none"
                    >
                      {copiedShareDetails ? "Copied!" : "Copy Body"}
                    </button>
                  </div>

                  <a
                    href={`mailto:?subject=${encodeURIComponent(`AI Transcript Export: ${editTitle || "Shared Chat Transcript"}`)}&body=${encodeURIComponent(`Hi there,\n\nI exported this AI conversation transcript of "${editTitle || "Shared Chat Transcript"}" from ${editPlatform || "AI Assistant"}.\n\nDocument Summary:\n- Total message blocks: ${getSelectedMessageCount()}\n- Total word count approx: ${getSelectedWordCount()} words\n\nYou can attach the downloaded PDF/Word file to this email.\n\nGenerated via Chat2PDF.`)}`}
                    className="w-full bg-white border border-gray-250 text-gray-800 hover:bg-gray-50 rounded-xl py-3 px-3 text-xs font-bold flex items-center justify-center space-x-2 transition-all cursor-pointer shadow-sm text-center"
                  >
                    <Mail className="w-3.5 h-3.5 text-gray-500" />
                    <span>Launch Draft Email</span>
                  </a>
                </div>

                {/* 3. Drop-to-Cloud Upload Center */}
                <div className="border border-gray-150 p-4 rounded-xl flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0"></div>
                    <div className="text-[11px] text-zinc-650 font-medium leading-normal pr-2">
                      Upload directly online? Click shortcuts to open <strong className="text-zinc-800">Google Drive</strong> or <strong className="text-zinc-800">Dropbox</strong>.
                    </div>
                  </div>
                  <div className="flex space-x-1.5 flex-shrink-0">
                    <a
                      href="https://drive.google.com/drive/my-drive"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 bg-gray-50 hover:bg-gray-100 rounded-lg text-[11px] font-bold border border-gray-200 transition-colors inline-block text-zinc-700"
                      title="Google Drive"
                    >
                      Drive
                    </a>
                    <a
                      href="https://www.dropbox.com/home"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 bg-gray-50 hover:bg-gray-100 rounded-lg text-[11px] font-bold border border-gray-200 transition-colors inline-block text-zinc-700"
                      title="Dropbox"
                    >
                      Dropbox
                    </a>
                  </div>
                </div>

              </div>

              {/* Informative footer */}
              <div className="mt-5 pt-3.5 border-t border-gray-100 text-center">
                <p className="text-[10px] text-gray-400 font-medium">
                  We package transcripts completely in-browser. Zero data is ever stored outside your system.
                </p>
              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
