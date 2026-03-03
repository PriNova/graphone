/**
 * Graphone: tool result HTML example
 *
 * Shows how to return presentational HTML via details._html
 * while preserving plain-text fallback content.
 */

import { Type } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function buildHtmlReport(title: string, summary: string): string {
  return `
<section style="font-family: Inter, Segoe UI, sans-serif; color: #e6f0ff; background: linear-gradient(145deg, #0f172a, #1e293b); border: 1px solid #334155; border-radius: 14px; padding: 14px;">
  <header style="border: 1px solid rgba(103, 232, 249, 0.35); background: linear-gradient(135deg, rgba(14, 165, 233, 0.25), rgba(168, 85, 247, 0.22)); border-radius: 10px; padding: 12px; margin-bottom: 10px;">
    <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: #c4b5fd;">Graphone Report</div>
    <h2 style="margin: 4px 0 0 0; color: #fff;">${title}</h2>
    <p style="margin: 7px 0 0 0; color: #dbeafe;">${summary}</p>
  </header>

  <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 10px;">
    <div style="padding: 9px; border-radius: 10px; border: 1px solid #1d4ed8; background: rgba(37, 99, 235, 0.18);">
      <div style="font-size: 11px; text-transform: uppercase; color: #bfdbfe;">Status</div>
      <div style="font-size: 20px; font-weight: 800; color: #fff;">OK</div>
    </div>
    <div style="padding: 9px; border-radius: 10px; border: 1px solid #047857; background: rgba(16, 185, 129, 0.18);">
      <div style="font-size: 11px; text-transform: uppercase; color: #bbf7d0;">Items</div>
      <div style="font-size: 20px; font-weight: 800; color: #fff;">42</div>
    </div>
    <div style="padding: 9px; border-radius: 10px; border: 1px solid #a21caf; background: rgba(192, 38, 211, 0.18);">
      <div style="font-size: 11px; text-transform: uppercase; color: #f5d0fe;">Mode</div>
      <div style="font-size: 20px; font-weight: 800; color: #fff;">HTML</div>
    </div>
  </div>

  <table style="width: 100%; border-collapse: collapse; border: 1px solid #475569; border-radius: 10px; overflow: hidden;">
    <thead style="background: rgba(51, 65, 85, 0.55); color: #e2e8f0;">
      <tr>
        <th style="text-align: left; padding: 8px; border: 1px solid #475569;">Metric</th>
        <th style="text-align: left; padding: 8px; border: 1px solid #475569;">Value</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="padding: 8px; border: 1px solid #475569; color: #cbd5e1;">Payload styles</td>
        <td style="padding: 8px; border: 1px solid #475569; color: #86efac; font-weight: 700;">Enabled</td>
      </tr>
      <tr>
        <td style="padding: 8px; border: 1px solid #475569; color: #cbd5e1;">Fallback text</td>
        <td style="padding: 8px; border: 1px solid #475569; color: #7dd3fc; font-weight: 700;">Included</td>
      </tr>
    </tbody>
  </table>

  <div style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap;">
    <a href="https://example.com" style="display: inline-block; text-decoration: none; color: #082f49; background: #67e8f9; border: 1px solid #a5f3fc; border-radius: 999px; padding: 7px 12px; font-size: 12px; font-weight: 700;">Open report</a>
    <a href="mailto:team@example.com" style="display: inline-block; text-decoration: none; color: #f5f3ff; background: rgba(167, 139, 250, 0.22); border: 1px solid rgba(196, 181, 253, 0.75); border-radius: 999px; padding: 7px 12px; font-size: 12px; font-weight: 700;">Share</a>
  </div>
</section>
`;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "render_html_report",
    label: "Render HTML Report",
    description:
      "Return an HTML report in details._html for Graphone tool-result rendering",
    parameters: Type.Object({
      title: Type.Optional(Type.String({ description: "Report title" })),
      summary: Type.Optional(
        Type.String({ description: "Short summary line" }),
      ),
    }),
    async execute(_toolCallId, params) {
      const title =
        typeof params.title === "string" && params.title.trim().length > 0
          ? params.title.trim()
          : "Project Status";

      const summary =
        typeof params.summary === "string" && params.summary.trim().length > 0
          ? params.summary.trim()
          : "Rendered from details._html with fallback content.";

      return {
        content: [
          {
            type: "text",
            text: `HTML report generated: ${title}`,
          },
        ],
        details: {
          _html: buildHtmlReport(title, summary),
          reportType: "status",
          status: "ok",
        },
      };
    },
  });
}
